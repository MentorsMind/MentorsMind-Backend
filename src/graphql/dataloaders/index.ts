import DataLoader from "dataloader";
import { BookingModel, BookingRecord } from "../../models/booking.model";
import { PaymentModel, Payment } from "../../models/payment.model";
import { ReviewModel, Review } from "../../models/review.model";
import { UsersService } from "../../services/users.service";
import { MentorsService, MentorRecord } from "../../services/mentors.service";
import { PublicUserRecord } from "../../services/users.service";

export interface GraphQLLoaders {
  userLoader: DataLoader<string, PublicUserRecord | null>;
  mentorLoader: DataLoader<string, MentorRecord | null>;
  bookingLoader: DataLoader<string, BookingRecord[]>;
  paymentLoader: DataLoader<string, Payment[]>;
  reviewLoader: DataLoader<string, Review[]>;
}

export const createLoaders = (): GraphQLLoaders => ({
  userLoader: new DataLoader<string, PublicUserRecord | null>(async (ids) => {
    // UsersService currently only exposes single-id fetch.
    // Keeping as-is (batch still provides deduplication per request).
    const results = await Promise.all(
      ids.map((id) => UsersService.findPublicById(id)),
    );
    return results;
  }),

  mentorLoader: new DataLoader<string, MentorRecord | null>(async (ids) => {
    const results = await Promise.all(
      ids.map((id) => MentorsService.findById(id)),
    );
    return results;
  }),

  bookingLoader: new DataLoader<string, BookingRecord[]>(async (ids) => {
    // Bulk fetch bookings per user is non-trivial because BookingModel.findByUserId is a single-id query
    // that applies (mentee_id = $1 OR mentor_id = $1). For now we keep per-id calls.
    // This is still better than raw resolvers because DataLoader batches at the GraphQL field layer.
    const results = await Promise.all(
      ids.map((id) => BookingModel.findByUserId(id).then((r) => r.bookings)),
    );
    return results;
  }),

  paymentLoader: new DataLoader<string, Payment[]>(async (ids) => {
    const uniqueIds = Array.from(new Set(ids));
    const rows = await PaymentModel.findByUserIds(uniqueIds);

    const grouped: Record<string, Payment[]> = Object.create(null);
    for (const id of uniqueIds) grouped[id] = [];
    for (const row of rows) {
      if (typeof row.user_id === "string" && grouped[row.user_id]) {
        grouped[row.user_id].push(row);
      }
    }

    return ids.map((id) => grouped[id] ?? []);
  }),

  reviewLoader: new DataLoader<string, Review[]>(async (ids) => {
    const uniqueIds = Array.from(new Set(ids));
    const rows = await ReviewModel.findByUserIds(uniqueIds);

    const grouped: Record<string, Review[]> = Object.create(null);
    for (const id of uniqueIds) grouped[id] = [];

    for (const row of rows) {
      // A review can match as either reviewer_id or reviewee_id.
      if (typeof row.reviewer_id === "string" && grouped[row.reviewer_id]) {
        grouped[row.reviewer_id].push(row);
      }
      if (typeof row.reviewee_id === "string" && grouped[row.reviewee_id]) {
        grouped[row.reviewee_id].push(row);
      }
    }

    // Keep ordering consistent with requested ids.
    return ids.map((id) => grouped[id] ?? []);
  }),
});
