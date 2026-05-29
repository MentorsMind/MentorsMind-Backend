import { v4 as uuidv4 } from "uuid";

// Base Event Interface
export interface DomainEvent<T = any> {
  id: string;
  type: string;
  aggregateId: string;
  aggregateType: string;
  data: T;
  metadata: {
    occurredAt: Date;
    correlationId: string;
    causationId?: string;
    userId?: string;
    serviceName: string;
    version: number;
  };
}

// Event Types Enum
export enum EventTypes {
  USER_CREATED = "user.created",
  USER_UPDATED = "user.updated",
  USER_DELETED = "user.deleted",
  BOOKING_CREATED = "booking.created",
  BOOKING_UPDATED = "booking.updated",
  BOOKING_CANCELLED = "booking.cancelled",
  BOOKING_COMPLETED = "booking.completed",
  PAYMENT_INITIATED = "payment.initiated",
  PAYMENT_SUCCEEDED = "payment.succeeded",
  PAYMENT_FAILED = "payment.failed",
  NOTIFICATION_SENT = "notification.sent",
  SESSION_STARTED = "session.started",
  SESSION_ENDED = "session.ended",
}

// Event Data Interfaces
export interface UserCreatedEventData {
  userId: string;
  email: string;
  name: string;
  role: string;
}

export interface BookingCreatedEventData {
  bookingId: string;
  mentorId: string;
  learnerId: string;
  startTime: Date;
  endTime: Date;
  price: number;
  currency: string;
}

export interface PaymentInitiatedEventData {
  paymentId: string;
  bookingId: string;
  amount: number;
  currency: string;
  userId: string;
}

export interface PaymentSucceededEventData {
  paymentId: string;
  bookingId: string;
  amount: number;
  currency: string;
  transactionId: string;
}

export interface PaymentFailedEventData {
  paymentId: string;
  bookingId: string;
  amount: number;
  currency: string;
  failureReason: string;
}

export interface NotificationSentEventData {
  notificationId: string;
  userId: string;
  type: string;
  channel: string;
  message: any;
}

// Event Factory
export class EventFactory {
  static create<T>(
    type: string,
    aggregateId: string,
    aggregateType: string,
    data: T,
    metadata: Omit<DomainEvent<T>["metadata"], "occurredAt" | "id">
  ): DomainEvent<T> {
    return {
      id: uuidv4(),
      type,
      aggregateId,
      aggregateType,
      data,
      metadata: {
        ...metadata,
        occurredAt: new Date(),
      },
    };
  }

  static userCreated(data: UserCreatedEventData, metadata: Omit<DomainEvent["metadata"], "occurredAt" | "id">): DomainEvent<UserCreatedEventData> {
    return this.create(EventTypes.USER_CREATED, data.userId, "user", data, metadata);
  }

  static bookingCreated(data: BookingCreatedEventData, metadata: Omit<DomainEvent["metadata"], "occurredAt" | "id">): DomainEvent<BookingCreatedEventData> {
    return this.create(EventTypes.BOOKING_CREATED, data.bookingId, "booking", data, metadata);
  }

  static paymentInitiated(data: PaymentInitiatedEventData, metadata: Omit<DomainEvent["metadata"], "occurredAt" | "id">): DomainEvent<PaymentInitiatedEventData> {
    return this.create(EventTypes.PAYMENT_INITIATED, data.paymentId, "payment", data, metadata);
  }

  static paymentSucceeded(data: PaymentSucceededEventData, metadata: Omit<DomainEvent["metadata"], "occurredAt" | "id">): DomainEvent<PaymentSucceededEventData> {
    return this.create(EventTypes.PAYMENT_SUCCEEDED, data.paymentId, "payment", data, metadata);
  }

  static paymentFailed(data: PaymentFailedEventData, metadata: Omit<DomainEvent["metadata"], "occurredAt" | "id">): DomainEvent<PaymentFailedEventData> {
    return this.create(EventTypes.PAYMENT_FAILED, data.paymentId, "payment", data, metadata);
  }
}
