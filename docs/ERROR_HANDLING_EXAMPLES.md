# Error Handling Implementation Examples

This document provides practical examples of implementing the new error handling system in services.

## Example 1: Booking Service - Distinguishing Conflict Types

### Problem
In the booking confirmation flow, we need to distinguish between different conflict reasons:
- Mentor is not available at the requested time (user should reschedule)
- Booking is already paid (idempotent retry succeeded)

### Solution

```typescript
import { ConflictError, NotFoundError } from "../types/error.types";
import { BOOKING_CODES, NOT_FOUND_CODES } from "../constants/error-codes";

export class BookingService {
  async confirmBooking(
    bookingId: string,
    userId: string,
  ): Promise<ConfirmedBooking> {
    // Check if booking exists
    const booking = await this.getBookingById(bookingId);
    if (!booking) {
      throw new NotFoundError(
        "Booking",
        bookingId,
        NOT_FOUND_CODES.BOOKING_NOT_FOUND,
      );
    }

    // Check if already paid (idempotent operation)
    if (booking.paymentStatus === "PAID") {
      throw new ConflictError(
        BOOKING_CODES.ALREADY_PAID,
        "Booking is already paid",
        {
          bookingId,
          paidAt: booking.paidAt,
          paymentId: booking.paymentId,
        },
      );
    }

    // Check mentor availability
    const isMentorAvailable = await this.checkMentorAvailability(
      booking.mentorId,
      booking.scheduledAt,
      booking.durationMinutes,
    );

    if (!isMentorAvailable) {
      // Get available slots for the response
      const availableSlots = await this.getMentorAvailableSlots(
        booking.mentorId,
        booking.scheduledAt,
      );

      throw new ConflictError(
        BOOKING_CODES.MENTOR_UNAVAILABLE,
        "Mentor is not available at the requested time",
        {
          bookingId,
          mentorId: booking.mentorId,
          requestedTime: booking.scheduledAt,
          availableSlots,
        },
      );
    }

    // Process payment and confirm booking
    await this.processPayment(booking);
    return booking;
  }
}
```

### Client-Side Usage

```typescript
// Mobile app distinguishing between reschedule and idempotent retry
async function confirmBooking(bookingId: string) {
  try {
    const confirmedBooking = await api.post(`/bookings/${bookingId}/confirm`);
    showSuccessAlert("Booking confirmed!");
    navigateToSessionDetails(confirmedBooking);
  } catch (error) {
    const errorResponse = error.response?.data;

    switch (errorResponse?.code) {
      case "BOOKING_ALREADY_PAID":
        // Idempotent success - booking already confirmed
        showSuccessAlert("Booking already confirmed");
        navigateToSessionDetails(errorResponse.details?.booking);
        break;

      case "BOOKING_MENTOR_UNAVAILABLE":
        // Show reschedule UI with available slots
        showRescheduleModal({
          bookingId,
          availableSlots: errorResponse.details?.availableSlots,
        });
        break;

      case "AUTH_ACCOUNT_BANNED":
        navigateToAccountSuspendedScreen();
        break;

      default:
        showErrorAlert(errorResponse?.message || "Something went wrong");
    }
  }
}
```

## Example 2: Payment Service - Structured Error Details

### Problem
When a payment fails, the client needs to know:
- Why it failed (insufficient funds, currency not supported, rate quote expired)
- What action to take (add funds, try different currency, refresh quote)

### Solution

