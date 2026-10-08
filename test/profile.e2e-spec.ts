import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Profile (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: ReturnType<INestApplication['getHttpServer']>;

  const stamp = Date.now();
  const password = 'rahasia123';
  const owner = { name: 'Owner', email: `owner-${stamp}@e2e-profile.test`, password };
  const other = { name: 'Other', email: `other-${stamp}@e2e-profile.test`, password };

  let ownerTokens: { accessToken: string; refreshToken: string };
  let otherTokens: { accessToken: string; refreshToken: string };

  const auth = (token = ownerTokens.accessToken) => ({
    Authorization: `Bearer ${token}`,
  });
  const profileKeys = ['businessName', 'createdAt', 'email', 'id', 'name'];

  async function registerAndLogin(user: typeof owner) {
    await request(http).post('/auth/register').send(user).expect(201);
    const res = await request(http)
      .post('/auth/login')
      .send({ email: user.email, password: user.password })
      .expect(201);
    return res.body.data as { accessToken: string; refreshToken: string };
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();

    http = app.getHttpServer();
    prisma = app.get(PrismaService);

    ownerTokens = await registerAndLogin(owner);
    otherTokens = await registerAndLogin(other);
  });

  afterAll(async () => {
    await prisma.user.deleteMany({
      where: { email: { endsWith: '@e2e-profile.test' } },
    });
    await app.close();
  });

  describe('PATCH /profile', () => {
    it('menolak tanpa token', () => {
      return request(http).patch('/profile').send({ name: 'X' }).expect(401);
    });

    it('mengubah nama (dirapikan) dan tidak membocorkan password', async () => {
      const res = await request(http)
        .patch('/profile')
        .set(auth())
        .send({ name: '  Nama Baru  ' })
        .expect(200);

      expect(res.body.data.name).toBe('Nama Baru');
      expect(Object.keys(res.body.data).sort()).toEqual(profileKeys);
      expect(JSON.stringify(res.body)).not.toContain('$2'); // awalan hash bcrypt
    });

    it('GET /auth/me menampilkan data terbaru', async () => {
      const res = await request(http).get('/auth/me').set(auth()).expect(200);
      expect(res.body.data.name).toBe('Nama Baru');
    });

    it('mengisi lalu mengosongkan businessName', async () => {
      const set = await request(http)
        .patch('/profile')
        .set(auth())
        .send({ businessName: 'Toko Maju' })
        .expect(200);
      expect(set.body.data.businessName).toBe('Toko Maju');
      expect(set.body.data.name).toBe('Nama Baru'); // tidak ikut berubah

      const cleared = await request(http)
        .patch('/profile')
        .set(auth())
        .send({ businessName: '' })
        .expect(200);
      expect(cleared.body.data.businessName).toBeNull();
    });

    it.each([
      ['body kosong', {}],
      ['name kosong', { name: '' }],
      ['name hanya spasi', { name: '   ' }],
      ['name null', { name: null }],
      ['name terlalu panjang', { name: 'x'.repeat(101) }],
      ['email tidak boleh diubah di sini', { email: 'baru@example.com' }],
    ])('menolak %s', (_label, body) => {
      return request(http).patch('/profile').set(auth()).send(body).expect(400);
    });
  });

  describe('PATCH /profile/password', () => {
    const change = (body: object) =>
      request(http).patch('/profile/password').set(auth()).send(body);

    it('menolak tanpa token', () => {
      return request(http)
        .patch('/profile/password')
        .send({ oldPassword: password, newPassword: 'passwordBaru1' })
        .expect(401);
    });

    it('password lama salah dibalas 400, bukan 401', async () => {
      const res = await change({
        oldPassword: 'salah-salah',
        newPassword: 'passwordBaru1',
      }).expect(400);

      expect(res.body.message).toContain('incorrect');
    });

    it('menolak password baru yang sama dengan yang lama', () => {
      return change({ oldPassword: password, newPassword: password }).expect(400);
    });

    it('menolak password baru yang terlalu pendek atau terlalu panjang', async () => {
      await change({ oldPassword: password, newPassword: 'pendek' }).expect(400);
      await change({
        oldPassword: password,
        newPassword: 'x'.repeat(73),
      }).expect(400);
    });

    it('berhasil mengganti password dan mencabut semua sesi', async () => {
      const res = await change({
        oldPassword: password,
        newPassword: 'passwordBaru1',
      }).expect(200);

      expect(res.body.data).toEqual({
        message: expect.any(String),
        sessions: 1,
      });
    });

    it('refresh token lama ditolak', () => {
      return request(http)
        .post('/auth/refresh')
        .send({ refreshToken: ownerTokens.refreshToken })
        .expect(401);
    });

    it('login dengan password lama ditolak, dengan password baru berhasil', async () => {
      await request(http)
        .post('/auth/login')
        .send({ email: owner.email, password })
        .expect(401);

      await request(http)
        .post('/auth/login')
        .send({ email: owner.email, password: 'passwordBaru1' })
        .expect(201);
    });

    it('sesi user lain tidak terpengaruh', () => {
      return request(http)
        .post('/auth/refresh')
        .send({ refreshToken: otherTokens.refreshToken })
        .expect(200);
    });

    it('access token lama tetap berlaku sampai kedaluwarsa (sifat JWT stateless)', () => {
      return request(http).get('/auth/me').set(auth()).expect(200);
    });
  });

  describe('dokumentasi Swagger', () => {
    it('kedua endpoint mendokumentasikan response terbungkus', () => {
      const document = SwaggerModule.createDocument(
        app,
        new DocumentBuilder().setTitle('kontrak').setVersion('1').build(),
      );
      const schemaOf = (path: string) =>
        (document.paths[path] as any).patch.responses['200'].content[ // eslint-disable-line @typescript-eslint/no-explicit-any
          'application/json'
        ].schema;

      expect(schemaOf('/profile').properties.data.$ref).toBe(
        '#/components/schemas/UserPublicResponseDto',
      );
      expect(schemaOf('/profile/password').properties.data.$ref).toBe(
        '#/components/schemas/ChangePasswordResponseDto',
      );
    });
  });
});
