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

#### UI (Admin)
- [x] View lockers
- [x] Toggle locker active/inactive
- [x] Create hold from UI
- [x] Display reservations
- [x] Show expired holds

---

## Next Features

### Reservation lifecycle
- [ ] Confirm reservation (HOLD → CONFIRMED)
- [ ] Cancel reservation
- [ ] Auto-expire holds (background job)

### Availability
- [ ] Check available lockers for a time range
- [ ] Filter by location

### Payments
- [ ] Integrate Stripe
- [ ] Confirm reservation after payment
- [ ] Handle payment webhooks

---

## Nice to Have
- [ ] Better UI styling
- [ ] Sorting / filtering reservations
- [ ] User accounts (future)