```typescript
import {
  AppError,
  ExternalServiceError,
  ValidationError,
} from "../types/error.types";
import {
  PAYMENT_CODES,
  VALIDATION_CODES,
  SERVICE_CODES,
} from "../constants/error-codes";

export class PaymentService {
  async initiatePayment(paymentRequest: PaymentRequest): Promise<Payment> {
    // Validate amount
    if (paymentRequest.amount <= 0) {
      throw new AppError(
        PAYMENT_CODES.INVALID_AMOUNT,
        "Payment amount must be greater than zero",
        { amount: paymentRequest.amount },
      );
    }

    // Check if currency is supported
    const assetDef = this.getAssetDefinition(paymentRequest.currency);
    if (!assetDef) {
      throw new AppError(
        PAYMENT_CODES.UNSUPPORTED_CURRENCY,
        `Currency ${paymentRequest.currency} is not supported`,
        {
          requestedCurrency: paymentRequest.currency,
          supportedCurrencies: Object.keys(this.assetRegistry),
        },
      );
    }

    // Get exchange rate quote
    const quote = await this.exchangeRateService.getQuote(
      "XLM",
      paymentRequest.currency,
      paymentRequest.amount,
    );

    if (!quote) {
      throw new AppError(
        PAYMENT_CODES.QUOTE_NOT_FOUND,
        "Exchange rate quote not available",
        {
          requestedAmount: paymentRequest.amount,
          currency: paymentRequest.currency,
          retryAfter: 5000, // Milliseconds before retry
        },
      );
    }

    if (quote.isExpired) {
      throw new AppError(
        PAYMENT_CODES.QUOTE_EXPIRED,
        "Exchange rate quote has expired",
        {
          quoteExpiresAt: quote.expiresAt,
          requestNewQuoteUrl: `/api/v1/exchange-rates/quote`,
        },
      );
    }

    // Check sufficient balance
    const wallet = await this.getWallet(paymentRequest.userId);
    const stellarBalance = await this.stellar.getBalance(
      wallet.stellarPublicKey,
    );

    if (stellarBalance < quote.amountToDeduct) {
      throw new AppError(
        PAYMENT_CODES.INSUFFICIENT_FUNDS,
        "Insufficient wallet balance",
        {
          currentBalance: stellarBalance,
          requiredAmount: quote.amountToDeduct,
          shortfall: quote.amountToDeduct - stellarBalance,
          topupUrl: "/api/v1/wallet/topup",
        },
      );
    }

    // Submit transaction to Stellar
    try {
      const txResult = await this.stellar.submitTransaction(
        paymentRequest.userId,
        quote,
      );
      return txResult;
    } catch (err: any) {
      throw new ExternalServiceError(
        "Stellar",
        SERVICE_CODES.EXTERNAL_API_ERROR,
        "Failed to submit payment transaction",
        err,
        {
          transactionHash: err.txHash,
          stellarErrorCode: err.errorCode,
          retryable: err.retryable ?? false,
        },
      );
    }
  }
}
```

### Client-Side Usage

```typescript
const PaymentFlow = () => {
  const [paymentState, setPaymentState] = useState("idle");
  const [errorDetails, setErrorDetails] = useState(null);

  const handlePayment = async (amount: number, currency: string) => {
    setPaymentState("loading");
    try {
      const result = await api.post("/payments", { amount, currency });
      setPaymentState("success");
      showSuccessMessage(`Payment of ${amount} ${currency} successful`);
    } catch (error) {
      const errorData = error.response?.data;

      switch (errorData?.code) {
        case "PAYMENT_INSUFFICIENT_FUNDS":
          setPaymentState("error");
          setErrorDetails({
            type: "insufficient_funds",
            shortfall: errorData.details.shortfall,
            action: "redirect_to_topup",
          });
          break;

        case "PAYMENT_UNSUPPORTED_CURRENCY":
          setPaymentState("error");
          setErrorDetails({
            type: "unsupported_currency",
            supported: errorData.details.supportedCurrencies,
            action: "show_supported_currencies",
          });
          break;

        case "PAYMENT_QUOTE_EXPIRED":
          setPaymentState("error");
          setErrorDetails({
            type: "quote_expired",
            action: "refresh_quote",
          });
          break;

        case "SERVICE_EXTERNAL_API_ERROR":
          if (errorData.details?.retryable) {
            setPaymentState("error");
            setErrorDetails({
              type: "transient_error",
              action: "retry_with_backoff",
            });
          } else {
            throw error; // Non-retryable
          }
          break;

        default:
          throw error;
      }
    }
  };

  return (
    <div>
      {paymentState === "error" && errorDetails && (
        <ErrorAlert 
          errorCode={errorDetails.type}
          details={errorDetails}
        />
      )}
    </div>
  );
};
```

## Example 3: Learning Path Service - Field-Level Validation Errors

### Problem
When validating enrollment requests, we need to communicate multiple validation failures at once.

