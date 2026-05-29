import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  vus: 100,
  duration: '60s',
  thresholds: {
    http_req_duration: ['p(95)<200'],
    http_req_failed: ['rate<0.01'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

export default function () {
  const res = http.get(`${BASE_URL}/api/v1/search/mentors?query=javascript`);
  check(res, {
    'search status is 200': (r) => r.status === 200,
    'search not empty': (r) => r.json().length >= 0,
  });
  sleep(1);
}
