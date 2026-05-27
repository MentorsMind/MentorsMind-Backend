const zapier = require('zapier-platform-core');

const authentication = require('./authentication');

const NewBookingTrigger = require('./triggers/new_booking');
const PaymentReceivedTrigger = require('./triggers/payment_received');
const DisputeOpenedTrigger = require('./triggers/dispute_opened');

const CreateUser = require('./creates/create_user');
const SendEmail = require('./creates/send_email');
const UpdatePaymentStatus = require('./creates/update_payment_status');

module.exports = {
  version: require('./package.json').version,
  platformVersion: zapier.version,

  authentication,

  triggers: {
    new_booking: NewBookingTrigger,
    payment_received: PaymentReceivedTrigger,
    dispute_opened: DisputeOpenedTrigger,
  },

  creates: {
    create_user: CreateUser,
    send_email: SendEmail,
    update_payment_status: UpdatePaymentStatus,
  },
};
