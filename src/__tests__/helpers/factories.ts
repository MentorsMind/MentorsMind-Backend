import { UserRecord } from '../../services/users.service';
import { SessionRecord } from '../../models/session.model';
import { PaymentRecord } from '../../services/payments.service';

export const createMockUser = (overrides: Partial<UserRecord> = {}): UserRecord => ({
  id: 'user-123',
  email: 'test@example.com',
  first_name: 'Test',
  last_name: 'User',
  role: 'user',
  is_active: true,
  bio: null,
  avatar_url: null,
  created_at: new Date('2023-01-01'),
  updated_at: new Date('2023-01-01'),
  ...overrides,
});

export const createMockSession = (overrides: Partial<SessionRecord> = {}): SessionRecord => ({
  id: 'session-123',
  mentor_id: 'mentor-123',
  mentee_id: 'mentee-123',
  title: 'JavaScript Basics',
  description: null,
  scheduled_at: new Date('2023-01-15T10:00:00Z'),
  duration_minutes: 60,
  status: 'pending',
  meeting_link: null,
  meeting_url: null,
  meeting_provider: null,
  meeting_room_id: null,
  meeting_expires_at: null,
  needs_manual_intervention: false,
  notes: null,
  created_at: new Date('2023-01-01'),
  updated_at: new Date('2023-01-01'),
  ...overrides,
});

export const createMockPayment = (overrides: Partial<PaymentRecord> = {}): PaymentRecord => ({
  id: 'payment-123',
  user_id: 'user-123',
  booking_id: 'booking-123',
  type: 'payment',
  status: 'completed',
  amount: '50.00',
  currency: 'XLM',
  stellar_tx_hash: 'txn123456789',
  from_address: 'GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
  to_address: 'GYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY',
  platform_fee: '2.50',
  description: 'Payment for mentoring session',
  error_message: null,
  metadata: {},
  created_at: new Date('2023-01-01'),
  updated_at: new Date('2023-01-01'),
  completed_at: new Date('2023-01-01'),
  ...overrides,
});