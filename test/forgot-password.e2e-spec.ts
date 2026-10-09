import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import {
  EmailMessage,
  NotificationsService,
} from '../src/notifications/notifications.service';
import { PrismaService } from '../src/prisma/prisma.service';

const MINUTE_MS = 60 * 1000;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('Lupa dan reset password (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: ReturnType<INestApplication['getHttpServer']>;

  const stamp = Date.now();
  const user = {
    name: 'Perseus',
    email: `forgot-${stamp}@e2e-forgot.test`,
    password: 'rahasia123',
  };

  // Semua email yang "dikirim" aplikasi selama test
  const sentMails: EmailMessage[] = [];
  const notificationsMock = {
    channel: 'LOG',
    sendEmail: jest.fn(async (message: EmailMessage) => {
      sentMails.push(message);
      return { channel: 'LOG' as const };
    }),
  };

  let initialRefreshToken: string;
  let genericBody: unknown;
  let firstToken: string;

  // Pengiriman di latar belakang, jadi tunggu sampai email ke-n masuk
  async function waitForMail(count: number, timeoutMs = 3000) {
    const start = Date.now();
    while (sentMails.length < count) {
      if (Date.now() - start > timeoutMs) {
        throw new Error(`Menunggu ${count} email, baru ada ${sentMails.length}`);
      }
      await sleep(25);
    }
    return sentMails[count - 1];
  }

  const tokenFrom = (mail: EmailMessage) =>
    /token=([A-Za-z0-9_-]+)/.exec(mail.text)![1];

  const forgot = (email: string) =>
    request(http).post('/auth/forgot-password').send({ email });

  const reset = (token: string, newPassword = 'passwordBaru1') =>
    request(http).post('/auth/reset-password').send({ token, newPassword });

  // Menggeser waktu pembuatan token supaya masa jeda dianggap sudah lewat
  const ageResetTokens = () =>
    prisma.passwordResetToken.updateMany({
      where: { user: { email: user.email } },
      data: { createdAt: new Date(Date.now() - 10 * MINUTE_MS) },
    });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(NotificationsService)
      .useValue(notificationsMock)
      .compile();

    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();

    http = app.getHttpServer();
    prisma = app.get(PrismaService);

    await request(http).post('/auth/register').send(user).expect(201);
    const login = await request(http)
      .post('/auth/login')
      .send({ email: user.email, password: user.password })
      .expect(201);
    initialRefreshToken = login.body.data.refreshToken;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({
      where: { email: { endsWith: '@e2e-forgot.test' } },
    });
    await app.close();
  });

  describe('forgot-password', () => {
    it('email tidak terdaftar: 200 dengan pesan baku dan tidak ada email', async () => {
      const res = await forgot(`tidak-ada-${stamp}@e2e-forgot.test`).expect(200);
      genericBody = res.body;

      expect(Object.keys(res.body.data)).toEqual(['message']);
      await sleep(300);
      expect(sentMails).toHaveLength(0);
    });

    it('menolak format email yang salah dan body kosong', async () => {
      await request(http)
        .post('/auth/forgot-password')
        .send({ email: 'bukan-email' })
        .expect(400);
      await request(http).post('/auth/forgot-password').send({}).expect(400);
    });

    it('email terdaftar: balasan identik dan link dikirim', async () => {
      const res = await forgot(user.email).expect(200);
      expect(res.body).toEqual(genericBody);

      const mail = await waitForMail(1);
      expect(mail.to).toBe(user.email);
      expect(mail.subject).toBe('Reset your password');
      expect(mail.sensitive).toBe(true);
      expect(mail.text).toContain(
        'http://localhost:3001/reset-password?token=',
      );
      firstToken = tokenFrom(mail);
    });

    it('database hanya menyimpan hash token', async () => {
      const rows = await prisma.passwordResetToken.findMany({
        where: { user: { email: user.email } },
      });

      expect(rows).toHaveLength(1);
      expect(rows[0].tokenHash).not.toBe(firstToken);
      expect(rows[0].tokenHash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('permintaan kedua dalam masa jeda: 200 tetapi tidak ada email baru', async () => {
      await forgot(user.email).expect(200);

      await sleep(300);
      expect(sentMails).toHaveLength(1);
    });
  });

  describe('reset-password', () => {
    it('menolak token acak, password pendek, dan field yang kosong', async () => {
      await reset('token-acak-yang-tidak-ada').expect(400);
      await reset(firstToken, 'pendek').expect(400);
      await request(http).post('/auth/reset-password').send({}).expect(400);
    });

    it('menolak password baru yang sama dengan yang lama, token tetap berlaku', async () => {
      await reset(firstToken, user.password).expect(400);
    });

    it('menolak token kedaluwarsa', async () => {
      await prisma.passwordResetToken.updateMany({
        where: { user: { email: user.email } },
        data: { expiresAt: new Date(Date.now() - MINUTE_MS) },
      });
      await reset(firstToken).expect(400);

      // Kembalikan agar token dipakai di test berikutnya
      await prisma.passwordResetToken.updateMany({
        where: { user: { email: user.email } },
        data: { expiresAt: new Date(Date.now() + 30 * MINUTE_MS) },
      });
    });

    it('berhasil mengganti password dan mengirim pemberitahuan', async () => {
      const res = await reset(firstToken).expect(200);

      expect(Object.keys(res.body.data)).toEqual(['message']);
      const mail = await waitForMail(2);
      expect(mail.subject).toBe('Your password has been changed');
      expect(mail.to).toBe(user.email);
    });

    it('sesi lama dicabut dan login memakai password baru', async () => {
      await request(http)
        .post('/auth/refresh')
        .send({ refreshToken: initialRefreshToken })
        .expect(401);

      await request(http)
        .post('/auth/login')
        .send({ email: user.email, password: user.password })
        .expect(401);

      await request(http)
        .post('/auth/login')
        .send({ email: user.email, password: 'passwordBaru1' })
        .expect(201);
    });

    it('token yang sama tidak bisa dipakai dua kali', async () => {
      await reset(firstToken, 'passwordLain22').expect(400);
    });

    it('permintaan baru membatalkan link sebelumnya', async () => {
      await ageResetTokens();
      await forgot(user.email).expect(200);
      const tokenA = tokenFrom(await waitForMail(3));

      await ageResetTokens();
      await forgot(user.email).expect(200);
      const tokenB = tokenFrom(await waitForMail(4));

      expect(tokenA).not.toBe(tokenB);
      await reset(tokenA).expect(400); // digantikan
      await reset(tokenB, 'passwordLain22').expect(200);

      await waitForMail(5); // pemberitahuan "password berubah"
    });
  });
});
