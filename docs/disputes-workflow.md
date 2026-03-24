# Dispute Workflow & Admin Resolution Guide

This document outlines the standard operating procedure for handling transaction disputes from open to resolution.

## 1. Dispute State Machine

Disputes follow a strict linear progression. Skipping steps is prevented by the `DisputeStateMachine` constraints to ensure all audit logs remain valid.

mermaid
graph TD;
open-->under_review;
under_review-->resolved;
open-->resolved;

- **open**: Initial state when a user submits a dispute for a transaction. Both parties can submit evidence via `POST /api/v1/disputes/:id/evidence`.
- **under_review**: Admin team has intervened, locking the dispute from user-level withdrawal. Note: Disputes older than 7 days are automatically escalated to this state via system CRON.
- **resolved**: A final decision was reached. This state triggers the `EscrowService` to move the contested funds. It is a terminal state.

## 2. API Workflow for Users

1. **Open Dispute**: User calls `POST /api/v1/disputes` providing the `transaction_id` and their `reason` for disputing.
2. **Upload Evidence**: Users or the counterparty can send pictures, logs, or chat histories via `POST /api/v1/disputes/:id/evidence`.
3. **Monitor Status**: The user can check the status via `GET /api/v1/disputes/:id`. The system optionally sends email hooks when it changes via `NotificationService`.

## 3. Admin Resolution Guide

As an Admin, your goal is to assess evidence and resolve the dispute using the `POST /api/v1/disputes/:id/resolve` endpoint.

### Evidence Assessment

Before resolving, review all evidence using the Admin-level list route `GET /api/v1/disputes` and drilling into individual disputes. Look for:

- Contradictory claims
- Date discrepancies in uploaded images
- Unresponsiveness (if one party failed to reply within the 7-day auto-escalation window, you may default in favor of the active party).

### Resolution Triggers

When resolving, you must specify the `resolution_type`. This instructs the **Escrow Management layer (B10)** on how to route the locked funds:

- `full_refund`: Returns transaction capital to the buyer/reporter.
- `partial_refund`: Splits the fund (Requires future `amount` property extension on EscrowService).
- `release`: Rejects the dispute and releases funds to the mentor/seller.

**All admin resolutions are permanently recorded in the `audit_logs` table under the `dispute_resolved` action.**
