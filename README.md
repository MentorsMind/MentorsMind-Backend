# MentorMinds Stellar - Backend API

Backend API server for the MentorMinds Stellar platform, built with Node.js, Express, TypeScript, and PostgreSQL.

## 🚀 Features

- **RESTful API** with Express.js
- **TypeScript** for type safety
- **PostgreSQL** database with connection pooling
- **Stellar SDK** integration for blockchain operations
- **JWT Authentication** for secure user sessions
- **Input Validation** with Zod
- **Security** with Helmet and CORS
- **Logging** with Morgan
- **Environment Configuration** with dotenv
- **Interactive API Docs** with Swagger UI (OpenAPI 3.0)
- **Video Meeting Integration** with multiple provider support (Daily.co, Whereby, Zoom, Jitsi)
- **Automated Meeting Room Generation** on booking confirmation
- **Email Notifications** for meeting links
- **Timezone Handling** with Luxon (IANA timezones, DST-aware)
- **Session Reminders** with cron-based scheduling

## 📖 API Documentation

Once the server is running, interactive API documentation is available at:

| URL | Description |
|-----|-------------|
| `http://localhost:5000/api/v1/docs` | Swagger UI — explore and test all endpoints |
| `http://localhost:5000/api/v1/docs/spec.json` | Raw OpenAPI 3.0 spec (JSON) |

### Using Swagger UI

1. Open `http://localhost:5000/api/v1/docs` in your browser
2. Click **Authorize** (🔒) and enter your JWT token: `Bearer <your_access_token>`
3. Obtain a token via `POST /auth/login` or `POST /auth/register`
4. Explore endpoints grouped by tag: **Auth**, **Users**, **Mentors**, **Payments**, **Wallets**, **Admin**

The spec auto-updates on every server restart from JSDoc annotations in `src/routes/*.ts`.

## 📋 Prerequisites

- Node.js 20+ and npm
- PostgreSQL 14+
- Stellar account (testnet for development)

## 🛠️ Installation

1. **Install dependencies**:
```bash
npm install
```

2. **Setup environment variables**:
```bash
cp .env.example .env
```

Edit `.env` with your configuration:
- Database credentials
- JWT secrets
- Stellar network settings
- CORS origins

3. **Setup database**:
```bash
# Create database
createdb mentorminds

# Run migrations (coming soon)
npm run migrate
```

## 🏃 Running the Server

### Development Mode
```bash
npm run dev
```
Server runs on http://localhost:5000 with hot reload

### Production Build
```bash
npm run build
npm start
```

## 📁 Project Structure

```
mentorminds-backend/
├── src/
│   ├── config/          # Configuration files
│   │   ├── database.ts  # PostgreSQL configuration
│   │   └── stellar.ts   # Stellar SDK configuration
│   ├── controllers/     # Route controllers
│   ├── middleware/      # Express middleware
│   │   ├── errorHandler.ts
│   │   └── notFoundHandler.ts
│   ├── models/          # Database models
│   ├── routes/          # API routes
│   ├── services/        # Business logic
│   ├── utils/           # Utility functions
│   ├── types/           # TypeScript types
│   └── server.ts        # Entry point
├── database/
│   └── migrations/      # Database migrations
├── .env.example         # Environment variables template
├── tsconfig.json        # TypeScript configuration
└── package.json
```

## 🔌 API Endpoints

### Health Check
```
GET /health
```

### API Info
```
GET /api/v1
```

### Timezone API
```
GET /api/v1/timezones - List all IANA timezones
GET /api/v1/timezones/:identifier - Get timezone details
```

### Coming Soon
- `POST /api/v1/auth/register` - User registration
- `POST /api/v1/auth/login` - User login
- `GET /api/v1/users/:id` - Get user profile
- `GET /api/v1/mentors` - List mentors
- `POST /api/v1/bookings` - Create booking
- `POST /api/v1/bookings/:id/confirm` - Confirm booking with auto-generated meeting URL
- `GET /api/v1/bookings` - List user sessions with meeting links
- `POST /api/v1/bookings` - Create booking (with timezone support)
- `POST /api/v1/payments` - Process payment
- `GET /api/v1/wallets/:id` - Get wallet info

## 🔐 Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `NODE_ENV` | Environment (development/production) | development |
| `PORT` | Server port | 5000 |
| `DATABASE_URL` | PostgreSQL connection string | - |
| `JWT_SECRET` | JWT signing secret | - |
| `STELLAR_NETWORK` | Stellar network (testnet/mainnet) | testnet |
| `STELLAR_HORIZON_URL` | Horizon server URL | testnet URL |
| `CORS_ORIGIN` | Allowed CORS origins | * |

See `.env.example` for complete list.

### Meeting Provider Configuration

For video meeting functionality, add these variables:

```bash
MEETING_PROVIDER=jitsi          # Options: daily, whereby, zoom, jitsi
MEETING_API_KEY=your_api_key    # Required for Daily, Whereby, Zoom
MEETING_ROOM_EXPIRY_MINUTES=30   # Meeting expires 30 min after session end
```

📖 **See [Meeting Providers Guide](docs/meeting-providers.md) for detailed setup instructions.**

## 🧪 Testing

The project uses **Jest** with **Supertest** for comprehensive API integration testing. The test suite includes:

- **Isolated Tests**: Each test runs with a clean database state
- **Test Factories**: Helper functions to create test data (users, mentors, sessions, payments)
- **HTTP Integration Tests**: Test actual HTTP requests against the Express app
- **Coverage Reporting**: Minimum 70% coverage threshold enforced

### Running Tests

