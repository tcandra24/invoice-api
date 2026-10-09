# Invoice & Payment Reminder API

A REST API for business owners (freelancers and small businesses) to create invoices, email them to clients, record payments (including installments), and send due-date reminders automatically.

Built with **NestJS 11**, **Prisma 7**, and **PostgreSQL** as the capstone project of a NestJS learning stage.

## Features

**Authentication and account**

- JWT authentication with **short-lived access tokens** (15 minutes by default) and **rotating refresh tokens**. Refresh tokens are stored hashed, and reusing a revoked token revokes the whole session family.
- Logout (single session) and logout-all (every device).
- Profile update and password change. Changing the password revokes all sessions.
- **Forgot / reset password** by email: single-use hashed token, 30-minute expiry, per-account cooldown, and an identical response whether or not the email is registered.
- Passwords are hashed with bcrypt.
- **Per-user data isolation**: every user can only access their own clients and invoices.

**Invoicing**

- Client management: CRUD, search, pagination.
- Invoices with automatic numbering (`INV-2026-0001`), line items, discount, and tax. All money math uses `Decimal`, so there are no floating-point rounding errors.
- A guarded **invoice lifecycle** (state machine): `DRAFT`, `SENT`, `PARTIALLY_PAID`, `PAID`, `OVERDUE`, `VOID`.
- **Payments**: installments, editing, and cancelling (soft delete with an optional reason). The invoice status is recalculated automatically, so it can move backwards (for example `PAID` to `PARTIALLY_PAID`). Payment writes run in `Serializable` transactions, so concurrent payments cannot exceed the total.
- Invoice list with pagination, filters, search, and sorting.

**Reminders and email**

- Invoice and reminder emails to clients (SMTP, or log mode for development).
- **Manual reminders** per invoice, with a minimum interval between sends.
- **Daily cron job** (08:00 WIB): marks invoices `OVERDUE` and sends reminders at D-3, due date, D+3, and D+7 without duplicates.

**Dashboard data**

- Totals summary (open receivables, overdue count, revenue this month).
- Monthly revenue: `invoiced` versus `collected`, with empty months filled with zero.
- Receivables aging: outstanding balance grouped by days overdue.

**Quality and security**

- Rate limiting, strict input validation (whitelist), helmet, configured CORS, and environment validation at startup.
- Swagger documentation at `/docs`, including **response schemas** (the `success` and `data` wrapper and the standard error format). A contract test keeps the documentation in sync with real responses.
- Unit tests and end-to-end tests with Jest and Supertest.

## Tech stack

| Area | Technology |
|---|---|
| Framework | NestJS 11, TypeScript |
| Database | PostgreSQL, Prisma 7 (`pg` driver adapter) |
| Auth | JWT (`@nestjs/jwt`), bcryptjs, hashed random refresh and reset tokens |
| Validation | class-validator, class-transformer, Zod (environment) |
| Scheduled jobs | `@nestjs/schedule` |
| Email | Nodemailer |
| Security | `@nestjs/throttler`, helmet |
| Documentation | `@nestjs/swagger` |
| Testing | Jest, Supertest |
| Deployment | Railway |

## How it works

```
Register / Login -> Add client -> Create invoice (DRAFT) -> Send (SENT, emailed to the client)
   -> Client pays outside the app -> Record payment -> PAID
   -> Past due date and not fully paid -> OVERDUE -> Automatic reminders
```

### Invoice status

```mermaid
stateDiagram-v2
  [*] --> DRAFT
  DRAFT --> SENT: send
  DRAFT --> VOID: void
  SENT --> PARTIALLY_PAID: partial payment
  SENT --> PAID: fully paid
  SENT --> OVERDUE: past due date (cron)
  SENT --> VOID: void
  PARTIALLY_PAID --> PAID: fully paid
  PARTIALLY_PAID --> OVERDUE: past due date (cron)
  OVERDUE --> PAID: fully paid
  OVERDUE --> VOID: void
```

The diagram shows manual transitions. When a payment is added, edited, or cancelled, the status is derived from the data instead:

| Condition | Status |
|---|---|
| Total paid is at least the invoice total | `PAID` |
| Not fully paid and the due date has passed | `OVERDUE` |
| Not fully paid, some payments exist | `PARTIALLY_PAID` |
| Not fully paid, no payments | `SENT` |

