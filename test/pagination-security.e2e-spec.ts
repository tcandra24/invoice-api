import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/prisma/prisma.service';

const DAY_MS = 24 * 60 * 60 * 1000;
const isoDay = (daysFromNow: number) =>
  new Date(Date.now() + daysFromNow * DAY_MS).toISOString().slice(0, 10);

describe('Pagination, filter, dan keamanan (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: ReturnType<INestApplication['getHttpServer']>;

  const user = {
    name: 'User Page',
    email: `page-${Date.now()}@e2e-page.test`,
    password: 'rahasia123',
  };
  let token: string;
  const clientIds: string[] = [];

  const auth = () => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

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
    token = login.body.data.accessToken;

    const clients = [
      { name: 'Alpha Studio', email: 'alpha@example.com' },
      { name: 'Beta Studio', email: 'beta@example.com' },
      { name: 'Gamma Corp', email: 'gamma@example.com' },
    ];
    for (const client of clients) {
      const res = await request(http)
        .post('/clients')
        .set(auth())
        .send(client)
        .expect(201);
      clientIds.push(res.body.data.id);
    }

    // total 100.000 / 200.000 / 300.000 dengan jatuh tempo +10 / +20 / +30 hari
    for (let i = 0; i < 3; i++) {
      await request(http)
        .post('/invoices')
        .set(auth())
        .send({
          clientId: clientIds[i],
          dueDate: isoDay(10 * (i + 1)),
          items: [
            { description: 'Jasa', quantity: 1, unitPrice: 100000 * (i + 1) },
          ],
        })
        .expect(201);
    }
  });

  afterAll(async () => {
    await prisma.invoice.deleteMany({
      where: { user: { email: { endsWith: '@e2e-page.test' } } },
    });
    await prisma.user.deleteMany({
      where: { email: { endsWith: '@e2e-page.test' } },
    });
    await app.close();
  });

  describe('clients', () => {
    it('halaman pertama dengan limit 2', async () => {
      const res = await request(http)
        .get('/clients?page=1&limit=2')
        .set(auth())
        .expect(200);

      expect(res.body.data.items).toHaveLength(2);
      expect(res.body.data.meta).toEqual({
        total: 3,
        page: 1,
        limit: 2,
        totalPages: 2,
      });
    });

    it('halaman kedua berisi sisanya', async () => {
      const res = await request(http)
        .get('/clients?page=2&limit=2')
        .set(auth())
        .expect(200);

      expect(res.body.data.items).toHaveLength(1);
    });

    it('pencarian nama tanpa peduli huruf besar-kecil', async () => {
      const res = await request(http)
        .get('/clients?search=STUDIO')
        .set(auth())
        .expect(200);

      expect(res.body.data.meta.total).toBe(2);
    });

    it('pencarian email', async () => {
      const res = await request(http)
        .get('/clients?search=gamma@')
        .set(auth())
        .expect(200);

      expect(res.body.data.items).toHaveLength(1);
      expect(res.body.data.items[0].name).toBe('Gamma Corp');
    });

    it('menolak limit di atas 100', () => {
      return request(http).get('/clients?limit=1000').set(auth()).expect(400);
    });

    it('menolak page 0', () => {
      return request(http).get('/clients?page=0').set(auth()).expect(400);
    });

    it('menolak parameter yang tidak dikenal', () => {
      return request(http).get('/clients?foo=1').set(auth()).expect(400);
    });
  });

  describe('invoices', () => {
    it('filter status', async () => {
      const draft = await request(http)
        .get('/invoices?status=DRAFT')
        .set(auth())
        .expect(200);
      expect(draft.body.data.meta.total).toBe(3);

      const paid = await request(http)
        .get('/invoices?status=PAID')
        .set(auth())
        .expect(200);
      expect(paid.body.data.meta.total).toBe(0);
    });

    it('filter clientId', async () => {
      const res = await request(http)
        .get(`/invoices?clientId=${clientIds[0]}`)
        .set(auth())
        .expect(200);

      expect(res.body.data.items).toHaveLength(1);
    });

    it('pencarian lewat nama client', async () => {
      const res = await request(http)
        .get('/invoices?search=studio')
        .set(auth())
        .expect(200);

      expect(res.body.data.meta.total).toBe(2);
    });

    it('pencarian lewat nomor invoice', async () => {
      const res = await request(http)
        .get('/invoices?search=INV-')
        .set(auth())
        .expect(200);

      expect(res.body.data.meta.total).toBe(3);
    });

    it('filter rentang jatuh tempo', async () => {
      const res = await request(http)
        .get(`/invoices?dueFrom=${isoDay(15)}&dueTo=${isoDay(25)}`)
        .set(auth())
        .expect(200);

      expect(res.body.data.items).toHaveLength(1);
      expect(Number(res.body.data.items[0].total)).toBe(200000);
    });

    it('urut berdasarkan total ascending dan descending', async () => {
      const asc = await request(http)
        .get('/invoices?sortBy=total&order=asc')
        .set(auth())
        .expect(200);
      expect(
        asc.body.data.items.map((i: { total: string }) => Number(i.total)),
      ).toEqual([100000, 200000, 300000]);

      const desc = await request(http)
        .get('/invoices?sortBy=total&order=desc')
        .set(auth())
        .expect(200);
      expect(
        desc.body.data.items.map((i: { total: string }) => Number(i.total)),
      ).toEqual([300000, 200000, 100000]);
    });

    it('menolak sortBy di luar whitelist', () => {
      return request(http)
        .get('/invoices?sortBy=password')
        .set(auth())
        .expect(400);
    });

    it('menolak status yang tidak valid', () => {
      return request(http)
        .get('/invoices?status=BEBAS')
        .set(auth())
        .expect(400);
    });
  });

  describe('keamanan', () => {
    it('helmet: ada header keamanan dan x-powered-by dihapus', async () => {
      const res = await request(http).get('/health').expect(200);

      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['x-powered-by']).toBeUndefined();
    });

    it('CORS: origin yang terdaftar diizinkan', async () => {
      const res = await request(http)
        .options('/clients')
        .set('Origin', 'http://localhost:3001')
        .set('Access-Control-Request-Method', 'GET');

      expect(res.headers['access-control-allow-origin']).toBe(
        'http://localhost:3001',
      );
    });

    it('CORS: origin asing tidak mendapat izin', async () => {
      const res = await request(http)
        .options('/clients')
        .set('Origin', 'https://evil.example')
        .set('Access-Control-Request-Method', 'GET');

      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });
  });
});