### Solution

```typescript
import { ValidationError, NotFoundError } from "../types/error.types";
import { NOT_FOUND_CODES } from "../constants/error-codes";

export class EnrollmentService {
  async enrollStudent(
    studentId: string,
    learningPathId: string,
  ): Promise<Enrollment> {
    // Validate learning path exists
    const learningPath = await this.getLearningPath(learningPathId);
    if (!learningPath) {
      throw new NotFoundError(
        "Learning Path",
        learningPathId,
        NOT_FOUND_CODES.LEARNING_PATH_NOT_FOUND,
      );
    }

    // Validate student exists
    const student = await this.getStudent(studentId);
    if (!student) {
      throw new NotFoundError(
        "Student",
        studentId,
        NOT_FOUND_CODES.USER_NOT_FOUND,
      );
    }

    // Collect validation errors
    const fieldErrors: Record<string, string[]> = {};

    // Check if learning path is published
    if (learningPath.status !== "published") {
      fieldErrors.learningPathId = [
        "Learning path must be published before enrollment",
      ];
    }

    // Check if student is active
    if (student.status !== "active") {
      fieldErrors.studentId = ["Student account is not active"];
    }

    // Check prerequisites
    const unmetPrerequisites =
      await this.checkUnmetPrerequisites(studentId, learningPathId);
    if (unmetPrerequisites.length > 0) {
      fieldErrors.prerequisites = unmetPrerequisites.map(
        (p) => `Must complete "${p.title}" first`,
      );
    }

    // Throw validation error if any issues found
    if (Object.keys(fieldErrors).length > 0) {
      throw new ValidationError(
        fieldErrors,
        "Enrollment validation failed",
      );
    }

    // Proceed with enrollment
    return this.createEnrollment(studentId, learningPathId);
  }
}
```

### Response Format

```json
{
  "status": "error",
  "code": "VALIDATION_INVALID_INPUT",
  "message": "Enrollment validation failed",
  "requestId": "req_789xyz",
  "timestamp": "2026-07-27T13:11:24.952Z",
  "details": {
    "fieldErrors": {
      "learningPathId": [
        "Learning path must be published before enrollment"
      ],
      "studentId": [
        "Student account is not active"
      ],
      "prerequisites": [
        "Must complete \"Python Fundamentals\" first",
        "Must complete \"Data Structures\" first"
      ]
    }
  }
}
```

### Client-Side Usage

```typescript
const EnrollmentForm = () => {
  const [validationErrors, setValidationErrors] = useState({});

  const handleEnroll = async (studentId: string, pathId: string) => {
    try {
      await api.post("/enrollments", { studentId, pathId });
    } catch (error) {
      const errorData = error.response?.data;

      if (errorData?.code === "VALIDATION_INVALID_INPUT") {
        // Show field-level errors
        setValidationErrors(errorData.details?.fieldErrors || {});
      }
    }
  };

  return (
    <form onSubmit={() => handleEnroll(studentId, pathId)}>
      {validationErrors.learningPathId && (
        <ErrorMessage>{validationErrors.learningPathId[0]}</ErrorMessage>
      )}
      {validationErrors.prerequisites && (
        <PrerequisitesList items={validationErrors.prerequisites} />
      )}
    </form>
  );
};
```

## Example 4: Session Service - Business Logic Errors

### Problem
Multiple error conditions can occur when trying to link a session to a milestone:
- Session already linked to a different milestone
- Prerequisites not met
- Milestone not found
- Access denied

### Solution

