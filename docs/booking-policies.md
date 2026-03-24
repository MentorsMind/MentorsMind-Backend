# Booking Policies Guide

## Overview

This document outlines the policies and business rules governing the MentorsMind booking system.

## Booking Creation Policies

### Time Constraints

1. **Minimum Advance Booking**
   - Bookings must be made at least 30 minutes in advance
   - Prevents last-minute scheduling conflicts
   - Allows time for payment processing and confirmation

2. **Session Duration**
   - Minimum: 15 minutes
   - Maximum: 240 minutes (4 hours)
   - Must be in 15-minute increments
   - Recommended: 30, 60, 90, or 120 minutes

3. **Business Hours** (Optional Enforcement)
   - Monday - Friday: 8:00 AM - 8:00 PM
   - Weekends: Disabled by default
   - Configurable per mentor

### Availability Rules

1. **Conflict Prevention**
   - System automatically checks for overlapping bookings
   - Mentors cannot have concurrent sessions
   - Buffer time between sessions: None (back-to-back allowed)

2. **Mentor Capacity**
   - One session at a time per mentor
   - No limit on daily bookings
   - Mentors can set custom availability (future feature)

## Payment Policies

### Pricing

1. **Rate Calculation**
   - Based on mentor's hourly rate
   - Prorated for session duration
   - Formula: `(duration_minutes / 60) * hourly_rate`
   - Currency: XLM (Stellar Lumens)

2. **Payment Timing**
   - Payment required at booking creation
   - Held in escrow until session completion
   - Released to mentor after completion

3. **Payment Methods**
   - Stellar blockchain only
   - Instant settlement
   - Low transaction fees

### Refund Policy

#### Full Refund (100%)
- **Condition:** Cancelled 24+ hours before scheduled time
- **Processing:** Automatic via Stellar
- **Timeline:** Immediate

#### Partial Refund (50%)
- **Condition:** Cancelled 12-24 hours before scheduled time
- **Processing:** Automatic via Stellar
- **Timeline:** Immediate

#### No Refund (0%)
- **Condition:** Cancelled less than 12 hours before scheduled time
- **Reason:** Mentor has reserved the time slot
- **Exception:** Mentor-initiated cancellations always receive full refund

### Payment Disputes

1. **Dispute Window**
   - 7 days after session completion
   - Must provide detailed reason
   - Evidence may be required

2. **Resolution Process**
   - Admin review required
   - Both parties notified
   - Decision within 3-5 business days
   - Final decision binding

## Booking Status Policies

### Status Transitions

1. **Pending → Confirmed**
   - Requires: Payment completed
   - Action: Mentor confirms booking
   - Timeline: Within 24 hours of payment

2. **Confirmed → Completed**
   - Requires: Session end time passed
   - Action: Either party marks complete
   - Timeline: Immediately after session

3. **Any → Cancelled**
   - Allowed: Before session completion
   - Refund: Based on cancellation policy
   - Notification: Both parties alerted

4. **Pending/Confirmed → Rescheduled**
   - Requires: Mutual agreement (future feature)
   - Current: Either party can reschedule
   - Limitation: Subject to availability

### Status Restrictions

- **Cannot update:** Cancelled or completed bookings
- **Cannot confirm:** Without payment
- **Cannot complete:** Before session end time
- **Cannot reschedule:** Cancelled bookings

## Cancellation Policies

### Mentee Cancellation

1. **Before Payment**
   - No penalty
   - Booking deleted

2. **After Payment**
   - Refund based on timing
   - Cancellation reason optional
   - Mentor notified immediately

3. **Repeated Cancellations**
   - 3+ cancellations in 30 days: Warning
   - 5+ cancellations in 30 days: Account review
   - Pattern abuse: Account suspension

### Mentor Cancellation

1. **Any Time Before Session**
   - Full refund to mentee
   - Must provide reason
   - Impacts mentor rating

2. **Emergency Cancellations**
   - Full refund guaranteed
   - Mentee can rebook with priority
   - No penalty to mentor rating

3. **Repeated Cancellations**
   - 3+ cancellations in 30 days: Warning
   - 5+ cancellations in 30 days: Profile review
   - Pattern abuse: Mentor status revoked

## Rescheduling Policies

### Allowed Rescheduling

1. **Before Confirmation**
   - Mentee can reschedule freely
   - No additional charges
   - Subject to mentor availability

2. **After Confirmation**
   - Requires new time slot availability
   - Original payment applies
   - Both parties notified

3. **Rescheduling Limits**
   - Maximum 2 reschedules per booking
   - Must be at least 12 hours before session
   - After 2 reschedules: Must cancel and rebook

### Rescheduling Restrictions

