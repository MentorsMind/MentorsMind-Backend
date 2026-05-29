const perform = async (z, bundle) => {
  const baseUrl = bundle.authData.base_url || process.env.MM_API_BASE || 'http://localhost:3000';
  // Use last_poll to avoid duplicates
  const since = bundle.meta && bundle.meta.last_poll ? bundle.meta.last_poll : new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString();

  const resp = await z.request({
    url: `${baseUrl}/v1/bookings`,
    params: { since },
    headers: { Authorization: `Bearer ${bundle.authData.api_key}` },
  });

  return resp.data || [];
};

module.exports = {
  key: 'new_booking',
  noun: 'Booking',
  display: {
    label: 'New Booking',
    description: 'Triggers when a new booking is created.',
  },
  operation: {
    perform,
    sample: { id: 'sample-booking-id', mentor_id: 'm1', mentee_id: 'u1', scheduled_at: new Date().toISOString() },
  },
};
