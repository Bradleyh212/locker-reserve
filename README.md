## **locker-reserve**

A full-stack locker reservation system with support for:
- temporary reservation holds
- confirmation and cancellation
- automatic expiration
- availability search
- admin authentication

Built with Next.js, NestJS, and PostgreSQL.

----------------------------------------------------------------------------

## **Features**

### **Lockers**
- Create lockers
- Activate / deactivate lockers

### **Reservations**
- Create HOLD (temporary reservation)
- Confirm reservation (HOLD → CONFIRMED)
- Cancel reservation
- Auto-expire holds (background job)

### **Availability**
- Check available lockers for a time range
- Filter by location

### **Admin Authentication**
- Status: implemented for the admin MVP
- Admin login with email and password at `/login`
- JWT-protected admin API routes for lockers, reservations, and PaymentIntent creation
- Protected admin pages: `/`, `/lockers`, `/reservations`, `/availability`
- Admin JWT stored in `localStorage` for the current MVP
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
- Reservation lifecycle (HOLD → CONFIRMED → CANCELLED → EXPIRED)
- Conflict detection (no overlapping reservations)
- Admin credentials are loaded from environment variables

----------------------------------------------------------------------------

## **Reservation Flow**

1. User creates a HOLD from the UI
2. API validates the time range and availability
3. Reservation is stored in the database
4. UI updates and displays the reservation
5. User can confirm or cancel the reservation
6. Background job automatically expires expired holds

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

Required frontend variable:

```bash
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=
```

Only `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` should be exposed to the frontend.
Do not expose `STRIPE_SECRET_KEY` or `JWT_SECRET` in Next.js public env vars.
Never commit `.env` values; `.env` files are ignored by git.

For the current MVP, the admin JWT is stored in `localStorage`. This is simple
for local development and can later be replaced with httpOnly cookies.

Payment amounts are calculated by the backend. The frontend only sends the
reservation ID when creating a Stripe PaymentIntent.

----------------------------------------------------------------------------
## **How to Run**

### **Quick start (recommended)**

From the project root:

```bash
./scripts/run-dev.sh
```
