import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/prisma/prisma.service';

const DAY_MS = 24 * 60 * 60 * 1000;

describe('Edit dan batalkan pembayaran (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: ReturnType<INestApplication['getHttpServer']>;

  const stamp = Date.now();
  const password = 'rahasia123';
  const owner = { name: 'Owner', email: `owner-${stamp}@e2e-pay.test`, password };
  const other = { name: 'Other', email: `other-${stamp}@e2e-pay.test`, password };

  let token: string;
  let otherToken: string;
  let invoiceId: string;
  let p1: string; // 400.000
  let p2: string; // 600.000
  let p3: string; // 1.000.000 (setelah semua dibatalkan)

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

  const pay = (amount: number) =>
    request(http)
      .post(`/invoices/${invoiceId}/payments`)
      .set(auth())
      .send({ amount, method: 'transfer' });

  const getInvoice = async () =>
    (await request(http).get(`/invoices/${invoiceId}`).set(auth()).expect(200))
      .body.data;

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

    const client = await request(http)
      .post('/clients')
      .set(auth())
      .send({ name: 'PT Uji', email: 'uji@example.com' })
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
    invoiceId = invoice.body.data.id;

    await request(http)
      .post(`/invoices/${invoiceId}/send`)
      .set(auth())
      .expect(200);
  });

  afterAll(async () => {
    await prisma.invoice.deleteMany({
      where: { user: { email: { endsWith: '@e2e-pay.test' } } },
    });
    await prisma.user.deleteMany({
      where: { email: { endsWith: '@e2e-pay.test' } },
    });
    await app.close();
  });

  it('menyiapkan dua pembayaran hingga invoice PAID', async () => {
    const first = await pay(400000).expect(201);
    p1 = first.body.data.payment.id;
    expect(first.body.data.invoice.status).toBe('PARTIALLY_PAID');

    const second = await pay(600000).expect(201);
    p2 = second.body.data.payment.id;
    expect(second.body.data.invoice.status).toBe('PAID');
  });

  it('detail satu pembayaran', async () => {
    const res = await request(http)
      .get(`/invoices/${invoiceId}/payments/${p1}`)
      .set(auth())
      .expect(200);

    expect(Number(res.body.data.amount)).toBe(400000);
  });

  describe('ubah pembayaran', () => {
    it('menolak nominal yang melebihi sisa tagihan', () => {
      // lainnya 400.000 + 700.000 > 1.000.000
      return request(http)
        .patch(`/invoices/${invoiceId}/payments/${p2}`)
        .set(auth())
        .send({ amount: 700000 })
        .expect(400);
    });

    it('menolak body kosong dan field yang tidak dikenal', async () => {
      await request(http)
        .patch(`/invoices/${invoiceId}/payments/${p2}`)
        .set(auth())
        .send({})
        .expect(400);

      await request(http)
        .patch(`/invoices/${invoiceId}/payments/${p2}`)
        .set(auth())
        .send({ invoiceId: 'invoice-lain' })
        .expect(400);
    });

    it('mengurangi nominal menurunkan status PAID ke PARTIALLY_PAID', async () => {
      const res = await request(http)
        .patch(`/invoices/${invoiceId}/payments/${p2}`)
        .set(auth())
        .send({ amount: 500000, note: 'koreksi nominal' })
        .expect(200);

      expect(Number(res.body.data.payment.amount)).toBe(500000);
      expect(res.body.data.payment.note).toBe('koreksi nominal');
      expect(res.body.data.invoice.status).toBe('PARTIALLY_PAID');
      expect(Number(res.body.data.invoice.remaining)).toBe(100000);

      const invoice = await getInvoice();
      expect(invoice.status).toBe('PARTIALLY_PAID');
      expect(invoice.paidAt).toBeNull();
    });

    it('menaikkan nominal sampai lunas mengembalikan status ke PAID', async () => {
      const res = await request(http)
        .patch(`/invoices/${invoiceId}/payments/${p2}`)
        .set(auth())
        .send({ amount: 600000 })
        .expect(200);

      expect(res.body.data.invoice.status).toBe('PAID');
      expect((await getInvoice()).paidAt).not.toBeNull();

      // kembalikan ke 500.000 untuk skenario berikutnya
      await request(http)
        .patch(`/invoices/${invoiceId}/payments/${p2}`)
        .set(auth())
        .send({ amount: 500000 })
        .expect(200);
    });
  });

  describe('batalkan pembayaran', () => {
    it('membatalkan p1 dengan alasan', async () => {
      const res = await request(http)
        .delete(`/invoices/${invoiceId}/payments/${p1}`)
        .set(auth())
        .send({ reason: 'salah input' })
        .expect(200);

      expect(res.body.data.payment.voidedAt).not.toBeNull();
      expect(res.body.data.payment.voidReason).toBe('salah input');
      expect(Number(res.body.data.invoice.totalPaid)).toBe(500000);
      expect(res.body.data.invoice.status).toBe('PARTIALLY_PAID');
    });

    it('daftar pembayaran menyembunyikan yang dibatalkan secara default', async () => {
      const hidden = await request(http)
        .get(`/invoices/${invoiceId}/payments`)
        .set(auth())
        .expect(200);
      expect(hidden.body.data).toHaveLength(1);

      const all = await request(http)
        .get(`/invoices/${invoiceId}/payments?includeVoided=true`)
        .set(auth())
        .expect(200);
      expect(all.body.data).toHaveLength(2);

      await request(http)
        .get(`/invoices/${invoiceId}/payments?includeVoided=mungkin`)
        .set(auth())
        .expect(400);
    });

    it('pembayaran yang sudah dibatalkan tidak bisa diubah atau dibatalkan lagi', async () => {
      await request(http)
        .patch(`/invoices/${invoiceId}/payments/${p1}`)
        .set(auth())
        .send({ note: 'x' })
        .expect(400);

      await request(http)
        .delete(`/invoices/${invoiceId}/payments/${p1}`)
        .set(auth())
        .expect(400);
    });

    it('ringkasan tidak menghitung pembayaran yang dibatalkan', async () => {
      const res = await request(http)
        .get('/invoices/summary')
        .set(auth())
        .expect(200);

      expect(res.body.data.openInvoices).toBe(1);
      expect(Number(res.body.data.totalReceivable)).toBe(500000);
      expect(Number(res.body.data.revenueThisMonth)).toBe(500000);
    });

    it('membatalkan semua pembayaran mengembalikan status ke SENT', async () => {
      const res = await request(http)
        .delete(`/invoices/${invoiceId}/payments/${p2}`)
        .set(auth())
        .expect(200); // tanpa body, alasan opsional

      expect(res.body.data.invoice.status).toBe('SENT');
      expect(Number(res.body.data.invoice.remaining)).toBe(1000000);

      const summary = await request(http)
        .get('/invoices/summary')
        .set(auth())
        .expect(200);
      expect(Number(summary.body.data.totalReceivable)).toBe(1000000);
      expect(Number(summary.body.data.revenueThisMonth)).toBe(0);
    });

    it('pembayaran baru tidak menghitung yang sudah dibatalkan', async () => {
      // Kalau yang dibatalkan ikut dihitung, sisa tagihan hanya 100.000
      const res = await pay(1000000).expect(201);
      p3 = res.body.data.payment.id;

      expect(res.body.data.invoice.status).toBe('PAID');
    });
  });

  describe('isolasi data antar user', () => {
    it('user lain tidak bisa mengubah atau membatalkan pembayaran', async () => {
      await request(http)
        .patch(`/invoices/${invoiceId}/payments/${p3}`)
        .set(auth(otherToken))
        .send({ note: 'x' })
        .expect(404);

      await request(http)
        .delete(`/invoices/${invoiceId}/payments/${p3}`)
        .set(auth(otherToken))
        .expect(404);

      await request(http)
        .get(`/invoices/${invoiceId}/payments/${p3}`)
        .set(auth(otherToken))
        .expect(404);
    });
  });
});
