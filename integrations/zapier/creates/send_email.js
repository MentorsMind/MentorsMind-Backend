const perform = async (z, bundle) => {
  const baseUrl = bundle.authData.base_url || process.env.MM_API_BASE || 'http://localhost:3000';
  const resp = await z.request({
    method: 'POST',
    url: `${baseUrl}/v1/notifications/email`,
    headers: { Authorization: `Bearer ${bundle.authData.api_key}` },
    json: {
      to: bundle.inputData.to,
      subject: bundle.inputData.subject,
      body: bundle.inputData.body,
    },
  });
  return resp.data;
};

module.exports = {
  key: 'send_email',
  noun: 'Email',
  display: { label: 'Send Email', description: 'Send email via MentorMinds notification system' },
  operation: {
    inputFields: [
      { key: 'to', required: true },
      { key: 'subject', required: true },
      { key: 'body', required: true },
    ],
    perform,
    sample: { id: 'out-1', to: 'user@example.com', subject: 'Hello', body: 'Test' },
  },
};
