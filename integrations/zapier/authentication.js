// Simple API Key / Base URL authentication for MentorMinds API
module.exports = {
  type: 'custom',
  test: async (z, bundle) => {
    const baseUrl = bundle.authData.base_url || process.env.MM_API_BASE || 'http://localhost:3000';
    const response = await z.request({
      url: `${baseUrl}/health`,
      method: 'GET',
      headers: {
        Authorization: `Bearer ${bundle.authData.api_key}`,
      },
    });
    // Expect 200 OK
    if (response.status !== 200) {
      throw new Error('Authentication test failed: invalid API key or base URL');
    }
    return response.json || {};
  },
  fields: [
    { key: 'api_key', required: true, type: 'string', helpText: 'API Key (Bearer token) for MentorMinds API' },
    { key: 'base_url', required: false, type: 'string', helpText: 'Base URL for MentorMinds API (defaults to http://localhost:3000)' },
  ],
  connectionLabel: '{{bundle.authData.base_url}}',
};
