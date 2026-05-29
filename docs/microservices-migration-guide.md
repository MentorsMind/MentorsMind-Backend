# Microservices Architecture Migration Guide

## Current Service Boundaries

### Identified Services:
1. **Auth Service** - Authentication, authorization, JWT, OAuth, MFA
2. **User Service** - User profiles, roles, permissions
3. **Booking Service** - Session bookings, scheduling, calendar sync
4. **Payment Service** - Payments, wallets, escrow, payouts
5. **Notification Service** - Push, email, in-app notifications
6. **Analytics Service** - Reporting, dashboards, events

## Architecture Components

### 1. API Gateway
- Routes requests to appropriate services
- Rate limiting
- Authentication/Authorization
- Request/Response transformation

### 2. Service Mesh (Planned)
- Inter-service communication
- Load balancing
- Circuit breaking
- mTLS

### 3. Event-Driven Architecture
- Redis Pub/Sub
- Event Bus
- Event Sourcing

### 4. Service Discovery
- Redis-based (simple, can be replaced with Consul/Eureka later

## Migration Steps

1. **Phase 1: Extract Shared Kernel
2. **Phase 2: Extract Auth Service
3. **Phase 3: Extract User Service
4. **Phase 4: Extract Booking Service
5. **Phase 5: Extract Payment Service
6. **Phase 6: Extract Notification Service
7. **Phase 7: Setup Service Mesh & Tracing
