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
- [ ] Integrate Stripe
- [ ] Confirm reservation after payment
- [ ] Handle payment webhooks

---

## Nice to Have
- [ ] Better UI styling
- [ ] Sorting / filtering reservations
- [ ] User accounts (future)



* connect the main page to your pages (/lockers, /reservations, /availability)
* improve status styling / dashboard polish
* start thinking about payments / Stripe
* or start documenting your architecture and features better