```typescript
import {
  BusinessLogicError,
  NotFoundError,
  AppError,
} from "../types/error.types";
import {
  BUSINESS_CODES,
  NOT_FOUND_CODES,
} from "../constants/error-codes";

export class SessionMilestoneService {
  async linkSessionToMilestone(
    sessionId: string,
    milestoneId: string,
    userId: string,
  ): Promise<void> {
    // Check if session exists
    const session = await this.getSession(sessionId);
    if (!session) {
      throw new NotFoundError(
        "Session",
        sessionId,
        NOT_FOUND_CODES.SESSION_NOT_FOUND,
      );
    }

    // Check if milestone exists
    const milestone = await this.getMilestone(milestoneId);
    if (!milestone) {
      throw new NotFoundError(
        "Milestone",
        milestoneId,
        NOT_FOUND_CODES.MILESTONE_NOT_FOUND,
      );
    }

    // Check access - user must be mentor or student in the session
    const isAuthorized =
      session.mentorId === userId || session.studentId === userId;
    if (!isAuthorized) {
      throw new AppError(
        BUSINESS_CODES.ACCESS_DENIED,
        "You do not have permission to link this session",
        { sessionId, userId },
      );
    }

    // Check if session already linked
    const existingLink = await this.getSessionMilestoneLink(sessionId);
    if (existingLink && existingLink.milestoneId !== milestoneId) {
      throw new BusinessLogicError(
        BUSINESS_CODES.LINK_EXISTS,
        "Session is already linked to a different milestone",
        {
          sessionId,
          currentMilestoneId: existingLink.milestoneId,
          requestedMilestoneId: milestoneId,
        },
      );
    }

    // Check prerequisites
    const prerequisites = await this.getLearningPath(
      milestone.learningPathId,
    ).then((lp) => lp.getMilestonePrerequisites(milestone));

    const completedMilestones = await this.getCompletedMilestones(
      session.studentId,
      milestone.learningPathId,
    );

    const unmetPrerequisites = prerequisites.filter(
      (p) => !completedMilestones.some((cm) => cm.id === p.id),
    );

    if (unmetPrerequisites.length > 0) {
      throw new BusinessLogicError(
        BUSINESS_CODES.PREREQUISITES_NOT_MET,
        "Prerequisites not met for this milestone",
        {
          sessionId,
          milestoneId,
          unmetPrerequisites: unmetPrerequisites.map((p) => ({
            id: p.id,
            title: p.title,
          })),
        },
      );
    }

    // Create the link
    await this.createSessionMilestoneLink(sessionId, milestoneId);
  }
}
```

### Response Examples

**Session already linked to different milestone:**
```json
{
  "status": "error",
  "code": "BUSINESS_LINK_EXISTS",
  "message": "Session is already linked to a different milestone",
  "requestId": "req_123abc",
  "timestamp": "2026-07-27T13:11:24.952Z",
  "details": {
    "sessionId": "sess_789",
    "currentMilestoneId": "mile_100",
    "requestedMilestoneId": "mile_200"
  }
}
```

**Prerequisites not met:**
```json
{
  "status": "error",
  "code": "BUSINESS_PREREQUISITES_NOT_MET",
  "message": "Prerequisites not met for this milestone",
  "requestId": "req_456def",
  "timestamp": "2026-07-27T13:11:24.952Z",
  "details": {
    "sessionId": "sess_789",
    "milestoneId": "mile_200",
    "unmetPrerequisites": [
      {
        "id": "mile_100",
        "title": "Python Fundamentals"
      },
      {
        "id": "mile_110",
        "title": "Data Structures"
      }
    ]
  }
}
```

## Example 5: External Service Integration - Circuit Breaker

### Problem
When integrating with external services (Stellar, SendGrid, etc.), we need to:
- Distinguish between transient and permanent failures
- Report circuit breaker state
- Provide retry information

### Solution

