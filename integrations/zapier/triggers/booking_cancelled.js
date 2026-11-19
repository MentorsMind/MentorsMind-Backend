const perform = async (z, bundle) => {
  const baseUrl = bundle.authData.base_url || process.env.MM_API_BASE || 'http://localhost:3000';
  const since = bundle.meta && bundle.meta.last_poll ? bundle.meta.last_poll : new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString();

  const resp = await z.request({
    url: `${baseUrl}/v1/bookings`,
    params: { since, status: 'cancelled' },
    headers: { Authorization: `Bearer ${bundle.authData.api_key}` },
  });

  return resp.data || [];
};

module.exports = {
  key: 'booking_cancelled',
  noun: 'Booking',
  display: {
    label: 'Booking Cancelled',
    description: 'Triggers when a booking is cancelled.',
  },
  operation: {
    perform,
    sample: {
      id: 'booking-1',
      mentor_id: 'm1',
      mentee_id: 'u1',
      status: 'cancelled',
      cancelled_at: new Date().toISOString(),
    },
  },
};
