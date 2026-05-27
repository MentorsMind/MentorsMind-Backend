const perform = async (z, bundle) => {
  const baseUrl = bundle.authData.base_url || process.env.MM_API_BASE || 'http://localhost:3000';
  const since = bundle.meta && bundle.meta.last_poll ? bundle.meta.last_poll : new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString();

  const resp = await z.request({
    url: `${baseUrl}/v1/disputes`,
    params: { since, status: 'open' },
    headers: { Authorization: `Bearer ${bundle.authData.api_key}` },
  });

  return resp.data || [];
};

module.exports = {
  key: 'dispute_opened',
  noun: 'Dispute',
  display: {
    label: 'Dispute Opened',
    description: 'Triggers when a new dispute is opened.',
  },
  operation: {
    perform,
    sample: { id: 'd1', payment_id: 'txn-1', reason: 'issue', status: 'open', created_at: new Date().toISOString() },
  },
};