Other rules: an invoice can only be edited or deleted while `DRAFT`, an invoice with active payments cannot be voided, and payments can only be changed on invoices that were sent and are not voided.

## Database schema

```mermaid
erDiagram
  User ||--o{ Client : owns
  User ||--o{ Invoice : owns
  User ||--o{ RefreshToken : has
  User ||--o{ PasswordResetToken : has
  Client ||--o{ Invoice : billed
  Invoice ||--o{ InvoiceItem : contains
  Invoice ||--o{ Payment : receives
  Invoice ||--o{ ReminderLog : logs

  User {
    string id PK
    string email UK
    string password
    string businessName
  }
  RefreshToken {
    string id PK
    string userId FK
    string tokenHash UK
    string familyId
    datetime expiresAt
    datetime revokedAt
  }
  PasswordResetToken {
    string id PK
    string userId FK
    string tokenHash UK
    datetime expiresAt
    datetime usedAt
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
    datetime voidedAt
    string voidReason
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

- The combination of `userId` and `number` on `Invoice` is unique.
- The remaining balance is never stored. It is always computed as `total` minus the sum of active (not voided) payments.
- Only token **hashes** are stored for refresh and reset tokens.
- `ReminderLog.stage` is one of `INITIAL`, `BEFORE_3`, `ON_DUE`, `AFTER_3`, `AFTER_7`, or `MANUAL`.

## Endpoints

All endpoints require an `Authorization: Bearer <token>` header unless marked public.

### Health and auth

| Method | Path | Description |
|---|---|---|
| GET | `/health` | API and database check (public) |
| POST | `/auth/register` | Create an account (public) |
| POST | `/auth/login` | Log in, returns an access token and a refresh token (public) |
| POST | `/auth/refresh` | Exchange a refresh token for a new token pair, with rotation (public) |
| POST | `/auth/logout` | End one session by revoking its refresh token (public) |
| POST | `/auth/forgot-password` | Request a password reset email. The response is always the same (public) |
| POST | `/auth/reset-password` | Set a new password with the emailed token. Revokes all sessions (public) |
| POST | `/auth/logout-all` | End all sessions of the current user |
| GET | `/auth/me` | Profile of the current user |

### Profile

| Method | Path | Description |
|---|---|---|
| PATCH | `/profile` | Update `name` and `businessName`. Send only the fields to change |
| PATCH | `/profile/password` | Change password. Revokes all sessions |

### Clients

| Method | Path | Description |
|---|---|---|
| POST | `/clients` | Create a client |
| GET | `/clients` | List clients (`page`, `limit`, `search`) |
| GET / PATCH / DELETE | `/clients/:id` | Get, update, or delete a client (delete fails if the client has invoices) |

### Invoices

| Method | Path | Description |
|---|---|---|
| POST | `/invoices` | Create an invoice (`DRAFT`) |
| GET | `/invoices` | List invoices (see parameters below) |
| GET | `/invoices/summary` | Totals: open receivables, overdue count, revenue this month |
| GET | `/invoices/summary/revenue` | Monthly revenue: `invoiced` and `collected` (`months` from 1 to 24, default 12) |
| GET | `/invoices/summary/aging` | Outstanding balance by days overdue |
| GET / PATCH / DELETE | `/invoices/:id` | Get, update, or delete (update and delete only while `DRAFT`) |
| POST | `/invoices/:id/send` | Email the invoice to the client, status becomes `SENT` |
| POST | `/invoices/:id/remind` | Send a manual reminder to the client (minimum interval between sends, 24 hours by default) |
| POST | `/invoices/:id/void` | Void the invoice |

### Payments

| Method | Path | Description |
|---|---|---|
| POST | `/invoices/:id/payments` | Record a payment (installments allowed) |
| GET | `/invoices/:id/payments` | Payment history (add `?includeVoided=true` to include cancelled ones) |
| GET | `/invoices/:id/payments/:paymentId` | Get one payment |
| PATCH | `/invoices/:id/payments/:paymentId` | Update amount, method, date, or note. The invoice status is recalculated |
| DELETE | `/invoices/:id/payments/:paymentId` | Cancel a payment (soft delete, optional `reason` in the body). The invoice status is recalculated |

### Reminders

| Method | Path | Description |
|---|---|---|
| POST | `/reminders/run` | Run overdue marking and reminders manually for your own invoices (`asOf` is not available in production) |
| GET | `/reminders/invoice/:invoiceId` | Email delivery history for an invoice |

### `GET /invoices` parameters

| Parameter | Example | Description |
|---|---|---|
| `page`, `limit` | `1`, `20` | Pagination (maximum limit is 100) |
| `status` | `OVERDUE` | Filter by status |
| `clientId` | `clx...` | Filter by client |
| `search` | `acme` | Search invoice number or client name |
| `dueFrom`, `dueTo` | `2026-11-01` | Due date range |
| `sortBy` | `dueDate` | `createdAt`, `dueDate`, or `total` |
| `order` | `asc` | `asc` or `desc` |

### Response format

Money amounts (`Decimal`) are serialized as **strings**, for example `"650000"`, so precision is preserved.

Success:

```json
{ "success": true, "data": { } }
```

List (pagination):

```json
{
  "success": true,
  "data": {
    "items": [],
    "meta": { "total": 42, "page": 1, "limit": 20, "totalPages": 3 }
  }
}
```

Error (`message` is a string, or an array for validation errors):

```json
{
  "success": false,
  "statusCode": 400,
  "message": ["name should not be empty"],
  "path": "/clients",
  "timestamp": "2026-10-09T03:00:00.000Z"
}
```

### Typed API clients

The OpenAPI document is served at `/docs-json`, including response schemas. For example, to generate TypeScript types:

```bash
npx openapi-typescript http://localhost:3000/docs-json -o src/api/schema.d.ts
```

## Project structure

```
src/
├── main.ts               bootstrap, Swagger, shutdown hooks
├── app.setup.ts          global setup (helmet, CORS, pipe, filter, interceptor)
├── app.module.ts
├── config/               environment validation
├── common/               date and format utilities, pagination, Swagger helpers, filter, interceptor
├── prisma/               PrismaService (global)
├── auth/                 register, login, refresh tokens, password reset, JwtAuthGuard, @Public, @CurrentUser
├── profile/              profile update and password change
├── clients/
├── invoices/             invoices, status rules, payments, summary and reports
├── notifications/        email delivery (SMTP or log)
└── reminders/            overdue cron, automatic and manual reminders, history
prisma/
├── schema.prisma
└── migrations/
test/                     end-to-end tests
```

## Running locally

Prerequisites: Node.js 20.19 or newer, Docker (for PostgreSQL).

```bash
# 1. Install dependencies
npm install

