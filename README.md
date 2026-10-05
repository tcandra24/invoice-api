# Invoice & Payment Reminder API

REST API untuk pemilik usaha (freelancer/UMKM) yang ingin membuat invoice, mengirimnya ke email client, mencatat pembayaran (termasuk cicilan), dan mengirim pengingat jatuh tempo secara otomatis.

Dibangun dengan **NestJS 11**, **Prisma 7**, dan **PostgreSQL** sebagai proyek akhir pembelajaran NestJS.

## Fitur

- **Autentikasi JWT**: register, login, profil. Password di-hash dengan bcrypt.
- **Isolasi data per user**: setiap user hanya bisa mengakses client dan invoice miliknya.
- **Manajemen client**: CRUD, pencarian, pagination.
- **Invoice**: nomor otomatis (`INV-2026-0001`), item, diskon, pajak, perhitungan memakai `Decimal` (tanpa selisih pembulatan).
- **Siklus status** yang dijaga aturan (state machine): `DRAFT`, `SENT`, `PARTIALLY_PAID`, `PAID`, `OVERDUE`, `VOID`.
- **Pembayaran**: mendukung cicilan, dilindungi transaksi `Serializable` agar pembayaran bersamaan tidak melebihi tagihan.
- **Pengiriman email** ke client (SMTP atau mode log untuk development).
- **Cron harian** (08:00 WIB): menandai invoice `OVERDUE` dan mengirim reminder H-3, hari H, H+3, H+7 tanpa pengiriman ganda.
- **Daftar invoice dan client** dengan pagination, filter, pencarian, dan pengurutan.
- **Keamanan dasar**: rate limit, validasi input ketat (whitelist), helmet, CORS terkonfigurasi, validasi environment saat start.
- **Dokumentasi Swagger** di `/docs`.
- **Unit test dan e2e test** dengan Jest dan Supertest.

## Tech stack

| Bagian | Teknologi |
|---|---|
| Framework | NestJS 11, TypeScript |
| Database | PostgreSQL, Prisma 7 (driver adapter `pg`) |
| Auth | JWT (`@nestjs/jwt`), bcryptjs |
| Validasi | class-validator, class-transformer, Zod (environment) |
| Job terjadwal | `@nestjs/schedule` |
| Email | Nodemailer |
| Keamanan | `@nestjs/throttler`, helmet |
| Dokumentasi | `@nestjs/swagger` |
| Test | Jest, Supertest |
| Deploy | Railway |

## Alur penggunaan

```
Register/Login -> Tambah Client -> Buat Invoice (DRAFT) -> Kirim (SENT, email ke client)
   -> Client membayar di luar aplikasi -> Catat pembayaran -> PAID
   -> Lewat jatuh tempo tanpa lunas -> OVERDUE -> Reminder otomatis
```

### Status invoice

```mermaid
stateDiagram-v2
  [*] --> DRAFT
  DRAFT --> SENT: kirim
  DRAFT --> VOID: batalkan
  SENT --> PARTIALLY_PAID: bayar sebagian
  SENT --> PAID: lunas
  SENT --> OVERDUE: lewat jatuh tempo (cron)
  SENT --> VOID: batalkan
  PARTIALLY_PAID --> PAID: lunas
  PARTIALLY_PAID --> OVERDUE: lewat jatuh tempo (cron)
  OVERDUE --> PAID: lunas
  OVERDUE --> VOID: batalkan
```

Aturan tambahan: invoice hanya bisa diedit atau dihapus saat `DRAFT`, dan invoice yang sudah punya pembayaran tidak bisa dibatalkan.

## Skema database

