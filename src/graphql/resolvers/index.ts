import { ApolloError } from '@apollo/server';
import { AuthenticationError } from '@apollo/server/errors';
import { Request, Response } from 'express';
import { BookingsService } from '../../services/bookings.service';
import { MentorsService } from '../../services/mentors.service';
import { PaymentsService } from '../../services/payments.service';
import { UsersService } from '../../services/users.service';
import { WalletsService } from '../../services/wallets.service';
import { GraphQLLoaders } from '../dataloaders';

interface GraphQLContext {
  req: Request;
  res: Response;
  user?: { userId: string; role: string };
  loaders: GraphQLLoaders;
}


const resolvers = {
  Query: {
    me: async (_parent: unknown, _args: unknown, context: GraphQLContext) => {
      if (!context.user) {
        throw new AuthenticationError('Authentication required');
      }
      return UsersService.findById(context.user.userId);
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
        };
        page?: number;
        limit?: number;
        sortBy?: string;
        sortOrder?: string;
      },
    ) => {
      const { filter = {}, page = 1, limit = 10, sortBy = 'createdAt', sortOrder = 'desc' } = args;
      return MentorsService.list({
        page,
        limit,
        search: filter.search,
        expertise: filter.expertise,
        minRate: filter.minRate,
        maxRate: filter.maxRate,
        isAvailable: filter.isAvailable,
        sortBy: sortBy as any,
        sortOrder: sortOrder as any,
      });
    },

    booking: async (_parent: unknown, args: { id: string }, context: GraphQLContext) => {
      if (!context.user) {
        throw new AuthenticationError('Authentication required');
      }
      return BookingsService.getBookingById(args.id, context.user.userId);
    },

    bookings: async (
      _parent: unknown,
      args: { status?: string; page?: number; limit?: number },
      context: GraphQLContext,
    ) => {
      if (!context.user) {
        throw new AuthenticationError('Authentication required');
      }
      return BookingsService.getUserBookings(context.user.userId, {
        status: args.status,
        page: args.page,
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
      args: { status?: string; type?: string; page?: number; limit?: number },
      context: GraphQLContext,
    ) => {
      if (!context.user) {
        throw new AuthenticationError('Authentication required');
      }
      return PaymentsService.listUserPayments(context.user.userId, {
        status: args.status,
        type: args.type as any,
        page: args.page,
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
      return WalletsService.getWalletInfo(parent.id);
    },
    bookings: async (parent: any, args: { status?: string; page?: number; limit?: number }, context: GraphQLContext) => {
      if (!context.user || context.user.userId !== parent.id) {
        throw new AuthenticationError('Unauthorized');
      }
      return BookingsService.getUserBookings(parent.id, {
        status: args.status,
        page: args.page,
        limit: args.limit,
      });
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
      return WalletsService.getWalletInfo(parent.id);
    },
    bookings: async (parent: any, args: { status?: string; page?: number; limit?: number }, context: GraphQLContext) => {
      if (!context.user || context.user.userId !== parent.id) {
        throw new AuthenticationError('Unauthorized');
      }
      return BookingsService.getUserBookings(parent.id, {
        status: args.status,
        page: args.page,
        limit: args.limit,
      });
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
