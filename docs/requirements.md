# Locker Reservation System - Requirements

## Core Features

### Lockers
- [x] Create locker
- [x] List lockers
- [x] Activate / deactivate locker

### Reservations

#### HOLD (temporary reservation)
- [x] Create hold
- [x] Expiration (10 minutes)
- [x] Prevent overlapping reservations
- [x] Prevent booking inactive lockers
- [x] Validate time range (end > start)

---

## Admin UI (Next.js)

### Authentication
- Status: implemented for the admin MVP.
- [x] Add admin login page at `/login`
- [x] Protect `/`, `/lockers`, `/reservations`, and `/availability`
- [x] Store admin JWT client-side for MVP
- [ ] Replace MVP `localStorage` token storage with httpOnly cookies later

### Lockers
- [x] View lockers
- [x] Toggle locker active/inactive

### Reservations
- [x] Create hold from UI
- [x] Display reservations
- [x] Show expired holds
- [x] Confirm reservation from UI
- [x] Cancel reservation from UI

---

## Backend (NestJS)

### Admin authentication
- Status: implemented with JWT bearer tokens for admin-only API routes.
- [x] Add `POST /auth/login`
- [x] Verify admin password with bcrypt hash
- [x] Load `ADMIN_EMAIL`, `ADMIN_PASSWORD_HASH`, and `JWT_SECRET` from environment
- [x] Protect locker routes with JWT guard
- [x] Protect reservation routes with JWT guard
- [x] Protect `POST /payments/create-intent` with JWT guard
- [x] Keep `POST /payments/webhook` public for Stripe signature verification

### Reservation lifecycle
- [x] Confirm reservation (HOLD → CONFIRMED)
- [x] Cancel reservation
- [x] Auto-expire holds (background job in NestJS)

---

## Next Features

### Availability
- [x] Check available lockers for a time range
- [x] Filter by location

### Payments
- [x] Integrate Stripe
- [x] Handle payment webhooks
- [x] Confirm reservation after payment
- [x] Calculate payment amount on the backend

---

## Environment Variables

Required backend variables:
- `ADMIN_EMAIL`
- `ADMIN_PASSWORD_HASH`
- `JWT_SECRET`
- `DATABASE_URL`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`

Required frontend variable:
- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`

Security constraints:
- Never commit `.env` values.
- Keep `.env` files ignored by git.
- Do not expose `STRIPE_SECRET_KEY` or `JWT_SECRET` to the frontend.
- Do not let the frontend decide the payment amount.

---

## Nice to Have
- [ ] Better UI styling
- [ ] Sorting / filtering reservations
- [ ] User accounts (future)



* connect the main page to your pages (/lockers, /reservations, /availability)
* improve status styling / dashboard polish
* start thinking about payments / Stripe
* or start documenting your architecture and features better
