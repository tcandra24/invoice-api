import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Invoice API (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: ReturnType<INestApplication['getHttpServer']>;

  const stamp = Date.now();
  const userA = {
    name: 'User A',
    email: `a-${stamp}@e2e.test`,
    password: 'rahasia123',
  };
  const userB = {
    name: 'User B',
    email: `b-${stamp}@e2e.test`,
    password: 'rahasia123',
  };

  let tokenA: string;
  let tokenB: string;
  let clientId: string;
  let invoiceId: string;

  const dueDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  async function registerAndLogin(user: typeof userA) {
    await request(http).post('/auth/register').send(user).expect(201);
    const res = await request(http)
      .post('/auth/login')
      .send({ email: user.email, password: user.password })
      .expect(201);
    return res.body.data.accessToken as string;
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
  });

  afterAll(async () => {
    // Invoice dihapus dulu (client punya onDelete: Restrict ke invoice)
    await prisma.invoice.deleteMany({
      where: { user: { email: { endsWith: '@e2e.test' } } },
    });
    await prisma.user.deleteMany({
      where: { email: { endsWith: '@e2e.test' } },
    });
    await app.close();
  });

  describe('auth', () => {
    it('GET /health bisa diakses tanpa token', async () => {
      const res = await request(http).get('/health').expect(200);
      expect(res.body).toEqual({ success: true, data: { status: 'ok' } });
    });

    it('menolak endpoint terproteksi tanpa token', () => {
      return request(http).get('/clients').expect(401);
    });

    it('menolak token palsu', () => {
      return request(http)
        .get('/clients')
        .set('Authorization', 'Bearer token-palsu')
        .expect(401);
    });

    it('register + login mengembalikan token', async () => {
      tokenA = await registerAndLogin(userA);
      tokenB = await registerAndLogin(userB);
      expect(tokenA).toEqual(expect.any(String));
    });

    it('menolak register dengan email yang sama', () => {
      return request(http).post('/auth/register').send(userA).expect(409);
    });

    it('menolak login dengan password salah', () => {
      return request(http)
        .post('/auth/login')
        .send({ email: userA.email, password: 'salah-salah' })
        .expect(401);
    });
  });

  describe('validasi', () => {
    it('menolak body kosong saat membuat client', async () => {
      const res = await request(http)
        .post('/clients')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({})
        .expect(400);

      expect(res.body.success).toBe(false);
      expect(Array.isArray(res.body.message)).toBe(true);
    });

    it('menolak field yang tidak dikenal', () => {
      return request(http)
        .post('/clients')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ name: 'PT A', role: 'admin' })
        .expect(400);
    });
  });

  describe('siklus invoice', () => {
    it('membuat client', async () => {
      const res = await request(http)
        .post('/clients')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ name: 'PT Maju Jaya', email: 'maju@example.com' })
        .expect(201);

      clientId = res.body.data.id;
    });

    it('membuat invoice dan menghitung total', async () => {
      const res = await request(http)
        .post('/invoices')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          clientId,
          dueDate,
          discount: 50000,
          items: [
            { description: 'Desain logo', quantity: 1, unitPrice: 500000 },
            { description: 'Revisi', quantity: 2, unitPrice: 100000 },
          ],
        })
        .expect(201);

      invoiceId = res.body.data.id;
      expect(res.body.data.status).toBe('DRAFT');
      expect(res.body.data.number).toMatch(/^INV-\d{4}-0001$/);
      expect(Number(res.body.data.subtotal)).toBe(700000);
      expect(Number(res.body.data.total)).toBe(650000);
      expect(res.body.data.items).toHaveLength(2);
    });

    it('menolak pembayaran sebelum invoice dikirim', () => {
      return request(http)
        .post(`/invoices/${invoiceId}/payments`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ amount: 100000 })
        .expect(400);
    });

    it('mengirim invoice (status SENT, email tercatat di log)', async () => {
      const res = await request(http)
        .post(`/invoices/${invoiceId}/send`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
      expect(res.body.data.status).toBe('SENT');

      const logs = await request(http)
        .get(`/reminders/invoice/${invoiceId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);

      expect(logs.body.data).toHaveLength(1);
      expect(logs.body.data[0]).toMatchObject({
        stage: 'INITIAL',
        status: 'SENT',
        channel: 'LOG',
        recipient: 'maju@example.com',
      });
    });

    it('menolak edit setelah SENT', () => {
      return request(http)
        .patch(`/invoices/${invoiceId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ notes: 'coba ubah' })
        .expect(400);
    });

    it('cicilan pertama mengubah status ke PARTIALLY_PAID', async () => {
      const res = await request(http)
        .post(`/invoices/${invoiceId}/payments`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ amount: 200000, method: 'transfer' })
        .expect(201);

      expect(res.body.data.invoice.status).toBe('PARTIALLY_PAID');
      expect(Number(res.body.data.invoice.remaining)).toBe(450000);
    });

    it('menolak pembayaran melebihi sisa tagihan', () => {
      return request(http)
        .post(`/invoices/${invoiceId}/payments`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ amount: 999999999 })
        .expect(400);
    });

    it('pelunasan mengubah status ke PAID', async () => {
      const res = await request(http)
        .post(`/invoices/${invoiceId}/payments`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ amount: 450000 })
        .expect(201);

      expect(res.body.data.invoice.status).toBe('PAID');
      expect(Number(res.body.data.invoice.remaining)).toBe(0);
    });

    it('menolak pembayaran pada invoice yang sudah PAID', () => {
      return request(http)
        .post(`/invoices/${invoiceId}/payments`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ amount: 1000 })
        .expect(400);
    });

    it('menolak void pada invoice yang sudah PAID', () => {
      return request(http)
        .post(`/invoices/${invoiceId}/void`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(400);
    });

    it('ringkasan mencerminkan data', async () => {
      const res = await request(http)
        .get('/invoices/summary')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);

      expect(res.body.data.openInvoices).toBe(0);
      expect(Number(res.body.data.revenueThisMonth)).toBe(650000);
    });
  });

  describe('isolasi data antar user', () => {
    it('user B tidak melihat invoice user A', async () => {
      await request(http)
        .get(`/invoices/${invoiceId}`)
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(404);

      const list = await request(http)
        .get('/invoices')
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(200);
      expect(list.body.data.items).toEqual([]);
      expect(list.body.data.meta.total).toBe(0);
    });

    it('user B tidak bisa mencatat pembayaran di invoice user A', () => {
      return request(http)
        .post(`/invoices/${invoiceId}/payments`)
        .set('Authorization', `Bearer ${tokenB}`)
        .send({ amount: 1000 })
        .expect(404);
    });

    it('user B tidak bisa membuat invoice untuk client user A', () => {
      return request(http)
        .post('/invoices')
        .set('Authorization', `Bearer ${tokenB}`)
        .send({
          clientId,
          dueDate,
          items: [{ description: 'X', quantity: 1, unitPrice: 1000 }],
        })
        .expect(404);
    });
  });
});
