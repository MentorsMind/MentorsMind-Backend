import { GraphQLError } from 'graphql';
import { Request, Response } from 'express';

export class ApolloError extends GraphQLError {
  constructor(message: string, code?: string) {
    super(message, { extensions: { code } });
  }
}

export class AuthenticationError extends GraphQLError {
  constructor(message: string) {
    super(message, { extensions: { code: 'UNAUTHENTICATED' } });
  }
}
import { BookingsService } from '../../services/bookings.service';
import { MentorsService } from '../../services/mentors.service';
import type { MentorRecord } from '../../services/mentors.service';
import { PaymentsService } from '../../services/payments.service';
import { UsersService } from '../../services/users.service';
import { GraphQLLoaders } from '../dataloaders';
import { PaginationUtil } from '../../utils/pagination.utils';

interface GraphQLContext {
  req: Request;
  res: Response;
  user?: { userId: string; role: string };
  loaders: GraphQLLoaders;
}

const toDatabaseBookingStatus = (status?: string) => status?.toLowerCase();

type MentorSortBy = 'CREATED_AT' | 'HOURLY_RATE' | 'AVERAGE_RATING' | 'TOTAL_SESSIONS';
type SortOrder = 'ASC' | 'DESC';
type ServiceMentorSortBy = 'createdAt' | 'hourlyRate' | 'averageRating' | 'totalSessions';
type ServiceSortOrder = 'asc' | 'desc';

const mentorSortByMap: Record<MentorSortBy, ServiceMentorSortBy> = {
  CREATED_AT: 'createdAt',
  HOURLY_RATE: 'hourlyRate',
  AVERAGE_RATING: 'averageRating',
  TOTAL_SESSIONS: 'totalSessions',
};

const mentorSortOrderMap: Record<SortOrder, ServiceSortOrder> = {
  ASC: 'asc',
  DESC: 'desc',
};

const getMentorSortValue = (
  mentor: MentorRecord,
  sortBy: ServiceMentorSortBy,
): number | null | undefined =>
  sortBy === 'hourlyRate'
    ? mentor.hourly_rate
    : sortBy === 'averageRating'
      ? mentor.average_rating
      : sortBy === 'totalSessions'
        ? mentor.total_sessions_completed
        : undefined;