# 2. Start PostgreSQL
docker compose up -d

# 3. Set up the environment
cp .env.example .env
# set JWT_SECRET (at least 16 characters), for example: openssl rand -base64 32

# 4. Run migrations and generate the Prisma Client
npx prisma migrate dev
npx prisma generate

# 5. Start the server
npm run start:dev
```

- API: `http://localhost:3000`
- Swagger: `http://localhost:3000/docs`

With `SMTP_HOST` empty, emails are printed to the server log instead of being sent. This includes password reset links, so you can complete the reset flow locally without an email provider.

### Environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `DATABASE_URL` | Yes | | PostgreSQL connection URL |
| `JWT_SECRET` | Yes | | At least 16 characters (at least 32 in production) |
| `JWT_ACCESS_TTL_SECONDS` | No | `900` | Access token lifetime in seconds |
| `REFRESH_TOKEN_TTL_DAYS` | No | `7` | Refresh token lifetime in days |
| `PASSWORD_RESET_URL` | No | `http://localhost:3001/reset-password` | Frontend page for the reset link (`?token=...` is appended). Must **not** point to localhost in production |
| `PASSWORD_RESET_TTL_MINUTES` | No | `30` | Reset link lifetime |
| `PASSWORD_RESET_COOLDOWN_MINUTES` | No | `2` | Minimum time between reset requests per account |
| `MANUAL_REMINDER_COOLDOWN_HOURS` | No | `24` | Minimum time between manual reminders per invoice |
| `PORT` | No | `3000` | HTTP port |
| `CORS_ORIGINS` | No | | Allowed origins, comma separated. Empty means cross-origin requests are rejected |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS` | No | | Email transport. If `SMTP_HOST` is empty, emails are only logged |
| `MAIL_FROM` | No | | Sender address |
| `SWAGGER_ENABLED` | No | `true` | Set to `false` to disable `/docs` |
| `THROTTLE_DISABLED` | No | | `true` disables rate limiting (used only by e2e tests) |

The application refuses to start with a clear message if a required variable is missing or invalid.

## Testing

```bash
# Unit tests
npm run test

