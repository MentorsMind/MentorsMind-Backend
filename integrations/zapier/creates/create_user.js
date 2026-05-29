const perform = async (z, bundle) => {
  const baseUrl = bundle.authData.base_url || process.env.MM_API_BASE || 'http://localhost:3000';
  const resp = await z.request({
    method: 'POST',
    url: `${baseUrl}/v1/users`,
    headers: { Authorization: `Bearer ${bundle.authData.api_key}` },
    json: {
      name: bundle.inputData.name,
      email: bundle.inputData.email,
      password: bundle.inputData.password,
    },
  });
  return resp.data;
};

module.exports = {
  key: 'create_user',
  noun: 'User',
  display: { label: 'Create User', description: 'Create a new user in MentorMinds' },
  operation: {
    inputFields: [
      { key: 'name', required: true },
      { key: 'email', required: true },
      { key: 'password', required: true },
    ],
    perform,
    sample: { id: 'u1', name: 'Test User', email: 'test@example.com' },
  },
};
