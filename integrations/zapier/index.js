const zapier = require('zapier-platform-core');

const authentication = require('./authentication');

// Triggers
const NewBookingTrigger = require('./triggers/new_booking');
const PaymentReceivedTrigger = require('./triggers/payment_received');
const DisputeOpenedTrigger = require('./triggers/dispute_opened');
const SessionCompletedTrigger = require('./triggers/session_completed');
const BookingCancelledTrigger = require('./triggers/booking_cancelled');
const ReviewReceivedTrigger = require('./triggers/review_received');
const PaymentRefundedTrigger = require('./triggers/payment_refunded');
const MilestoneAchievedTrigger = require('./triggers/milestone_achieved');

// Creates
const CreateUser = require('./creates/create_user');
const SendEmail = require('./creates/send_email');
const UpdatePaymentStatus = require('./creates/update_payment_status');
const RescheduleBooking = require('./creates/reschedule_booking');
const CreateNote = require('./creates/create_note');

module.exports = {
  version: require('./package.json').version,
  platformVersion: zapier.version,

  authentication,

  triggers: {
    new_booking: NewBookingTrigger,
    payment_received: PaymentReceivedTrigger,
    dispute_opened: DisputeOpenedTrigger,
    session_completed: SessionCompletedTrigger,
    booking_cancelled: BookingCancelledTrigger,
    review_received: ReviewReceivedTrigger,
    payment_refunded: PaymentRefundedTrigger,
    milestone_achieved: MilestoneAchievedTrigger,
  },

  creates: {
    create_user: CreateUser,
    send_email: SendEmail,
    update_payment_status: UpdatePaymentStatus,
    reschedule_booking: RescheduleBooking,
    create_note: CreateNote,
  },
};
