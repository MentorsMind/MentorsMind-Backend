const perform = async (z, bundle) => {
  const baseUrl = bundle.authData.base_url || process.env.MM_API_BASE || 'http://localhost:3000';
  const since = bundle.meta && bundle.meta.last_poll ? bundle.meta.last_poll : new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString();

  const resp = await z.request({
    url: `${baseUrl}/v1/reviews`,
    params: { since },
    headers: { Authorization: `Bearer ${bundle.authData.api_key}` },
  });

  return resp.data || [];
};

module.exports = {
  key: 'review_received',
  noun: 'Review',
  display: {
    label: 'Review Received',
    description: 'Triggers when a mentor receives a new review.',
  },
  operation: {
    perform,
    sample: {
      id: 'review-1',
      booking_id: 'booking-1',
      reviewer_id: 'u1',
      reviewee_id: 'm1',
      rating: 5,
      comment: 'Excellent session!',
      created_at: new Date().toISOString(),
    },
  },
};
