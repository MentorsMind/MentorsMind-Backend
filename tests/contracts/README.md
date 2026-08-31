# API Contract Testing Framework

This directory contains the consumer-driven API contract testing suite for MentorsMind-Backend, implemented using **Pact**.

## Why Contract Testing?

Contract testing ensures that different services (e.g., our frontend web app and backend API) agree on the format of messages/payloads sent between them. It prevents integration failures by verifying:
1. **The Consumer (Frontend)** defines request-response expectations, which generate a contract file (**Pact**).
2. **The Provider (Backend)** verifies that its actual implementations satisfy all expectations described in that Pact file.

## Directory Structure

```
├── pact/
│   └── pacts/                     # Generated Pact contract JSON files
└── tests/
    └── contracts/
        ├── booking-consumer.spec.ts  # Pact Consumer test (creates contract)
        ├── provider.spec.ts         # Pact Provider verifier (validates API against contract)
        ├── jest.config.ts           # Dedicated Jest configuration
        └── README.md                # Developer documentation
```

## Getting Started

### Prerequisites
Make sure the dependencies are installed:
```bash
pnpm install
```

### Running Contract Tests

To run the entire contract testing workflow:
```bash
pnpm run test:contract
```

This command executes two main steps in order:
1. **Consumer Verification**: Runs `booking-consumer.spec.ts` which boots a Pact mock server, executes mock requests, and outputs contract JSON schemas into `pact/pacts/`.
2. **Provider Verification**: Runs `provider.spec.ts` which launches the Express server locally on a test port and verifies its routes against the contract schemas generated in step 1.

## Best Practices
- **Define realistic request-responses**: Keep contract tests focused on schema/agreement shape rather than complex business logic verification.
- **Maintain semantic versioning**: If an API contract expectation changes and breaks the schema, update the API versioning accordingly to prevent breaking production frontend clients.
- **Sync generated pacts**: In production workflows, contracts should be uploaded to a Pact Broker so that provider verification runs automatically in CI/CD when consumer changes are made.