```typescript
import {
  ExternalServiceError,
  AppError,
} from "../types/error.types";
import { SERVICE_CODES } from "../constants/error-codes";

export class StellarService {
  private circuitBreaker = new CircuitBreaker({
    name: "stellar-horizon",
    timeout: 5000,
    errorThresholdPercentage: 50,
    resetTimeout: 30000,
  });

  async submitTransaction(userId: string, txBlob: string): Promise<any> {
    try {
      const result = await this.circuitBreaker.execute(() =>
        this.horizon.submitTransaction(txBlob),
      );
      return result;
    } catch (err: any) {
      // Circuit breaker open
      if (err.name === "CircuitBreakerError") {
        throw new AppError(
          SERVICE_CODES.CIRCUIT_BREAKER_OPEN,
          "Stellar service temporarily unavailable",
          {
            service: "stellar-horizon",
            retryAfter: err.nextAttemptDelay,
            reason: "Rate limit or service issue",
          },
        );
      }

      // Timeout
      if (err.code === "ECONNABORTED") {
        throw new ExternalServiceError(
          "Stellar",
          SERVICE_CODES.TIMEOUT,
          "Request to Stellar timed out",
          err,
          { userId, timeout: this.circuitBreaker.timeout },
        );
      }

      // Stellar API error
      if (err.response?.status === 400) {
        // Bad request - permanent error
        throw new ExternalServiceError(
          "Stellar",
          SERVICE_CODES.EXTERNAL_API_ERROR,
          `Invalid transaction: ${err.response.data.detail}`,
          err,
          {
            userId,
            retryable: false,
            errorDetail: err.response.data,
          },
        );
      }

      if (err.response?.status >= 500) {
        // Server error - transient
        throw new ExternalServiceError(
          "Stellar",
          SERVICE_CODES.EXTERNAL_API_ERROR,
          "Stellar service error",
          err,
          {
            userId,
            retryable: true,
            httpStatus: err.response.status,
            backoffDelay: this.calculateBackoff(),
          },
        );
      }

      // Unknown error
      throw new ExternalServiceError(
        "Stellar",
        SERVICE_CODES.EXTERNAL_API_ERROR,
        "Failed to submit transaction",
        err,
        { userId, statusCode: err.response?.status },
      );
    }
  }

  private calculateBackoff(attempt: number = 1): number {
    // Exponential backoff: 1s, 2s, 4s, 8s, 16s (max)
    return Math.min(1000 * Math.pow(2, attempt - 1), 16000);
  }
}
```

### Client-Side Usage

```typescript
const submitPaymentWithRetry = async (
  paymentData: PaymentData,
  maxRetries = 3
) => {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await api.post("/payments", paymentData);
    } catch (error) {
      const errorData = error.response?.data;

      if (
        errorData?.code === "SERVICE_EXTERNAL_API_ERROR" &&
        errorData.details?.retryable
      ) {
        if (attempt < maxRetries) {
          const delay = errorData.details?.backoffDelay || 1000 * attempt;
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue; // Retry
        }
      }

      throw error; // Non-retryable or exhausted retries
    }
  }
};
```

## Testing Error Scenarios

```typescript
describe("BookingService - Error Handling", () => {
  describe("confirmBooking", () => {
    it("should throw BOOKING_NOT_FOUND when booking does not exist", async () => {
      const bookingService = new BookingService(mockDb);

      await expect(
        bookingService.confirmBooking("nonexistent_id", userId)
      ).rejects.toThrow(NotFoundError);

      // Verify error details
      try {
        await bookingService.confirmBooking("nonexistent_id", userId);
      } catch (err: any) {
        expect(err.code).toBe(NOT_FOUND_CODES.BOOKING_NOT_FOUND);
        expect(err.statusCode).toBe(404);
        expect(err.details).toEqual({
          resourceType: "Booking",
          resourceId: "nonexistent_id",
        });
      }
    });

    it("should throw BOOKING_ALREADY_PAID for idempotent retry", async () => {
      const bookingService = new BookingService(mockDb);
      const bookingId = "booking_123";

      // First confirm succeeds
      await bookingService.confirmBooking(bookingId, userId);

      // Second confirm returns idempotent error
      await expect(
        bookingService.confirmBooking(bookingId, userId)
      ).rejects.toThrow(ConflictError);

      try {
        await bookingService.confirmBooking(bookingId, userId);
      } catch (err: any) {
        expect(err.code).toBe(BOOKING_CODES.ALREADY_PAID);
        expect(err.statusCode).toBe(409);
      }
    });

    it("should throw BOOKING_MENTOR_UNAVAILABLE with available slots", async () => {
      const bookingService = new BookingService(mockDb);

      await expect(
        bookingService.confirmBooking(bookingId, userId)
      ).rejects.toThrow(ConflictError);

      try {
        await bookingService.confirmBooking(bookingId, userId);
      } catch (err: any) {
        expect(err.code).toBe(BOOKING_CODES.MENTOR_UNAVAILABLE);
        expect(err.details).toHaveProperty("availableSlots");
        expect(Array.isArray(err.details.availableSlots)).toBe(true);
      }
    });
  });
});
```