```mermaid
erDiagram
  User ||--o{ Client : memiliki
  User ||--o{ Invoice : memiliki
  Client ||--o{ Invoice : ditagih
  Invoice ||--o{ InvoiceItem : berisi
  Invoice ||--o{ Payment : menerima
  Invoice ||--o{ ReminderLog : mencatat

  User {
    string id PK
    string email UK
    string password
    string businessName
  }
  Client {
    string id PK
    string userId FK
    string name
    string email
    string phone
  }
  Invoice {
    string id PK
    string userId FK
    string clientId FK
    string number
    enum status
    date dueDate
    decimal total
  }
  InvoiceItem {
    string id PK
    string invoiceId FK
    string description
    int quantity
    decimal unitPrice
    decimal amount
  }
  Payment {
    string id PK
    string invoiceId FK
    decimal amount
    string method
    datetime paidAt
  }
  ReminderLog {
    string id PK
    string invoiceId FK
    enum stage
    enum channel
    enum status
    string recipient
  }
```

Kombinasi `userId` dan `number` pada `Invoice` bersifat unik. Sisa tagihan tidak disimpan, selalu dihitung dari `total` dikurangi jumlah `Payment`.

## Endpoint

Semua endpoint membutuhkan header `Authorization: Bearer <token>`, kecuali yang bertanda publik.

| Method | Path | Keterangan |
|---|---|---|
| GET | `/health` | Cek API dan database (publik) |
| POST | `/auth/register` | Daftar akun (publik) |
| POST | `/auth/login` | Login, mengembalikan `accessToken` (publik) |
| GET | `/auth/me` | Profil user yang login |
| POST | `/clients` | Tambah client |
| GET | `/clients` | Daftar client (`page`, `limit`, `search`) |
| GET / PATCH / DELETE | `/clients/:id` | Detail, ubah, hapus client |
| POST | `/invoices` | Buat invoice (DRAFT) |
| GET | `/invoices` | Daftar invoice (lihat parameter di bawah) |
| GET | `/invoices/summary` | Ringkasan piutang dan pendapatan |
| GET / PATCH / DELETE | `/invoices/:id` | Detail, ubah, hapus (ubah dan hapus hanya saat DRAFT) |
| POST | `/invoices/:id/send` | Kirim email ke client, status menjadi SENT |
| POST | `/invoices/:id/void` | Batalkan invoice |
| POST | `/invoices/:id/payments` | Catat pembayaran |
| GET | `/invoices/:id/payments` | Riwayat pembayaran |
| POST | `/reminders/run` | Jalankan overdue + reminder manual (`asOf` hanya non-production) |
| GET | `/reminders/invoice/:invoiceId` | Riwayat pengiriman email |

### Parameter `GET /invoices`

| Parameter | Contoh | Keterangan |
|---|---|---|
| `page`, `limit` | `1`, `20` | Pagination (limit maksimal 100) |
| `status` | `OVERDUE` | Filter status |
| `clientId` | `clx...` | Filter client |
| `search` | `maju` | Cari di nomor invoice atau nama client |
| `dueFrom`, `dueTo` | `2026-11-01` | Rentang jatuh tempo |
| `sortBy` | `dueDate` | `createdAt`, `dueDate`, atau `total` |
| `order` | `asc` | `asc` atau `desc` |

### Format response

Sukses:

```json
{ "success": true, "data": { } }
```

Daftar (pagination):

```json
{
  "success": true,
  "data": {
    "items": [],
    "meta": { "total": 42, "page": 1, "limit": 20, "totalPages": 3 }
  }
}
```

Error:

```json
{
  "success": false,
  "statusCode": 400,
  "message": ["name should not be empty"],
  "path": "/clients",
  "timestamp": "2026-10-05T03:00:00.000Z"
}
```

## Struktur proyek

```
src/
├── main.ts               bootstrap, Swagger, shutdown hooks
├── app.setup.ts          konfigurasi global (helmet, CORS, pipe, filter, interceptor)
├── app.module.ts
├── config/               validasi environment
├── common/               util tanggal, format, pagination, filter, interceptor
├── prisma/               PrismaService (global)
├── auth/                 register, login, JwtAuthGuard, @Public, @CurrentUser
├── clients/
├── invoices/             invoice, status, pembayaran, ringkasan
├── notifications/        pengiriman email (SMTP atau log)
└── reminders/            cron overdue + reminder, riwayat
prisma/
├── schema.prisma
└── migrations/
test/                     e2e test
```

