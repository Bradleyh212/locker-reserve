## **locker-reserve**

A full-stack locker reservation system with support for:
- temporary reservation holds
- confirmation and cancellation
- automatic expiration
- availability search
- admin authentication
- public booking and Stripe checkout

Built with Next.js, NestJS, and PostgreSQL.

The next milestone is physical locker access through ESP32 C++ firmware, a 12V
solenoid and an optional door sensor, with simpler cloud-hosted Docker deployment.
These embedded features are planned, not implemented. Source remains in
`services/web` and `services/api`; a future `firmware/` project will run on the ESP32.

Start with the [documentation index](docs/README.md), [deployment plan](docs/deployment.md)
and [embedded hardware plan](docs/embedded/hardware.md). AWS/EKS instructions are
preserved as [legacy reference](docs/legacy/aws-eks-deployment.md).

----------------------------------------------------------------------------

## **Features**

### **Lockers**
- Create lockers
- Activate / deactivate lockers
- Public availability only includes active lockers

### **Reservations**
- Create HOLD (temporary reservation)
- Confirm reservation (HOLD → CONFIRMED)
- Cancel reservation
- Auto-expire holds (background job)
- Sort and filter reservations by status, locker, and date range

### **Availability**
- Check available lockers for a time range
- Filter by location

### **Public Booking**
- Public booking flow at `/book`
- Users can search available lockers, create a hold, and start Stripe payment
- No user accounts are required

### **Admin Authentication**
- Status: implemented for the admin MVP
- Admin login with email and password at `/login`
- JWT-protected admin API routes for lockers, reservations, and PaymentIntent creation
- Protected admin pages: `/`, `/lockers`, `/reservations`, `/availability`
- Admin JWT is stored in a secure `httpOnly` cookie
- Stripe webhook remains public and verifies Stripe signatures

----------------------------------------------------------------------------

## **Architecture**

### **Frontend**
- Next.js (React)
- Handles UI and user interaction

### **Backend**
- NestJS API
- Handles business logic and validation
- Uses JWT guards for admin routes

### **Database**
- PostgreSQL
- Managed via Prisma ORM

### **Core Concepts**
- Stateless API
- HOLD can become CONFIRMED, CANCELLED or EXPIRED; CONFIRMED can be cancelled.
- Current cancellation code also permits EXPIRED → CANCELLED; this is existing behavior, not a recommended access policy.
- Overlap lookup before hold creation; concurrent insertion is not protected by a database exclusion constraint (see [known gaps](docs/requirements.md)).
- Admin credentials are loaded from environment variables

----------------------------------------------------------------------------

## **Reservation Flow**

1. User searches availability from `/book`
2. API validates the time range and availability
3. User selects a locker and creates a HOLD
4. User starts Stripe checkout for the hold
5. Stripe webhook confirms paid reservations
6. Admin can review, confirm, or cancel reservations
7. Background job automatically expires expired holds

----------------------------------------------------------------------------

## **Environment Variables**

Required backend variables:

```bash
ADMIN_EMAIL=
ADMIN_PASSWORD_HASH=
JWT_SECRET=
DATABASE_URL=
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
```

Optional backend variables:

```bash
PORT=3001
CORS_ORIGIN=http://localhost:3000
REDIS_URL=redis://localhost:6379
```

Required frontend variable:

```bash
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=
```

Optional frontend variable:

```bash
NEXT_PUBLIC_API_BASE_URL=http://localhost:3001
```

`NEXT_PUBLIC_API_BASE_URL` and `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` are public frontend configuration.
Do not expose `STRIPE_SECRET_KEY` or `JWT_SECRET` in Next.js public env vars.
Never commit `.env` values; `.env` files are ignored by git.

Admin authentication uses a JWT set by the API as an `httpOnly` cookie. The
frontend does not read or store the JWT; browser requests include the cookie
with `credentials: 'include'`.

Payment amounts are calculated by the backend. The frontend only sends the
reservation ID when creating a Stripe PaymentIntent.

----------------------------------------------------------------------------
## **How to Run**

### **Quick start (recommended)**

Prerequisites: Docker running, a compatible Node.js/npm installation, backend
`services/api/.env` populated with the variables above, and frontend
`services/web/.env.local` containing the Stripe publishable key. For the local
Compose database, use `postgresql://locker:locker@localhost:5433/locker?schema=public`.
Use test Stripe credentials for local development.

For a fresh clone, copy the committed templates from the project root. These
commands preserve existing local environment files:

```bash
cp -n services/api/.env.example services/api/.env
cp -n services/web/.env.example services/web/.env.local
```

Fill the empty values before starting. From `services/api`, install dependencies
and generate a bcrypt hash for a password used only for local development:

```bash
npm ci
node -e 'console.log(require("bcryptjs").hashSync("change-this-local-password", 12))'
node -e 'console.log(require("crypto").randomBytes(32).toString("hex"))'
```

Replace the sample password before running the hash command. Copy the first
output into `ADMIN_PASSWORD_HASH` and the second into `JWT_SECRET`. Log in using
`ADMIN_EMAIL` and the original password, not the hash.

Use matching Stripe test keys from the same account/sandbox: `sk_test_...` in
backend `STRIPE_SECRET_KEY`, and `pk_test_...` in frontend
`NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`. With the Stripe CLI installed and authorized
for that environment, run in a separate terminal:

```bash
stripe login
stripe listen --forward-to http://localhost:3001/payments/webhook
```

Copy the listener's `whsec_...` value into backend `STRIPE_WEBHOOK_SECRET` and
leave the listener running while testing payments. See the
[Stripe CLI documentation](https://github.com/stripe/stripe-cli/wiki/listen-command).
Restart the app after changing environment values. Commit only the example
files; keep `.env` and `.env.local` private. A fresh local database starts without
your teammates' lockers or reservations.

From the project root:

```bash
./scripts/start-local.sh
```

This starts the local PostgreSQL and Redis Docker services, installs
dependencies, applies Prisma migrations, and starts:

- API: `http://localhost:3001`
- Web: `http://localhost:3000`

After logging in at `/login`, the browser should receive an `httpOnly`
`locker_reserve_admin` cookie. No JWT should appear in `localStorage`.

Use `/book` to test the public booking flow. The page uses the public
availability, hold, and payment-intent endpoints while preserving the admin
routes behind cookie-based authentication.
