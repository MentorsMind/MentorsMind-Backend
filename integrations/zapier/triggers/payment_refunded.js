const perform = async (z, bundle) => {
  const baseUrl = bundle.authData.base_url || process.env.MM_API_BASE || 'http://localhost:3000';
  const since = bundle.meta && bundle.meta.last_poll ? bundle.meta.last_poll : new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString();

  const resp = await z.request({
    url: `${baseUrl}/v1/payments`,
    params: { since, status: 'refunded' },
    headers: { Authorization: `Bearer ${bundle.authData.api_key}` },
  });

  return resp.data || [];
};

module.exports = {
  key: 'payment_refunded',
  noun: 'Payment',
  display: {
    label: 'Payment Refunded',
    description: 'Triggers when a payment is refunded.',
  },
  operation: {
    perform,
    sample: {
      id: 'payment-1',
      user_id: 'u1',
      amount: 50,
      currency: 'USD',
      status: 'refunded',
      refunded_at: new Date().toISOString(),
    },
  },
};
