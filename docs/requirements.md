# Locker Reservation System

A cloud-deployed locker reservation system with an admin dashboard, reservation holds, Stripe payment flow, PostgreSQL persistence, Redis caching, and AWS/EKS deployment.

## Architecture

- Next.js Admin Dashboard
- NestJS REST API
- PostgreSQL on Amazon RDS
- Redis cache
- Docker containers
- AWS ECR image registry
- Amazon EKS Kubernetes cluster
- Kubernetes Secrets, Deployments, and Services
- AWS Load Balancers
- Stripe payments and webhooks

## Core Features

### Lockers
- [x] Create locker
- [x] List lockers
- [x] Activate / deactivate locker
- [x] Cache locker list with Redis
- [x] Invalidate locker cache after updates

### Reservations
- [x] Create temporary hold
- [x] Hold expiration after 10 minutes
- [x] Prevent overlapping reservations
- [x] Prevent booking inactive lockers
- [x] Validate time range
- [x] Confirm reservation
- [x] Cancel reservation
- [x] Auto-expire holds with background job
- [x] Cache availability checks with Redis
- [x] Invalidate availability cache after reservation changes

### Admin UI
- [x] Admin login page
- [x] Protected dashboard routes
- [x] Locker management UI
- [x] Reservation management UI
- [x] Availability lookup UI
- [x] Payment button for active holds
- [x] Payment success state
- [x] Logout
- [x] Token expiration handling

### Payments
- [x] Stripe integration
- [x] Backend-controlled payment amount
- [x] Stripe payment intent creation
- [x] Stripe webhook handling
- [x] Confirm reservation after payment
- [x] Refresh reservations after payment confirmation

## Backend

- [x] NestJS REST API
- [x] Prisma ORM
- [x] PostgreSQL persistence
- [x] JWT admin authentication
- [x] bcrypt-compatible password hashing
- [x] Guarded locker routes
- [x] Guarded reservation routes
- [x] Guarded payment intent route
- [x] Public Stripe webhook route
- [x] Redis cache service
- [x] Optional Redis fallback behavior

## Cloud Deployment

- [x] Dockerized API
- [x] Dockerized Web app
- [x] Pushed API image to AWS ECR
- [x] Pushed Web image to AWS ECR
- [x] Created Amazon RDS PostgreSQL database
- [x] Applied Prisma migrations to RDS
- [x] Created Amazon EKS cluster
- [x] Deployed API to EKS
- [x] Deployed Web app to EKS
- [x] Deployed Redis to Kubernetes
- [x] Configured Kubernetes Secrets
- [x] Configured Kubernetes Services
- [x] Configured public AWS Load Balancers
- [x] Configured CORS for deployed frontend

## Environment Variables

### Backend
- `DATABASE_URL`
- `ADMIN_EMAIL`
- `ADMIN_PASSWORD_HASH`
- `JWT_SECRET`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `CORS_ORIGIN`
- `REDIS_URL`

### Frontend
- `NEXT_PUBLIC_API_BASE_URL`
- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`

## Security Notes

- Never commit `.env` files.
- Never commit secrets or production credentials.
- Keep `STRIPE_SECRET_KEY` and `JWT_SECRET` backend-only.
- Frontend must never decide payment amounts.
- Admin JWT storage currently uses MVP client-side storage.
- Future improvement: replace client-side JWT storage with httpOnly cookies.

## Remaining Work

### Security
- [x] Replace localStorage JWT storage with httpOnly cookies for production hardening

### Product / UI
- [x] Improve dashboard styling
- [x] Add reservation sorting and filtering
- [x] Add dashboard statistics
- [x] Improve locker management UX
- [x] Add user-facing booking flow

### DevOps
- [ ] Add HTTPS / TLS
- [ ] Add custom domain
- [ ] Add GitHub Actions CI/CD
- [ ] Add production monitoring and alerts
- [ ] Replace public API LoadBalancer with Ingress path routing

### Payments
- [ ] Complete full production Stripe webhook setup
- [ ] Test full payment flow with public deployed URL

## Tech Stack

- Next.js
- NestJS
- TypeScript
- Prisma
- PostgreSQL
- Redis
- Stripe
- Docker
- Kubernetes
- Amazon EKS
- Amazon RDS
- AWS ECR