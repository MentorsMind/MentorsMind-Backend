# Adaptive Authentication System - Integration Guide

## Overview

The Adaptive Authentication System provides sophisticated risk-based authentication with behavioral biometrics, progressive authentication, and continuous monitoring. This system analyzes user behavior, device characteristics, location, and other risk factors to dynamically adjust authentication requirements.

## Core Components

### 1. Risk Engine Service (`risk-engine.service.ts`)
- Calculates comprehensive risk scores (0-100)
- Analyzes device, location, behavioral, historical, and network factors
- Provides risk levels: low, medium, high, critical
- Recommends authentication actions based on risk

### 2. Behavioral Biometrics Service (`behavioral-biometrics.service.ts`)
- Analyzes keystroke dynamics, mouse movements, touch patterns
- Builds user behavioral profiles over time
- Detects anomalies in user behavior
- Provides authenticity scores and confidence levels

### 3. Adaptive Auth Service (`adaptive-auth.service.ts`)
- Main decision engine for authentication flows
- Implements progressive authentication (5 levels)
- Manages continuous authentication sessions
- Handles challenge generation and verification

### 4. Adaptive Auth Middleware (`adaptive-auth.middleware.ts`)
- Express middleware for request-level authentication decisions
- Device-aware, location-aware, and time-based policies
- Automatic challenge handling and response processing

## Installation & Setup

### 1. Database Migration

Run the migration to create required tables:

```bash
npm run migrate:up
```

This creates the following tables:
- `user_devices` - Device tracking and trust management
- `risk_assessments` - Risk evaluation logs
- `auth_attempts` - Authentication attempt tracking
- `security_incidents` - Security threat tracking
- `biometric_profiles` - User behavioral baselines
- `biometric_samples` - Training data for behavioral analysis
- `adaptive_auth_sessions` - Progressive authentication sessions
- `auth_challenges` - Authentication challenges
- `continuous_auth_sessions` - Continuous monitoring sessions

### 2. Route Integration

Add adaptive auth routes to your application:

```typescript
// In your main routes file
import adaptiveAuthRoutes from "./adaptive-auth.routes";
app.use("/api/v1/adaptive-auth", adaptiveAuthRoutes);
```

### 3. Environment Configuration

Add these optional environment variables:

```bash
# Risk scoring thresholds
ADAPTIVE_AUTH_LOW_RISK_THRESHOLD=20
ADAPTIVE_AUTH_MEDIUM_RISK_THRESHOLD=40
ADAPTIVE_AUTH_HIGH_RISK_THRESHOLD=70

# Biometric confidence thresholds
BIOMETRIC_AUTH_THRESHOLD=0.7
BIOMETRIC_ANOMALY_THRESHOLD=0.3

# Continuous auth settings
CONTINUOUS_AUTH_INTERVAL=30
DEVICE_TRUST_EXPIRY_DAYS=30
```

## Usage Examples

### 1. Basic Adaptive Authentication

```typescript
import { adaptiveAuth } from "../middleware/adaptive-auth.middleware";

// Apply to sensitive routes
router.post("/transfer-funds", 
  authenticate,
  adaptiveAuth({ 
    privilegedAction: true,
    actionType: "financial_transaction",
    enableBiometrics: true 
  }),
  TransferController.transferFunds
);
```

### 2. Progressive Authentication

```typescript
import { requireHighSecurity } from "../middleware/adaptive-auth.middleware";

// Require high authentication strength
router.delete("/account", 
  authenticate,
  requireHighSecurity({ 
    minStrength: 80,
    actionType: "account_deletion" 
  }),
  UserController.deleteAccount
);
```

### 3. Continuous Authentication

```typescript
import { requireContinuousAuth } from "../middleware/adaptive-auth.middleware";

// Monitor user throughout session
router.get("/sensitive-data", 
  authenticate,
  requireContinuousAuth({ monitoringInterval: 30 }),
  DataController.getSensitiveData
);
```

### 4. Device and Location Policies

```typescript
import { deviceAwareAuth, locationAwareAuth } from "../middleware/adaptive-auth.middleware";

// Device-specific policies
router.post("/api-key", 
  authenticate,
  deviceAwareAuth({ trustNewDevices: false }),
  ApiController.generateKey
);

// Location-based restrictions
router.get("/admin", 
  authenticate,
  locationAwareAuth({ 
    allowedCountries: ["US", "CA", "GB"],
    requireVpnVerification: true 
  }),
  AdminController.dashboard
);
```

### 5. Custom Risk Assessment

```typescript
// In your controller
import { RiskEngineService } from "../services/risk-engine.service";

async function assessTransactionRisk(req: Request, amount: number) {
  const riskScore = await RiskEngineService.calculateRiskScore(
    req.user?.id,
    req,
    {
      isPrivilegedAction: true,
      actionType: "financial_transaction",
      resourceAccessed: `transaction:${amount}`
    }
  );

  if (riskScore.totalScore > 70) {
    // Require additional verification
    throw new Error("Additional verification required");
  }

  return riskScore;
}
```

### 6. Biometric Data Collection (Client-side)

