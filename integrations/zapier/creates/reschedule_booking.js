const perform = async (z, bundle) => {
  const baseUrl = bundle.authData.base_url || process.env.MM_API_BASE || 'http://localhost:3000';
  const resp = await z.request({
    method: 'PATCH',
    url: `${baseUrl}/v1/bookings/${bundle.inputData.booking_id}/reschedule`,
    headers: { Authorization: `Bearer ${bundle.authData.api_key}` },
    json: {
      scheduled_at: bundle.inputData.scheduled_at,
    },
  });
  return resp.data;
};

module.exports = {
  key: 'reschedule_booking',
  noun: 'Booking',
  display: {
    label: 'Reschedule Booking',
    description: 'Reschedule an existing booking to a new time.',
  },
  operation: {
    inputFields: [
      { key: 'booking_id', required: true, label: 'Booking ID' },
      { key: 'scheduled_at', required: true, label: 'New Start Time (ISO 8601)', type: 'datetime' },
    ],
    perform,
    sample: {
      id: 'booking-1',
      status: 'confirmed',
      scheduled_at: new Date().toISOString(),
    },
  },
};
