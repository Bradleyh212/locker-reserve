## **locker-reserve**

A full-stack locker reservation system with support for:
- temporary reservation holds
- confirmation and cancellation
- automatic expiration
- availability search

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

----------------------------------------------------------------------------

## **Architecture**

### **Frontend**
- Next.js (React)
- Handles UI and user interaction

### **Backend**
- NestJS API
- Handles business logic and validation

### **Database**
- PostgreSQL
- Managed via Prisma ORM

### **Core Concepts**
- Stateless API
- Reservation lifecycle (HOLD → CONFIRMED → CANCELLED → EXPIRED)
- Conflict detection (no overlapping reservations)

----------------------------------------------------------------------------

## **Reservation Flow**

1. User creates a HOLD from the UI
2. API validates the time range and availability
3. Reservation is stored in the database
4. UI updates and displays the reservation
5. User can confirm or cancel the reservation
6. Background job automatically expires expired holds


----------------------------------------------------------------------------
## **How to Run**

### **Quick start (recommended)**

From the project root:

```bash
./run-dev.sh
