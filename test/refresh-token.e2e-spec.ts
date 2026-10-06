import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Refresh token dan logout (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: ReturnType<INestApplication['getHttpServer']>;

  const stamp = Date.now();
  const password = 'rahasia123';
  const emailOf = (name: string) => `${name}-${stamp}@e2e-auth.test`;

  async function register(name: string) {
    await request(http)
      .post('/auth/register')
      .send({ name, email: emailOf(name), password })
      .expect(201);
  }

  async function login(name: string) {
    const res = await request(http)
      .post('/auth/login')
      .send({ email: emailOf(name), password })
      .expect(201);
    return res.body.data as { accessToken: string; refreshToken: string };
  }

  const refresh = (refreshToken: string) =>
    request(http).post('/auth/refresh').send({ refreshToken });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();

    http = app.getHttpServer();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    // RefreshToken ikut terhapus lewat onDelete: Cascade
    await prisma.user.deleteMany({
      where: { email: { endsWith: '@e2e-auth.test' } },
    });
    await app.close();
  });

  it('login mengembalikan access token, refresh token, dan masa berlaku', async () => {
    await register('budi');
    const res = await request(http)
      .post('/auth/login')
      .send({ email: emailOf('budi'), password })
      .expect(201);

    expect(res.body.data).toMatchObject({
      accessToken: expect.any(String),
      refreshToken: expect.any(String),
      tokenType: 'Bearer',
      expiresIn: 900,
    });
  });

  it('refresh menghasilkan token baru dan token lama tidak bisa dipakai lagi', async () => {
    await register('citra');
    const first = await login('citra');

    const res = await refresh(first.refreshToken).expect(200);
    const second = res.body.data;

    expect(second.refreshToken).not.toBe(first.refreshToken);
    await request(http)
      .get('/auth/me')
      .set('Authorization', `Bearer ${second.accessToken}`)
      .expect(200);

    // Pemakaian ulang token lama: ditolak
    await refresh(first.refreshToken).expect(401);
  });

  it('pemakaian ulang token lama mencabut seluruh family (token baru ikut mati)', async () => {
    await register('dewi');
    const first = await login('dewi');

    const second = (await refresh(first.refreshToken).expect(200)).body.data;

    await refresh(first.refreshToken).expect(401); // dianggap dicuri
    await refresh(second.refreshToken).expect(401); // sesi ikut dicabut
  });

  it('logout mencabut sesi, refresh sesudahnya ditolak', async () => {
    await register('eko');
    const tokens = await login('eko');

    await request(http)
      .post('/auth/logout')
      .send({ refreshToken: tokens.refreshToken })
      .expect(200);

    await refresh(tokens.refreshToken).expect(401);
  });

  it('logout idempoten untuk token yang tidak dikenal', () => {
    return request(http)
      .post('/auth/logout')
      .send({ refreshToken: 'token-acak-yang-tidak-ada' })
      .expect(200);
  });

  it('access token tetap berlaku sampai kedaluwarsa walau sudah logout (sifat JWT stateless)', async () => {
    await register('fajar');
    const tokens = await login('fajar');

    await request(http)
      .post('/auth/logout')
      .send({ refreshToken: tokens.refreshToken })
      .expect(200);

    await request(http)
      .get('/auth/me')
      .set('Authorization', `Bearer ${tokens.accessToken}`)
      .expect(200);
  });

  it('logout-all mengakhiri semua sesi user', async () => {
    await register('gita');
    const sessionA = await login('gita');
    const sessionB = await login('gita');

    const res = await request(http)
      .post('/auth/logout-all')
      .set('Authorization', `Bearer ${sessionA.accessToken}`)
      .expect(200);
    expect(res.body.data.sessions).toBe(2);

    await refresh(sessionA.refreshToken).expect(401);
    await refresh(sessionB.refreshToken).expect(401);
  });

  it('logout-all butuh access token', () => {
    return request(http).post('/auth/logout-all').expect(401);
  });

  it('validasi: refreshToken wajib diisi', () => {
    return request(http).post('/auth/refresh').send({}).expect(400);
  });

  it('refresh dengan string acak ditolak', () => {
    return refresh('string-acak-yang-bukan-token').expect(401);
  });
});
