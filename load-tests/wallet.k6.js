import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  vus: 100,
  duration: '60s',
  thresholds: {
    http_req_duration: ['p(95)<300'],
    http_req_failed: ['rate<0.01'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

export default function () {
  const res = http.get(`${BASE_URL}/api/v1/wallets/me/balance`);
  check(res, {
    'wallet status is 200': (r) => r.status === 200,
    'wallet has balance object': (r) => typeof r.json().balance !== 'undefined',
  });
  sleep(1);
}
