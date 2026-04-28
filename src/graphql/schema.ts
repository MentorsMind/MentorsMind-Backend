import { gql } from "@apollo/server";

const typeDefs = gql`
  enum BookingStatus {
    PENDING
    CONFIRMED
    COMPLETED
    CANCELLED
    RESCHEDULED
  }

  enum PaymentStatus {
    PENDING
    COMPLETED
    FAILED
  }

  enum PaymentType {
    PAYMENT
    REFUND
    PLATFORM_FEE
    MENTOR_PAYOUT
    ESCROW_HOLD
    ESCROW_RELEASE
  }

  enum MentorSortBy {
    CREATED_AT
    HOURLY_RATE
    AVERAGE_RATING
    TOTAL_SESSIONS
  }

  enum SortOrder {
    ASC
    DESC
  }

  input MentorFilterInput {
    search: String
    expertise: String
    minRate: Float
    maxRate: Float
    isAvailable: Boolean
  }

  input PaginationInput {
    cursor: String
    limit: Int = 10
  }

  type Query {
    me: User
    user(id: ID!): User
    mentor(id: ID!): Mentor
    mentors(
      filter: MentorFilterInput
      cursor: String
      limit: Int = 10
      sortBy: MentorSortBy = CREATED_AT
      sortOrder: SortOrder = DESC
    ): MentorConnection

    booking(id: ID!): Booking
    bookings(
      status: BookingStatus
      cursor: String
      limit: Int = 10
    ): BookingListResult

    payment(id: ID!): Payment
    payments(
      status: PaymentStatus
      type: PaymentType
      cursor: String
      limit: Int = 10
    ): PaymentListResult
  }

  type User {
    id: ID!
    role: String!
    firstName: String!
    lastName: String!
    bio: String
    avatarUrl: String
    wallet: Wallet
    bookings(
      status: BookingStatus
      cursor: String
      limit: Int = 10
    ): BookingListResult
    payments: [Payment!]!
    reviews: [Review!]!
  }

  type Mentor {
    id: ID!
    role: String!
    firstName: String!
    lastName: String!
    bio: String
    avatarUrl: String
    hourlyRate: Float
    expertise: [String!]
    yearsOfExperience: Int
    availabilitySchedule: String
    isAvailable: Boolean
    timezone: String
    averageRating: Float
    totalSessionsCompleted: Int
    totalReviews: Int
    kycVerified: Boolean
    wallet: Wallet
    bookings(
      status: BookingStatus
      cursor: String
      limit: Int = 10
    ): BookingListResult
    payments: [Payment!]!
    reviews: [Review!]!
  }

  type Wallet {
    id: ID!
    stellarPublicKey: String!
    status: String!
    createdAt: String!
    lastActivity: String
  }

  type Booking {
    id: ID!
    menteeId: ID!
    mentorId: ID!
    topic: String!
    notes: String
    scheduledAt: String!
    durationMinutes: Int!
    status: BookingStatus!
    amount: String!
    currency: String!
    paymentStatus: String!
    stellarTxHash: String
    cancellationReason: String
    createdAt: String!
    updatedAt: String!
    mentee: User
    mentor: Mentor
  }

  type BookingListResult {
    bookings: [Booking!]!
    total: Int!
    nextCursor: String
    hasMore: Boolean!
  }

  type Payment {
    id: ID!
    userId: ID!
    amount: String!
    currency: String!
    status: String!
    transactionHash: String
    createdAt: String!
  }

  type PaymentListResult {
    payments: [Payment!]!
    total: Int!
    nextCursor: String
    hasMore: Boolean!
  }

  type MentorEdge {
    node: Mentor!
    cursor: String!
  }

  type PageInfo {
    hasNextPage: Boolean!
    endCursor: String
  }

  type MentorConnection {
    edges: [MentorEdge!]!
    pageInfo: PageInfo!
    total: Int!
  }

  type MentorListResult {
    mentors: [Mentor!]!
    total: Int!
    nextCursor: String
    hasMore: Boolean!
  }

  type Review {
    id: ID!
    sessionId: ID!
    reviewer: User!
    reviewee: User!
    rating: Int!
    comment: String
    createdAt: String!
  }
`;

export default typeDefs;
