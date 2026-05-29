import ws from 'k6/ws';
import { check } from 'k6';

export const options = {
  vus: 500,
  duration: '60s',
  thresholds: {
    'ws_connected{status:101}': ['rate>0.95'],
    ws_conn_failed: ['rate<0.01'],
  },
};

const BASE_WS = __ENV.BASE_WS_URL || 'ws://localhost:3000/ws';

export default function () {
  const res = ws.connect(BASE_WS, null, function (socket) {
    socket.on('open', () => {});
    socket.on('close', () => {});
    socket.setTimeout(() => {
      socket.close();
    }, 55000);
  });

  check(res, {
    'connected to websocket': (r) => r && r.status === 101,
  });
}