## Menjalankan secara lokal

Prasyarat: Node.js 20.19 atau lebih baru, Docker (untuk PostgreSQL).

```bash
# 1. Install dependency
npm install

# 2. Jalankan PostgreSQL
docker compose up -d

# 3. Siapkan environment
cp .env.example .env
# isi JWT_SECRET (minimal 16 karakter), contoh: openssl rand -base64 32

# 4. Migrasi database dan generate Prisma Client
npx prisma migrate dev
npx prisma generate

# 5. Jalankan server
npm run start:dev
```

- API: `http://localhost:3000`
- Swagger: `http://localhost:3000/docs`

### Variabel environment

| Variabel | Wajib | Keterangan |
|---|---|---|
| `DATABASE_URL` | Ya | URL koneksi PostgreSQL |
| `JWT_SECRET` | Ya | Minimal 16 karakter (minimal 32 di production) |
| `PORT` | Tidak | Default 3000 |
| `CORS_ORIGINS` | Tidak | Daftar origin yang diizinkan, dipisah koma. Kosong berarti lintas origin ditolak |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS` | Tidak | Kalau `SMTP_HOST` kosong, email hanya dicetak ke log |
| `MAIL_FROM` | Tidak | Alamat pengirim |
| `SWAGGER_ENABLED` | Tidak | `false` untuk mematikan `/docs` |

Aplikasi akan gagal start dengan pesan yang jelas kalau ada variabel wajib yang kurang atau tidak valid.

## Test

```bash
# Unit test
npm run test

# E2E test (butuh database terpisah)
docker exec -it invoice-db psql -U postgres -c "CREATE DATABASE invoice_test;"
# buat file .env.test (isi minimal ada di bawah)
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/invoice_test?schema=public" npx prisma migrate deploy
npm run test:e2e
```

Isi minimal `.env.test`:

```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/invoice_test?schema=public"
JWT_SECRET="secret-khusus-test"
THROTTLE_DISABLED=true
CORS_ORIGINS=http://localhost:3001
SMTP_HOST=
```

## Deploy (Railway)

1. Buat project dari repo GitHub, lalu tambahkan service PostgreSQL.
2. Isi variabel: `DATABASE_URL=${{Postgres.DATABASE_URL}}`, `JWT_SECRET`, `NODE_ENV=production`, `CORS_ORIGINS`, serta `SMTP_*` kalau memakai email sungguhan.
3. Konfigurasi deploy ada di `railway.json`: build `npm run build`, pre-deploy `npx prisma migrate deploy`, start `npm run start:prod`, healthcheck `/health`.
4. Jalankan satu replica saja, karena cron berjalan di dalam proses aplikasi.

## Keputusan desain

- **`userId` selalu dari token**, tidak pernah dari body atau URL. Data milik user lain dibalas 404 agar keberadaannya tidak bocor.
- **Guard global (secure by default)**: semua endpoint terkunci, endpoint publik harus ditandai `@Public()`.
- **Uang memakai `Decimal`**, bukan `number`.
- **Email dikirim sebelum status berubah**: kalau pengiriman gagal, invoice tetap `DRAFT`.
- **Logika bisnis di service dan fungsi murni** (kalkulator, state machine, pembuat email) agar mudah dites.
- **Reminder tidak ganda**: setiap pengiriman dicatat di `ReminderLog` dan dicek sebelum kirim.
- **Pengurutan memakai whitelist** (`createdAt`, `dueDate`, `total`), bukan nama kolom bebas dari client.

## Keterbatasan dan rencana pengembangan

- Belum ada refresh token dan logout di sisi server (token berlaku 1 hari).
- Belum ada verifikasi email dan reset password.
- Cron berjalan di dalam aplikasi, jadi belum aman untuk banyak instance (rencana: antrian BullMQ).
- Belum ada PDF invoice, halaman invoice publik untuk client, channel WhatsApp, dan payment gateway.