```bash
# Run all tests
npm test

# Run tests in watch mode (for development)
npm run test:watch

# Run tests with coverage report
npm run test:coverage
```

### Test Database Setup

Tests use a separate PostgreSQL database configured via `DATABASE_URL_TEST` environment variable.

1. Create the test database:
```bash
createdb mentorminds_test
```

2. Configure `.env.test` (already provided) with your test database credentials

3. Tables are automatically created and truncated between tests

### Writing Tests

#### Basic Test Structure

```typescript
import request from 'supertest';
import app from '../app';
import { createUser } from './factories/user.factory';
import { authenticatedGet } from './helpers/request.helper';

describe('Users API', () => {
  it('should get user profile', async () => {
    const user = await createUser({ role: 'user' });
    const token = generateTestToken({ userId: user.id, email: user.email, role: user.role });
    
    const response = await authenticatedGet('/users/me', token);
    
    expect(response.status).toBe(200);
    expect(response.body.email).toBe(user.email);
  });
});
```

#### Using Factories

```typescript
import { createUser, createMentor, createUsers } from './factories/user.factory';
import { createSession } from './factories/session.factory';
import { createPayment } from './factories/payment.factory';

// Create a single user
const user = await createUser({
  email: 'custom@test.com',
  role: 'admin',
});

// Create a mentor
const mentor = await createMentor({
  bio: 'Expert developer with 10 years experience',
});

// Create multiple users
const users = await createUsers(5);

// Create a session (requires existing users)
const session = await createSession({
  mentorId: mentor.id,
  menteeId: user.id,
  scheduledAt: new Date(),
});

// Create a payment
const payment = await createPayment({
  userId: user.id,
  amount: 100,
  type: 'deposit',
});
```

#### Making Authenticated Requests

```typescript
import { 
  authenticatedGet, 
  authenticatedPost, 
  authenticatedPut, 
  authenticatedDelete 
} from './helpers/request.helper';

// GET request
const response = await authenticatedGet('/users/me', token);

// POST request with data
const response = await authenticatedPost('/sessions', sessionData, token);

// PUT request
const response = await authenticatedPut('/users/profile', updateData, token);

// DELETE request
const response = await authenticatedDelete('/sessions/:id', token);
```

### Test Organization

```
src/
├── __tests__/              # Test files
│   ├── health.test.ts      # Health check tests
│   └── ...                 # Other test files
├── tests/
│   ├── setup.ts            # Global test setup/teardown
│   ├── factories/          # Test data factories
│   │   ├── user.factory.ts
│   │   ├── mentor.factory.ts
│   │   ├── session.factory.ts
│   │   ├── payment.factory.ts
│   │   └── index.ts
│   └── helpers/            # Test helpers
│       ├── request.helper.ts
│       └── index.ts
```

### Coverage Reports

After running `npm run test:coverage`, reports are generated in:

- `coverage/lcov-report/index.html` - HTML report (open in browser)
- `coverage/coverage-summary.json` - JSON summary
- `coverage/coverage-final.json` - Final coverage data

CI will fail if coverage drops below 70%.

## 📝 Scripts

- `npm run dev` - Start development server with hot reload
- `npm run build` - Build for production
- `npm start` - Start production server
- `npm run lint` - Run ESLint
- `npm run lint:fix` - Fix ESLint errors
- `npm run format` - Format code with Prettier
- `npm test` - Run all tests
- `npm run test:watch` - Run tests in watch mode
- `npm run test:coverage` - Run tests with coverage report

## 🔒 Security

- Helmet.js for security headers
- CORS configuration
- JWT token authentication
- Input validation with Zod
- SQL injection prevention
- Rate limiting (coming soon)

## 📚 Tech Stack

- **Runtime**: Node.js 18+
- **Framework**: Express.js 5
- **Language**: TypeScript 5
- **Database**: PostgreSQL 14+
- **Blockchain**: Stellar SDK
- **Authentication**: JWT
- **Validation**: Zod
- **Security**: Helmet, CORS
- **Logging**: Morgan
- **Timezone**: Luxon (IANA timezones, DST-aware)
- **Scheduling**: Cron (session reminders)

## 🚧 Development Roadmap

- [x] Project setup
- [x] Basic Express server
- [x] Database configuration
- [x] Stellar SDK integration
- [ ] Authentication endpoints
- [ ] User management
- [ ] Mentor management
- [ ] Booking system
- [ ] Payment processing
- [ ] Wallet management
- [ ] Admin dashboard API

## 📖 Documentation

- [API Documentation](./docs/API.md) (coming soon)
- [Database Schema](./docs/DATABASE.md) (coming soon)
- [Stellar Integration](./docs/STELLAR_SERVICE.md)
- [Timezone Handling Guide](./docs/timezone-handling.md)
- [DST Edge Cases](./docs/dst-edge-cases.md)
- [Implementation Summary](./docs/IMPLEMENTATION_SUMMARY.md)

## 🤝 Contributing

1. Create a feature branch
2. Make your changes
3. Run tests and linting
4. Submit a pull request

See [CONTRIBUTING.md](CONTRIBUTING.md) for branch naming and PR conventions.

## 📄 License

MIT License - see LICENSE file for details

## 🆘 Support

For issues and questions:
- Create an issue on GitHub
- Check existing documentation
- Review the codebase

---

**Status**: 🟢 Active Development

Built with ❤️ for the MentorMinds Stellar platform

## 🐳 Docker Containerization
Run the full stack locally:
\`bash
docker-compose up --build
\`

Run the test suite in Docker:
\`bash
docker-compose -f docker-compose.test.yml up --exit-code-from test-backend
\`