# End-to-end tests (need a separate database)
docker exec -it invoice-db psql -U postgres -c "CREATE DATABASE invoice_test;"
# create a .env.test file (minimal content below)
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/invoice_test?schema=public" npx prisma migrate deploy
npm run test:e2e
```

Minimal `.env.test`:

```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/invoice_test?schema=public"
JWT_SECRET="secret-for-tests-only"
THROTTLE_DISABLED=true
CORS_ORIGINS=http://localhost:3001
SMTP_HOST=
```

Run the `prisma migrate deploy` command again whenever the schema changes.

The test suites cover:

- **Unit tests**: invoice calculator, status rules (including payment-derived status), date utilities, email builders, and the auth, profile, payment, reminder, password reset, and report services.
- **End-to-end tests**: the full invoice lifecycle, pagination and filtering, security headers and CORS, refresh tokens and logout, profile and password change, forgot and reset password, manual reminders, payment editing and cancelling, dashboard reports, and a **Swagger contract test** that compares documented schemas with real responses.

## Deployment (Railway)

1. Create a project from the GitHub repository and add a PostgreSQL service.
2. Set the variables: `DATABASE_URL=${{Postgres.DATABASE_URL}}`, `JWT_SECRET`, `NODE_ENV=production`, `PASSWORD_RESET_URL` (the real frontend reset page), `CORS_ORIGINS`, and `SMTP_*` for real email.
3. Deployment is configured in `railway.json`: build `npm run build`, pre-deploy `npx prisma migrate deploy`, start `npm run start:prod`, health check `/health`.
4. Run a **single replica**, because cron jobs run inside the application process.

Production notes:

- Password reset emails are only delivered when SMTP is configured. In log mode the body of sensitive emails is hidden in production, so reset links never end up in server logs.
- The app refuses to start in production if `PASSWORD_RESET_URL` still points to localhost.

## Design decisions

- **`userId` always comes from the token**, never from the request body or URL. Another user's data returns 404 so its existence is not revealed.
- **Secure by default**: a global guard locks every endpoint, and public endpoints must be marked `@Public()`.
- **Money uses `Decimal`**, never `number`.
- **Email is sent before the status changes**: if sending fails, the invoice stays `DRAFT`.
- **Business logic lives in services and pure functions** (calculator, state machine, status derivation, report aggregation, email builders), which keeps it easy to test.
- **Single source of truth for status after payments**: one function derives the invoice status from the data, shared by add, edit, and cancel payment.
- **Payments are cancelled, not deleted**, so the financial history is preserved. Every sum excludes cancelled payments.
- **Refresh token rotation with reuse detection**: a reused token revokes the whole session family. Revocation happens outside the transaction so it is not rolled back.
- **Reset and refresh tokens are random and stored hashed** (SHA-256), so a database leak does not expose usable tokens.
- **No user enumeration**: login errors are identical for a wrong email or a wrong password, and the forgot-password response is identical for known and unknown emails (the work runs in the background so timing does not differ).
- **A wrong current password returns 400, not 401**, so clients do not mistake it for an expired session.
- **Reminders are never duplicated**: every send is logged in `ReminderLog` and checked before sending. Manual reminders use their own `MANUAL` stage and a cooldown, so they do not interfere with the automatic ones.
- **Sorting uses a whitelist** (`createdAt`, `dueDate`, `total`) instead of arbitrary column names from the client.
- **Aging is based on the due date**, not on the status column, so it stays correct even before the daily cron has run.
- **Documentation is tested**: response DTOs are explicit and compared with real responses in a contract test.

## Limitations and roadmap

Known limitations:

- There is no email verification yet, so reset links can be sent to unverified addresses.
- Access tokens stay valid until they expire (15 minutes by default) after logout or a password change. This is inherent to stateless JWTs.
- Cron jobs run inside the application, so only a single instance is safe (planned: a BullMQ queue).
- The manual reminder and password reset cooldown checks are not atomic. Two truly simultaneous requests can both pass, at the cost of one extra email.
- Dashboard reports are aggregated in application code, which is fine for one business owner's data. Very large datasets would need database-level grouping.

Planned and possible improvements:

- Frontend dashboard (planned, deferred until the learning plan allows).
- PDF invoices and a public invoice page for clients.
- WhatsApp as a second reminder channel.
- Payment gateway integration with webhooks.
- Audit log, recurring invoices, and multi-user organizations.
