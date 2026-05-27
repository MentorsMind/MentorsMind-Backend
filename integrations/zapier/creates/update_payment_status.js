const perform = async (z, bundle) => {
  const baseUrl = bundle.authData.base_url || process.env.MM_API_BASE || 'http://localhost:3000';
  const resp = await z.request({
    method: 'PATCH',
    url: `${baseUrl}/v1/transactions/${bundle.inputData.transaction_id}`,
    headers: { Authorization: `Bearer ${bundle.authData.api_key}` },
    json: { status: bundle.inputData.status },
  });
  return resp.data;
};

module.exports = {
  key: 'update_payment_status',
  noun: 'Payment',
  display: { label: 'Update Payment Status', description: 'Update a transaction status in MentorMinds' },
  operation: {
    inputFields: [
      { key: 'transaction_id', required: true },
      { key: 'status', required: true, choices: ['pending', 'completed', 'failed', 'refunded'] },
    ],
    perform,
    sample: { id: 'txn-1', status: 'refunded' },
  },
};