```javascript
// Client-side biometric data collection
class BiometricCollector {
  constructor() {
    this.keystrokeData = [];
    this.mouseData = [];
    this.touchData = [];
  }

  // Collect keystroke dynamics
  onKeyDown(event) {
    this.keystrokeStart = Date.now();
  }

  onKeyUp(event) {
    if (this.keystrokeStart) {
      const dwellTime = Date.now() - this.keystrokeStart;
      this.keystrokeData.push({
        key: event.key,
        dwellTime,
        timestamp: Date.now()
      });
    }
  }

  // Collect mouse movements
  onMouseMove(event) {
    this.mouseData.push({
      x: event.clientX,
      y: event.clientY,
      timestamp: Date.now()
    });
  }

  // Submit biometric data
  async submitBiometricData() {
    const biometricData = {
      keystrokeDynamics: this.processKeystrokeData(),
      mouseMovements: this.mouseData.slice(-100), // Last 100 movements
      // ... other biometric data
    };

    await fetch('/api/v1/adaptive-auth/biometric/train', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ biometricData })
    });
  }
}
```

### 7. Challenge Handling (Client-side)

```javascript
// Handle authentication challenges
async function handleAuthChallenge(challengeResponse) {
  const { challenges, sessionId } = challengeResponse;

  for (const challenge of challenges) {
    let response;

    switch (challenge.type) {
      case 'mfa':
        response = { token: await getMfaToken() };
        break;
      
      case 'email_verification':
        response = { code: await getEmailVerificationCode() };
        break;
      
      case 'device_confirmation':
        response = { confirmed: await confirmDevice() };
        break;
      
      case 'biometric':
        response = { biometricData: await collectBiometricData() };
        break;
    }

    // Submit challenge response
    const result = await fetch('/api/v1/adaptive-auth/challenge/respond', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        challengeId: challenge.id,
        response,
        sessionId
      })
    });

    if (!result.success) {
      throw new Error('Challenge verification failed');
    }
  }
}
```

## API Endpoints

### Authentication Challenges
- `POST /adaptive-auth/challenge/respond` - Submit challenge response
- `GET /adaptive-auth/sessions/:sessionId/status` - Check session status

### Risk Assessment
- `POST /adaptive-auth/risk/assess` - Get risk assessment
- `GET /adaptive-auth/analytics/risk-trends` - View risk analytics

### Biometric Management
- `POST /adaptive-auth/biometric/verify` - Verify biometric data
- `POST /adaptive-auth/biometric/train` - Submit training sample
- `GET /adaptive-auth/biometric/profile` - Get biometric profile

### Device Management
- `GET /adaptive-auth/devices` - List user devices
- `POST /adaptive-auth/devices/trust` - Trust a device
- `DELETE /adaptive-auth/devices/:deviceId` - Remove device

### Continuous Monitoring
- `POST /adaptive-auth/monitoring/start` - Start monitoring
- `POST /adaptive-auth/monitoring/heartbeat` - Send heartbeat
- `POST /adaptive-auth/monitoring/stop` - Stop monitoring

## Configuration Options

### Risk Thresholds
```typescript
const riskThresholds = {
  low: 20,      // 0-19: Allow
  medium: 40,   // 20-39: Basic MFA
  high: 70,     // 40-69: Strong MFA + Device verification
  critical: 85  // 70+: Block or require admin approval
};
```

### Progressive Authentication Levels
```typescript
const authLevels = {
  1: { factors: ['password'], minStrength: 0 },
  2: { factors: ['password', 'device_verification'], minStrength: 30 },
  3: { factors: ['password', 'mfa', 'device_verification'], minStrength: 50 },
  4: { factors: ['password', 'mfa', 'biometric'], minStrength: 70 },
  5: { factors: ['password', 'mfa', 'biometric', 'admin_approval'], minStrength: 85 }
};
```

## Security Considerations

1. **Data Privacy**: Biometric data is processed and stored securely with minimal retention
2. **Fallback Mechanisms**: System degrades gracefully when services are unavailable
3. **Rate Limiting**: All endpoints include appropriate rate limiting
4. **Logging**: Comprehensive audit logging for compliance and investigation
5. **Encryption**: All sensitive data encrypted at rest and in transit

## Monitoring & Analytics

### Key Metrics
- Risk score distributions
- Challenge success rates
- Biometric authenticity scores
- Device trust levels
- Geographic authentication patterns

### Alerts
- High-risk authentication attempts
- Biometric anomalies detected
- Multiple failed challenges
- Suspicious device or location changes

### Reports
- Authentication security posture
- User behavior analysis
- Risk trend analysis
- Incident response reports

## Troubleshooting

### Common Issues

1. **High False Positives**
   - Adjust risk thresholds
   - Increase biometric training period
   - Review location and device policies

2. **Performance Impact**
   - Enable database query optimization
   - Implement caching for risk assessments
   - Use async processing for biometric analysis

3. **User Experience Issues**
   - Provide clear challenge instructions
   - Implement progressive disclosure
   - Add user education about security measures

4. **Integration Problems**
   - Check middleware order
   - Verify database migrations
   - Review error logging and handling

## Best Practices

1. **Gradual Rollout**: Implement in monitor-only mode first
2. **User Training**: Educate users about enhanced security measures  
3. **Regular Tuning**: Monitor metrics and adjust thresholds
4. **Incident Response**: Have procedures for handling security alerts
5. **Compliance**: Ensure implementation meets regulatory requirements

## Support

For issues or questions regarding the adaptive authentication system, consult the API documentation or contact the development team.