const resolvers = {
  Query: {
    me: async (_parent: unknown, _args: unknown, context: GraphQLContext) => {
      if (!context.user) {
        throw new AuthenticationError('Authentication required');
      }
      const user = await UsersService.findById(context.user.userId);
      return {
        ...user,
        mfaEnabled: (user as any).mfa_enabled ?? false,
      };
    },

    user: async (_parent: unknown, args: { id: string }, _context: GraphQLContext) => {
      const user = await UsersService.findPublicById(args.id);
      if (!user) {
        throw new ApolloError('User not found', 'BAD_USER_INPUT');
      }
      return user;
    },

    mentor: async (_parent: unknown, args: { id: string }, _context: GraphQLContext) => {
      const mentor = await MentorsService.findById(args.id);
      if (!mentor) {
        throw new ApolloError('Mentor not found', 'BAD_USER_INPUT');
      }
      return mentor;
    },

    mentors: async (
      _parent: unknown,
      args: {
        filter?: {
          search?: string;
          expertise?: string;
          minRate?: number;
          maxRate?: number;
          isAvailable?: boolean;
          sortBy?: MentorSortBy;
          sortOrder?: SortOrder;
        };
        cursor?: string;
        limit?: number;
        sortBy?: MentorSortBy;
        sortOrder?: SortOrder;
      },
    ) => {
      const { filter = {}, cursor, limit = 10 } = args;
      const sortBy = filter.sortBy ?? args.sortBy ?? 'CREATED_AT';
      const sortOrder = filter.sortOrder ?? args.sortOrder ?? 'DESC';
      const serviceSortBy = mentorSortByMap[sortBy];
      const serviceSortOrder = mentorSortOrderMap[sortOrder];
      const result = await MentorsService.list({
        cursor,
        limit,
        search: filter.search,
        expertise: filter.expertise ? [filter.expertise] : undefined,
        minRate: filter.minRate,
        maxRate: filter.maxRate,
        isAvailable: filter.isAvailable,
        sortBy: serviceSortBy,
        sortOrder: serviceSortOrder,
      });

      return {
        edges: result.mentors.map((mentor) => {
          const sortValue = getMentorSortValue(mentor, serviceSortBy);
          return {
            node: mentor,
            cursor: PaginationUtil.encodeCursor({
              id: mentor.id,
              created_at: mentor.created_at.toISOString(),
              sort_by: serviceSortBy,
              sort_order: serviceSortOrder,
              ...(sortValue !== undefined ? { sort_value: sortValue } : {}),
            }),
          };
        }),
        pageInfo: {
          hasNextPage: result.has_more,
          endCursor: result.next_cursor,
        },
        total: result.total,
      };
    },

    booking: async (_parent: unknown, args: { id: string }, context: GraphQLContext) => {
      if (!context.user) {
        throw new AuthenticationError('Authentication required');
      }
      return BookingsService.getBookingById(args.id, context.user.userId);
    },

    bookings: async (
      _parent: unknown,
      args: { status?: string; cursor?: string | null; limit?: number },
      context: GraphQLContext,
    ) => {
      if (!context.user) {
        throw new AuthenticationError('Authentication required');
      }
      if (args.cursor !== undefined && args.cursor !== null) {
        const cursor = PaginationUtil.decodeCursor(args.cursor);
        if (
          !cursor ||
          typeof cursor.id !== 'string' ||
          typeof cursor.created_at !== 'string' ||
          !Number.isFinite(Date.parse(cursor.created_at))
        ) {
          throw new ApolloError('Invalid booking cursor', 'BAD_USER_INPUT');
        }
      }
      return BookingsService.getUserBookings(context.user.userId, {
        status: toDatabaseBookingStatus(args.status),
        cursor: args.cursor,
        limit: args.limit,
      });
    },

    payment: async (_parent: unknown, args: { id: string }, context: GraphQLContext) => {
      if (!context.user) {
        throw new AuthenticationError('Authentication required');
      }
      return PaymentsService.getPaymentById(args.id, context.user.userId);
    },

    payments: async (
      _parent: unknown,
      args: { status?: string; type?: string; cursor?: string; limit?: number },
      context: GraphQLContext,
    ) => {
      if (!context.user) {
        throw new AuthenticationError('Authentication required');
      }
      return PaymentsService.listUserPayments(context.user.userId, {
        status: args.status as any,
        type: args.type as any,
        cursor: args.cursor,
        limit: args.limit,
      });
    },
  },

  User: {
    firstName: (parent: any) => parent.first_name,
    lastName: (parent: any) => parent.last_name,
    avatarUrl: (parent: any) => parent.avatar_url,
    wallet: async (parent: any, _args: unknown, context: GraphQLContext) => {
      if (!context.user || context.user.userId !== parent.id) {
        return null;
      }
      return context.loaders.walletLoader.load(parent.id);
    },
    bookings: async (parent: any, args: { status?: string; cursor?: string; limit?: number }, context: GraphQLContext) => {
      if (!context.user || context.user.userId !== parent.id) {
        throw new AuthenticationError('Unauthorized');
      }
      // Filtered/paginated bookings can't be served from the batch loader —
      // only the unfiltered default view benefits from N+1 batching.
      if (args.status || args.cursor || args.limit) {
        return BookingsService.getUserBookings(parent.id, {
          status: toDatabaseBookingStatus(args.status),
          cursor: args.cursor,
          limit: args.limit,
        });
      }
      return context.loaders.bookingLoader.load(parent.id);
    },
    payments: async (parent: any, _args: unknown, context: GraphQLContext) => {
      if (!context.user || context.user.userId !== parent.id) {
        throw new AuthenticationError('Unauthorized');
      }
      return context.loaders.paymentLoader.load(parent.id);
    },
    reviews: async (parent: any, _args: unknown, context: GraphQLContext) => {
      return context.loaders.reviewLoader.load(parent.id);
    },
  },

  Mentor: {
    firstName: (parent: any) => parent.first_name,
    lastName: (parent: any) => parent.last_name,
    avatarUrl: (parent: any) => parent.avatar_url,
    hourlyRate: (parent: any) => parent.hourly_rate,
    yearsOfExperience: (parent: any) => parent.years_of_experience,
    availabilitySchedule: (parent: any) =>
      typeof parent.availability_schedule === 'string'
        ? parent.availability_schedule
        : JSON.stringify(parent.availability_schedule || {}),
    isAvailable: (parent: any) => parent.is_available,
    totalSessionsCompleted: (parent: any) => parent.total_sessions_completed,
    totalReviews: (parent: any) => parent.total_reviews,
    kycVerified: (parent: any) => parent.kyc_verified,
    wallet: async (parent: any, _args: unknown, context: GraphQLContext) => {
      if (!context.user || context.user.userId !== parent.id) {
        return null;
      }
      return context.loaders.walletLoader.load(parent.id);
    },
    bookings: async (parent: any, args: { status?: string; cursor?: string; limit?: number }, context: GraphQLContext) => {
      if (!context.user || context.user.userId !== parent.id) {
        throw new AuthenticationError('Unauthorized');
      }
      if (args.status || args.cursor || args.limit) {
        return BookingsService.getUserBookings(parent.id, {
          status: toDatabaseBookingStatus(args.status),
          cursor: args.cursor,
          limit: args.limit,
        });
      }
      return context.loaders.bookingLoader.load(parent.id);
    },
    payments: async (parent: any, _args: unknown, context: GraphQLContext) => {
      if (!context.user || context.user.userId !== parent.id) {
        throw new AuthenticationError('Unauthorized');
      }
      return context.loaders.paymentLoader.load(parent.id);
    },
    reviews: async (parent: any, _args: unknown, context: GraphQLContext) => {
      return context.loaders.reviewLoader.load(parent.id);
    },
  },

  Booking: {
    menteeId: (parent: any) => parent.mentee_id,
    mentorId: (parent: any) => parent.mentor_id,
    durationMinutes: (parent: any) => parent.duration_minutes,
    /**
     * Maps the lowercase DB status values (e.g. "no_show", "rescheduled")
     * to the uppercase GraphQL BookingStatus enum values. Falls back to
     * the raw value uppercased so any future DB statuses surface visibly
     * rather than returning null.
     */
    status: (parent: any) => {
      const STATUS_MAP: Record<string, string> = {
        pending: 'PENDING',
        confirmed: 'CONFIRMED',
        completed: 'COMPLETED',
        cancelled: 'CANCELLED',
        rescheduled: 'RESCHEDULED',
        no_show: 'NO_SHOW',
      };
      const raw: string = parent.status ?? '';
      return STATUS_MAP[raw.toLowerCase()] ?? raw.toUpperCase();
    },
    paymentStatus: (parent: any) => parent.payment_status,
    stellarTxHash: (parent: any) => parent.stellar_tx_hash,
    cancellationReason: (parent: any) => parent.cancellation_reason,
    createdAt: (parent: any) => parent.created_at?.toISOString(),
    updatedAt: (parent: any) => parent.updated_at?.toISOString(),
    mentee: async (parent: any, _args: unknown, context: GraphQLContext) => {
      return context.loaders.userLoader.load(parent.mentee_id);
    },
    mentor: async (parent: any, _args: unknown, context: GraphQLContext) => {
      return context.loaders.mentorLoader.load(parent.mentor_id);
    },
  },

  Payment: {
    userId: (parent: any) => parent.user_id,
    transactionHash: (parent: any) => parent.transaction_hash,
    amount: (parent: any) => parent.amount?.toString(),
    createdAt: (parent: any) => parent.created_at?.toISOString(),
  },

  Review: {
    sessionId: (parent: any) => parent.session_id,
    reviewer: async (parent: any, _args: unknown, context: GraphQLContext) => {
      return context.loaders.userLoader.load(parent.reviewer_id);
    },
    reviewee: async (parent: any, _args: unknown, context: GraphQLContext) => {
      return context.loaders.userLoader.load(parent.reviewee_id);
    },
    createdAt: (parent: any) => parent.created_at?.toISOString(),
  },
};

export default resolvers;
