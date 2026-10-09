import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/prisma/prisma.service';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

describe('Laporan: pendapatan bulanan dan aging piutang (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: ReturnType<INestApplication['getHttpServer']>;

  const stamp = Date.now();
  const password = 'rahasia123';
  const owner = { name: 'Owner', email: `owner-${stamp}@e2e-report.test`, password };
  const empty = { name: 'Empty', email: `empty-${stamp}@e2e-report.test`, password };

  let token: string;
  let emptyToken: string;

  const auth = (t = token) => ({ Authorization: `Bearer ${t}` });
  const isoDay = (daysFromNow: number) =>
    new Date(Date.now() + daysFromNow * DAY_MS).toISOString().slice(0, 10);

  // Bulan berjalan menurut WIB (UTC+7)
  const currentMonth = () => {
    const wib = new Date(Date.now() + 7 * HOUR_MS);
    return `${wib.getUTCFullYear()}-${String(wib.getUTCMonth() + 1).padStart(2, '0')}`;
  };

  async function registerAndLogin(user: typeof owner) {
    await request(http).post('/auth/register').send(user).expect(201);
    const res = await request(http)
      .post('/auth/login')
      .send({ email: user.email, password: user.password })
      .expect(201);
    return res.body.data.accessToken as string;
  }

  async function createInvoice(clientId: string, unitPrice: number) {
    const res = await request(http)
      .post('/invoices')
      .set(auth())
      .send({
        clientId,
        dueDate: isoDay(30),
        items: [{ description: 'Jasa', quantity: 1, unitPrice }],
      })
      .expect(201);
    return res.body.data.id as string;
  }

  const send = (id: string) =>
    request(http).post(`/invoices/${id}/send`).set(auth()).expect(200);

  const pay = (id: string, amount: number) =>
    request(http)
      .post(`/invoices/${id}/payments`)
      .set(auth())
      .send({ amount })
      .expect(201);

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
    emptyToken = await registerAndLogin(empty);

    const client = await request(http)
      .post('/clients')
      .set(auth())
      .send({ name: 'PT Laporan', email: 'laporan@example.com' })
      .expect(201);
    const clientId = client.body.data.id as string;

    // A: ditagih 1.000.000, diterima 400.000, belum jatuh tempo
    const invoiceA = await createInvoice(clientId, 1000000);
    await send(invoiceA);
    await pay(invoiceA, 400000);

    // B: ditagih 500.000, pembayaran dibatalkan, lalu jatuh tempo digeser 20 hari ke belakang
    const invoiceB = await createInvoice(clientId, 500000);
    await send(invoiceB);
    const paymentB = (await pay(invoiceB, 100000)).body.data.payment.id;
    await request(http)
      .delete(`/invoices/${invoiceB}/payments/${paymentB}`)
      .set(auth())
      .expect(200);
    await prisma.invoice.update({
      where: { id: invoiceB },
      data: { dueDate: new Date(`${isoDay(-20)}T00:00:00.000Z`) },
    });

    // C: masih draft, tidak boleh muncul di laporan mana pun
    await createInvoice(clientId, 250000);
  });

  afterAll(async () => {
    await prisma.invoice.deleteMany({
      where: { user: { email: { endsWith: '@e2e-report.test' } } },
    });
    await prisma.user.deleteMany({
      where: { email: { endsWith: '@e2e-report.test' } },
    });
    await app.close();
  });

  describe('akses dan validasi', () => {
    it.each(['/invoices/summary/revenue', '/invoices/summary/aging'])(
      '%s menolak tanpa token',
      (path) => request(http).get(path).expect(401),
    );

    it.each([
      ['months=0'],
      ['months=25'],
      ['months=abc'],
      ['months=1.5'],
      ['foo=1'],
    ])('revenue menolak ?%s', (query) =>
      request(http).get(`/invoices/summary/revenue?${query}`).set(auth()).expect(400),
    );
  });

  describe('GET /invoices/summary/revenue', () => {
    it('default 12 bulan, berurutan naik, berakhir di bulan berjalan', async () => {
      const res = await request(http)
        .get('/invoices/summary/revenue')
        .set(auth())
        .expect(200);

      const months = res.body.data.map((row: { month: string }) => row.month);
      expect(months).toHaveLength(12);
      expect(months[11]).toBe(currentMonth());
      expect([...months].sort()).toEqual(months);
    });

    it('?months=3 mengembalikan tiga bulan', async () => {
      const res = await request(http)
        .get('/invoices/summary/revenue?months=3')
        .set(auth())
        .expect(200);

      expect(res.body.data).toHaveLength(3);
    });

    it('invoiced dan collected sesuai data (draft dan pembayaran batal tidak dihitung)', async () => {
      const res = await request(http)
        .get('/invoices/summary/revenue?months=3')
        .set(auth())
        .expect(200);

      const current = res.body.data[2];
      expect(current.month).toBe(currentMonth());
      expect(Number(current.invoiced)).toBe(1500000); // A + B, tanpa draft C
      expect(Number(current.collected)).toBe(400000); // hanya A

      for (const row of res.body.data.slice(0, 2)) {
        expect(Number(row.invoiced)).toBe(0);
        expect(Number(row.collected)).toBe(0);
      }
    });

    it('user tanpa data mendapat bulan-bulan bernilai 0', async () => {
      const res = await request(http)
        .get('/invoices/summary/revenue?months=2')
        .set(auth(emptyToken))
        .expect(200);

      expect(res.body.data).toHaveLength(2);
      expect(
        res.body.data.every(
          (row: { invoiced: string; collected: string }) =>
            Number(row.invoiced) === 0 && Number(row.collected) === 0,
        ),
      ).toBe(true);
    });

    it('bentuk response sesuai dokumentasi', async () => {
      const res = await request(http)
        .get('/invoices/summary/revenue?months=1')
        .set(auth())
        .expect(200);

      expect(Object.keys(res.body.data[0]).sort()).toEqual([
        'collected',
        'invoiced',
        'month',
      ]);
    });
  });

  describe('GET /invoices/summary/aging', () => {
    it('mengelompokkan sisa tagihan berdasarkan tanggal jatuh tempo', async () => {
      const res = await request(http)
        .get('/invoices/summary/aging')
        .set(auth())
        .expect(200);

      const { buckets, total, overdueTotal } = res.body.data;
      expect(buckets.map((b: { key: string }) => b.key)).toEqual([
        'current',
        '1-30',
        '31-60',
        '61-90',
        '90+',
      ]);

      // A: sisa 600.000, belum jatuh tempo
      expect(buckets[0].count).toBe(1);
      expect(Number(buckets[0].amount)).toBe(600000);
      // B: sisa 500.000 (pembayaran dibatalkan), terlambat 20 hari
      expect(buckets[1].count).toBe(1);
      expect(Number(buckets[1].amount)).toBe(500000);

      expect(buckets[2].count + buckets[3].count + buckets[4].count).toBe(0);
      expect(Number(total)).toBe(1100000);
      expect(Number(overdueTotal)).toBe(500000);
    });

    it('user tanpa data: lima kelompok bernilai 0', async () => {
      const res = await request(http)
        .get('/invoices/summary/aging')
        .set(auth(emptyToken))
        .expect(200);

      expect(res.body.data.buckets).toHaveLength(5);
      expect(Number(res.body.data.total)).toBe(0);
      expect(Number(res.body.data.overdueTotal)).toBe(0);
    });

    it('bentuk response sesuai dokumentasi', async () => {
      const res = await request(http)
        .get('/invoices/summary/aging')
        .set(auth())
        .expect(200);

      expect(Object.keys(res.body.data).sort()).toEqual([
        'asOf',
        'buckets',
        'overdueTotal',
        'total',
      ]);
      expect(Object.keys(res.body.data.buckets[0]).sort()).toEqual([
        'amount',
        'count',
        'key',
        'label',
      ]);
    });
  });

  describe('GET /invoices/summary tetap berfungsi', () => {
    it('tidak bentrok dengan route baru', async () => {
      const res = await request(http)
        .get('/invoices/summary')
        .set(auth())
        .expect(200);

      expect(res.body.data).toHaveProperty('totalReceivable');
    });
  });

  describe('dokumentasi Swagger', () => {
    it('kedua endpoint mendokumentasikan response terbungkus', () => {
      const document = SwaggerModule.createDocument(
        app,
        new DocumentBuilder().setTitle('kontrak').setVersion('1').build(),
      );
      const schemaOf = (path: string) =>
        (document.paths[path] as any).get.responses['200'].content[ // eslint-disable-line @typescript-eslint/no-explicit-any
          'application/json'
        ].schema;

      const revenue = schemaOf('/invoices/summary/revenue').properties.data;
      expect(revenue.type).toBe('array');
      expect(revenue.items.$ref).toBe('#/components/schemas/MonthlyRevenueItemDto');

      expect(schemaOf('/invoices/summary/aging').properties.data.$ref).toBe(
        '#/components/schemas/ReceivablesAgingResponseDto',
      );
    });
  });
});
