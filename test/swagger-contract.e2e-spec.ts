import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/prisma/prisma.service';

const DAY_MS = 24 * 60 * 60 * 1000;

describe('Kontrak Swagger vs response asli (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let document: OpenAPIObject;

  const stamp = Date.now();
  const user = {
    name: 'User Doc',
    email: `doc-${stamp}@e2e-doc.test`,
    password: 'rahasia123',
  };
  const dueDate = new Date(Date.now() + 30 * DAY_MS).toISOString().slice(0, 10);

  let token: string;
  let invoiceId: string;
  let clientId: string;

  // Hasil request yang dipakai ulang di beberapa test
  let registerBody: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  let loginBody: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  let payBody: any; // eslint-disable-line @typescript-eslint/no-explicit-any

  const auth = () => ({ Authorization: `Bearer ${token}` });

  function schemaProps(name: string): string[] {
    const schema = document.components?.schemas?.[name] as
      | { properties?: Record<string, unknown> }
      | undefined;
    if (!schema?.properties) {
      throw new Error(`Skema ${name} tidak ditemukan di dokumen Swagger`);
    }
    return Object.keys(schema.properties).sort();
  }

  const expectShape = (data: object, schemaName: string) =>
    expect(Object.keys(data).sort()).toEqual(schemaProps(schemaName));

  function responseSchema(
    path: string,
    method: string,
    status: string,
  ): any /* eslint-disable-line @typescript-eslint/no-explicit-any */ {
    const operation = (document.paths[path] as any)?.[method]; // eslint-disable-line @typescript-eslint/no-explicit-any
    return operation?.responses?.[status]?.content?.['application/json']?.schema;
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

    document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().setTitle('kontrak').setVersion('1').addBearerAuth().build(),
    );

    // Data uji: user, client, invoice terkirim, satu pembayaran
    registerBody = (
      await request(http).post('/auth/register').send(user).expect(201)
    ).body;
    loginBody = (
      await request(http)
        .post('/auth/login')
        .send({ email: user.email, password: user.password })
        .expect(201)
    ).body;
    token = loginBody.data.accessToken;

    clientId = (
      await request(http)
        .post('/clients')
        .set(auth())
        .send({ name: 'PT Dokumen', email: 'dokumen@example.com' })
        .expect(201)
    ).body.data.id;

    invoiceId = (
      await request(http)
        .post('/invoices')
        .set(auth())
        .send({
          clientId,
          dueDate,
          items: [{ description: 'Jasa', quantity: 1, unitPrice: 1000000 }],
        })
        .expect(201)
    ).body.data.id;

    await request(http).post(`/invoices/${invoiceId}/send`).set(auth()).expect(200);

    payBody = (
      await request(http)
        .post(`/invoices/${invoiceId}/payments`)
        .set(auth())
        .send({ amount: 400000, method: 'transfer' })
        .expect(201)
    ).body;
  });

  afterAll(async () => {
    await prisma.invoice.deleteMany({
      where: { user: { email: { endsWith: '@e2e-doc.test' } } },
    });
    await prisma.user.deleteMany({
      where: { email: { endsWith: '@e2e-doc.test' } },
    });
    await app.close();
  });

  describe('struktur dokumen', () => {
    it('response sukses dibungkus success + data', () => {
      const schema = responseSchema('/clients/{id}', 'get', '200');

      expect(schema.properties.success).toBeDefined();
      expect(schema.properties.data.$ref).toBe(
        '#/components/schemas/ClientResponseDto',
      );
    });

    it('daftar berpagination mendokumentasikan items dan meta', () => {
      const data = responseSchema('/clients', 'get', '200').properties.data;

      expect(data.properties.items.items.$ref).toBe(
        '#/components/schemas/ClientResponseDto',
      );
      expect(data.properties.meta.$ref).toBe(
        '#/components/schemas/PaginationMetaDto',
      );
    });

    it('daftar pembayaran didokumentasikan sebagai array di dalam data', () => {
      const data = responseSchema('/invoices/{id}/payments', 'get', '200')
        .properties.data;

      expect(data.type).toBe('array');
      expect(data.items.$ref).toBe('#/components/schemas/PaymentResponseDto');
    });

    it('nominal didokumentasikan sebagai string', () => {
      const props = (
        document.components?.schemas?.InvoiceDetailResponseDto as any // eslint-disable-line @typescript-eslint/no-explicit-any
      ).properties;
      expect(props.total.type).toBe('string');
      expect(props.status.enum).toContain('PAID');
    });

    it('error didokumentasikan dengan format baku', () => {
      const schema = responseSchema('/clients', 'get', '400');
      expect(schema.$ref).toBe('#/components/schemas/ApiErrorResponseDto');
      expect(schemaProps('ApiErrorResponseDto')).toEqual(
        ['message', 'path', 'statusCode', 'success', 'timestamp'].sort(),
      );
    });

    it('semua endpoint terproteksi mendokumentasikan 401', () => {
      const publicOps = new Set([
        'get /health',
        'post /auth/register',
        'post /auth/login',
        'post /auth/refresh',
        'post /auth/logout',
      ]);
      const missing: string[] = [];

      for (const [path, item] of Object.entries(document.paths)) {
        for (const method of ['get', 'post', 'patch', 'delete']) {
          const operation = (item as any)[method]; // eslint-disable-line @typescript-eslint/no-explicit-any
          if (!operation || publicOps.has(`${method} ${path}`)) continue;
          if (!operation.responses?.['401']) missing.push(`${method} ${path}`);
        }
      }

      expect(missing).toEqual([]);
    });
  });

  describe('field di dokumentasi sama dengan response asli', () => {
    it('auth: register, login, me', async () => {
      expectShape(registerBody.data, 'UserPublicResponseDto');
      expectShape(loginBody.data, 'LoginResponseDto');
      expectShape(loginBody.data.user, 'AuthUserResponseDto');

      const me = await request(http).get('/auth/me').set(auth()).expect(200);
      expectShape(me.body.data, 'UserPublicResponseDto');
    });

    it('health', async () => {
      const res = await request(http).get('/health').expect(200);
      expectShape(res.body.data, 'HealthResponseDto');
    });

    it('clients: detail dan daftar', async () => {
      const detail = await request(http)
        .get(`/clients/${clientId}`)
        .set(auth())
        .expect(200);
      expectShape(detail.body.data, 'ClientResponseDto');

      const list = await request(http).get('/clients').set(auth()).expect(200);
      expectShape(list.body.data.items[0], 'ClientResponseDto');
      expectShape(list.body.data.meta, 'PaginationMetaDto');
    });

    it('invoices: detail, daftar, dan ringkasan', async () => {
      const detail = await request(http)
        .get(`/invoices/${invoiceId}`)
        .set(auth())
        .expect(200);
      expectShape(detail.body.data, 'InvoiceDetailResponseDto');
      expectShape(detail.body.data.client, 'ClientResponseDto');
      expectShape(detail.body.data.items[0], 'InvoiceItemResponseDto');

      const list = await request(http).get('/invoices').set(auth()).expect(200);
      expectShape(list.body.data.items[0], 'InvoiceWithClientResponseDto');
      expectShape(list.body.data.meta, 'PaginationMetaDto');

      const summary = await request(http)
        .get('/invoices/summary')
        .set(auth())
        .expect(200);
      expectShape(summary.body.data, 'InvoiceSummaryResponseDto');
    });

    it('payments: hasil tambah pembayaran, detail, dan daftar', async () => {
      expectShape(payBody.data, 'PaymentResultResponseDto');
      expectShape(payBody.data.payment, 'PaymentResponseDto');
      expectShape(payBody.data.invoice, 'PaymentInvoiceSummaryDto');

      const paymentId = payBody.data.payment.id;
      const detail = await request(http)
        .get(`/invoices/${invoiceId}/payments/${paymentId}`)
        .set(auth())
        .expect(200);
      expectShape(detail.body.data, 'PaymentResponseDto');

      const list = await request(http)
        .get(`/invoices/${invoiceId}/payments`)
        .set(auth())
        .expect(200);
      expectShape(list.body.data[0], 'PaymentResponseDto');
    });

    it('reminders: riwayat dan hasil run manual', async () => {
      const logs = await request(http)
        .get(`/reminders/invoice/${invoiceId}`)
        .set(auth())
        .expect(200);
      expectShape(logs.body.data[0], 'ReminderLogResponseDto');

      const run = await request(http)
        .post('/reminders/run')
        .set(auth())
        .expect(200);
      expectShape(run.body.data, 'RunRemindersResponseDto');
    });

    it('error: format sama dengan ApiErrorResponseDto', async () => {
      const res = await request(http).get('/clients/tidak-ada').set(auth()).expect(404);
      expectShape(res.body, 'ApiErrorResponseDto');
    });
  });
});
