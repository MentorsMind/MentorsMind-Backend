const perform = async (z, bundle) => {
  const baseUrl = bundle.authData.base_url || process.env.MM_API_BASE || 'http://localhost:3000';
  const since = bundle.meta && bundle.meta.last_poll ? bundle.meta.last_poll : new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString();

  const resp = await z.request({
    url: `${baseUrl}/v1/sessions`,
    params: { since, status: 'completed' },
    headers: { Authorization: `Bearer ${bundle.authData.api_key}` },
  });

  return resp.data || [];
};

module.exports = {
  key: 'session_completed',
  noun: 'Session',
  display: {
    label: 'Session Completed',
    description: 'Triggers when a mentoring session is marked as completed.',
  },
  operation: {
    perform,
    sample: {
      id: 'session-1',
      booking_id: 'booking-1',
      mentor_id: 'm1',
      mentee_id: 'u1',
      status: 'completed',
      completed_at: new Date().toISOString(),
    },
  },
};
