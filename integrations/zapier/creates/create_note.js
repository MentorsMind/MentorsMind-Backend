const perform = async (z, bundle) => {
  const baseUrl = bundle.authData.base_url || process.env.MM_API_BASE || 'http://localhost:3000';
  const resp = await z.request({
    method: 'POST',
    url: `${baseUrl}/v1/notes`,
    headers: { Authorization: `Bearer ${bundle.authData.api_key}` },
    json: {
      booking_id: bundle.inputData.booking_id,
      content: bundle.inputData.content,
      is_private: bundle.inputData.is_private === true,
    },
  });
  return resp.data;
};

module.exports = {
  key: 'create_note',
  noun: 'Note',
  display: {
    label: 'Create Note',
    description: 'Create a private or shared note on a booking.',
  },
  operation: {
    inputFields: [
      { key: 'booking_id', required: true, label: 'Booking ID' },
      { key: 'content', required: true, label: 'Note Content' },
      { key: 'is_private', required: false, label: 'Private?', type: 'boolean', helpText: 'Defaults to false (shared)' },
    ],
    perform,
    sample: {
      id: 'note-1',
      booking_id: 'booking-1',
      content: 'Follow up on action items.',
      is_private: true,
      created_at: new Date().toISOString(),
    },
  },
};
