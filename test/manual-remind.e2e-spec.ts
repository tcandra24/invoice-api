import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/prisma/prisma.service';

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

describe('Kirim pengingat manual (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: ReturnType<INestApplication['getHttpServer']>;

  const stamp = Date.now();
  const password = 'rahasia123';
  const owner = { name: 'Owner', email: `owner-${stamp}@e2e-remind.test`, password };
  const other = { name: 'Other', email: `other-${stamp}@e2e-remind.test`, password };

  let token: string;
  let otherToken: string;
  let invoiceId: string;

  const dueDate = new Date(Date.now() + 30 * DAY_MS).toISOString().slice(0, 10);
  const auth = (t = token) => ({ Authorization: `Bearer ${t}` });

  async function registerAndLogin(user: typeof owner) {
    await request(http).post('/auth/register').send(user).expect(201);
    const res = await request(http)
      .post('/auth/login')
      .send({ email: user.email, password: user.password })
      .expect(201);
    return res.body.data.accessToken as string;
  }

  async function createSentInvoice(clientEmail = 'maju@example.com') {
    const client = await request(http)
      .post('/clients')
      .set(auth())
      .send({ name: 'PT Uji', email: clientEmail })
      .expect(201);

    const invoice = await request(http)
      .post('/invoices')
      .set(auth())
      .send({
        clientId: client.body.data.id,
        dueDate,
        items: [{ description: 'Jasa', quantity: 1, unitPrice: 1000000 }],
      })
      .expect(201);

    return {
      clientId: client.body.data.id as string,
      invoiceId: invoice.body.data.id as string,
    };
  }

  const remind = (id: string, t = token) =>
    request(http).post(`/invoices/${id}/remind`).set(auth(t));

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();

    http = app.getHttpServer();
    prisma = app.get(PrismaService);

    token = await registerAndLogin(owner);
    otherToken = await registerAndLogin(other);

    invoiceId = (await createSentInvoice()).invoiceId;
  });

  afterAll(async () => {
    await prisma.invoice.deleteMany({
      where: { user: { email: { endsWith: '@e2e-remind.test' } } },
    });
    await prisma.user.deleteMany({
      where: { email: { endsWith: '@e2e-remind.test' } },
    });
    await app.close();
  });

  it('menolak tanpa token', () => {
    return request(http).post(`/invoices/${invoiceId}/remind`).expect(401);
  });

  it('menolak invoice yang masih DRAFT', () => {
    return remind(invoiceId).expect(400);
  });

  it('mengirim pengingat setelah invoice dikirim', async () => {
    await request(http)
      .post(`/invoices/${invoiceId}/send`)
      .set(auth())
      .expect(200);

    const res = await remind(invoiceId).expect(200);

    expect(Object.keys(res.body.data).sort()).toEqual([
      'channel',
      'error',
      'id',
      'invoiceId',
      'recipient',
      'sentAt',
      'stage',
      'status',
    ]);
    expect(res.body.data).toMatchObject({
      invoiceId,
      stage: 'MANUAL',
      status: 'SENT',
      channel: 'LOG',
      recipient: 'maju@example.com',
    });
  });

  it('pengiriman kedua langsung setelahnya ditolak 429', async () => {
    const res = await remind(invoiceId).expect(429);

    expect(res.body.success).toBe(false);
    expect(res.body.message).toContain('Coba lagi setelah');
  });

  it('riwayat memuat pengiriman awal dan pengingat manual', async () => {
    const res = await request(http)
      .get(`/reminders/invoice/${invoiceId}`)
      .set(auth())
      .expect(200);

    const stages = res.body.data.map((log: { stage: string }) => log.stage);
    expect(stages.sort()).toEqual(['INITIAL', 'MANUAL']);
  });

  it('boleh mengirim lagi setelah masa jeda lewat', async () => {
    await prisma.reminderLog.updateMany({
      where: { invoiceId, stage: 'MANUAL' },
      data: { sentAt: new Date(Date.now() - 25 * HOUR_MS) },
    });

    await remind(invoiceId).expect(200);

    const manualLogs = await prisma.reminderLog.count({
      where: { invoiceId, stage: 'MANUAL' },
    });
    expect(manualLogs).toBe(2);
  });

  it('pengingat manual tidak mengganggu pengingat otomatis', async () => {
    // Cron tetap memakai tahap sendiri: tidak ada log otomatis yang dibuat
    const auto = await prisma.reminderLog.count({
      where: { invoiceId, stage: { in: ['BEFORE_3', 'ON_DUE', 'AFTER_3', 'AFTER_7'] } },
    });
    expect(auto).toBe(0);
  });

  it('user lain mendapat 404', () => {
    return remind(invoiceId, otherToken).expect(404);
  });

  it('menolak kalau email client dikosongkan setelah invoice terkirim', async () => {
    const { clientId, invoiceId: secondInvoice } = await createSentInvoice();
    await request(http)
      .post(`/invoices/${secondInvoice}/send`)
      .set(auth())
      .expect(200);

    await prisma.client.update({ where: { id: clientId }, data: { email: null } });

    await remind(secondInvoice).expect(400);
  });

  it('menolak invoice yang sudah lunas', async () => {
    await request(http)
      .post(`/invoices/${invoiceId}/payments`)
      .set(auth())
      .send({ amount: 1000000 })
      .expect(201);

    await remind(invoiceId).expect(400);
  });
});