- Cannot reschedule within 12 hours of session
- Cannot reschedule to past dates
- Cannot reschedule cancelled bookings
- Cannot reschedule completed bookings

## No-Show Policy

### Mentee No-Show

1. **Definition**
   - Mentee doesn't join within 15 minutes of start time
   - No prior cancellation or communication

2. **Consequences**
   - No refund issued
   - Payment released to mentor
   - Booking marked as completed
   - Warning issued to mentee account

3. **Dispute Process**
   - Can dispute within 24 hours
   - Must provide valid reason
   - Admin review required

### Mentor No-Show

1. **Definition**
   - Mentor doesn't join within 15 minutes of start time
   - No prior cancellation or communication

2. **Consequences**
   - Full refund to mentee
   - Warning issued to mentor
   - Impacts mentor rating
   - Repeated no-shows: Account suspension

## Session Completion Policies

### Marking Complete

1. **Who Can Complete**
   - Either mentee or mentor
   - After session end time
   - Only for confirmed bookings

2. **Completion Requirements**
   - Session end time must have passed
   - Booking status must be "confirmed"
   - Cannot be already completed or cancelled

3. **Payment Release**
   - Automatic upon completion
   - Transferred to mentor's wallet
   - Transaction recorded on Stellar

### Completion Disputes

1. **Dispute Window**
   - 7 days after completion
   - Must provide evidence
   - Admin review required

2. **Possible Outcomes**
   - Full payment to mentor (default)
   - Full refund to mentee
   - Partial refund (50/50 split)
   - Case-by-case basis

## Fair Use Policy

### Acceptable Use

1. **Booking Purposes**
   - Professional mentoring only
   - Career guidance and advice
   - Skill development sessions
   - Code reviews and technical help

2. **Communication**
   - Professional and respectful
   - On-topic discussions
   - Appropriate language

### Prohibited Activities

1. **Booking Abuse**
   - Fake bookings
   - Booking without intent to attend
   - Gaming the refund system
   - Harassment via bookings

2. **Payment Abuse**
   - Fraudulent payments
   - Chargeback abuse
   - Money laundering
   - Payment disputes in bad faith

3. **Consequences**
   - First offense: Warning
   - Second offense: Temporary suspension
   - Third offense: Permanent ban
   - Severe cases: Immediate ban + legal action

## Data Retention Policy

### Active Bookings

- Stored indefinitely
- Full details accessible
- All status changes logged

### Completed Bookings

- Retained for 2 years
- Archived after 1 year
- Summary data retained permanently

### Cancelled Bookings

- Retained for 1 year
- Archived after 6 months
- Deletion after 2 years

### Payment Records

- Retained for 7 years (compliance)
- Stellar transaction hashes permanent
- Audit trail maintained

## Privacy Policy

### Data Collection

1. **Booking Information**
   - Mentee and mentor IDs
   - Session details (time, duration, topic)
   - Payment information
   - Communication logs

2. **Usage**
   - Service delivery
   - Payment processing
   - Dispute resolution
   - Platform improvement

### Data Sharing

1. **With Other Users**
   - Booking details shared between mentee and mentor
   - Public: None
   - Private: All booking details

2. **With Third Parties**
   - Payment processors (Stellar network)
   - Analytics (anonymized)
   - Legal compliance (when required)

### Data Rights

- Access your booking data
- Export booking history
- Request data deletion (after retention period)
- Opt-out of analytics

## Modification Policy

### Policy Updates

1. **Notification**
   - 30 days advance notice
   - Email notification to all users
   - In-app announcement

2. **Effective Date**
   - Clearly communicated
   - Applies to new bookings only
   - Existing bookings: Original terms apply

3. **User Rights**
   - Review changes before acceptance
   - Cancel existing bookings under old terms
   - Opt-out of service if disagreed

## Support and Assistance

### Getting Help

1. **Booking Issues**
   - Contact support via in-app chat
   - Email: [email]
   - Response time: 24 hours

2. **Payment Issues**
   - Priority support
   - Response time: 4 hours
   - Escalation available

3. **Disputes**
   - Formal dispute process
   - Admin mediation
   - Resolution within 5 business days

### Emergency Situations

- 24/7 emergency support line
- Immediate cancellation assistance
- Expedited refund processing
- Crisis intervention resources

## Compliance

### Legal Requirements

- SOC-2 compliance
- GDPR compliance
- Payment processing regulations
- Data protection laws

### Audit Trail

- All booking actions logged
- Payment transactions recorded
- Status changes tracked
- Dispute resolutions documented

### Reporting

- Monthly booking statistics
- Quarterly financial reports
- Annual compliance audit
- Incident reports as needed
