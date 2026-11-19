const perform = async (z, bundle) => {
  const baseUrl = bundle.authData.base_url || process.env.MM_API_BASE || 'http://localhost:3000';
  const since = bundle.meta && bundle.meta.last_poll ? bundle.meta.last_poll : new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString();

  const resp = await z.request({
    url: `${baseUrl}/v1/session-milestones`,
    params: { since },
    headers: { Authorization: `Bearer ${bundle.authData.api_key}` },
  });

  return resp.data || [];
};

module.exports = {
  key: 'milestone_achieved',
  noun: 'Milestone',
  display: {
    label: 'Milestone Achieved',
    description: 'Triggers when a learner achieves a milestone.',
  },
  operation: {
    perform,
    sample: {
      id: 'milestone-1',
      learner_id: 'u1',
      learning_path_id: 'lp-1',
      title: 'Completed Unit 1',
      achieved_at: new Date().toISOString(),
    },
  },
};
