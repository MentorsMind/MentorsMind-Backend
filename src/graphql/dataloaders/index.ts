import DataLoader from 'dataloader';
import { BookingModel, BookingRecord } from '../../models/booking.model';
import { PaymentModel, Payment } from '../../models/payment.model';
import { ReviewModel, Review } from '../../models/review.model';
import { UsersService } from '../../services/users.service';
import { MentorsService, MentorRecord } from '../../services/mentors.service';
import { PublicUserRecord } from '../../services/users.service';

export interface GraphQLLoaders {
  userLoader: DataLoader<string, PublicUserRecord | null>;
  mentorLoader: DataLoader<string, MentorRecord | null>;
  bookingLoader: DataLoader<string, BookingRecord[]>;
  paymentLoader: DataLoader<string, Payment[]>;
  reviewLoader: DataLoader<string, Review[]>;
}

export const createLoaders = (): GraphQLLoaders => ({
  userLoader: new DataLoader<string, PublicUserRecord | null>(async (ids) => {
    const results = await Promise.all(ids.map((id) => UsersService.findPublicById(id)));
    return results;
  }),

  mentorLoader: new DataLoader<string, MentorRecord | null>(async (ids) => {
    const results = await Promise.all(ids.map((id) => MentorsService.findById(id)));
    return results;
  }),

  bookingLoader: new DataLoader<string, BookingRecord[]>(async (ids) => {
    const results = await Promise.all(ids.map((id) => BookingModel.findByUserId(id).then((result) => result.bookings)));
    return results;
  }),

  paymentLoader: new DataLoader<string, Payment[]>(async (ids) => {
    const results = await Promise.all(ids.map((id) => PaymentModel.findByUserId(id)));
    return results;
  }),

  reviewLoader: new DataLoader<string, Review[]>(async (ids) => {
    const results = await Promise.all(ids.map((id) => ReviewModel.findByUserId(id)));
    return results;
  }),
});
