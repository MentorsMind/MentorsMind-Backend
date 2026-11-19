import { Request, Response, NextFunction } from "express";
import { logger } from "../utils/logger.utils";
import { AdaptiveAuthService, AdaptiveAuthContext, AdaptiveAuthResult } from "../services/adaptive-auth.service";
import { AuthenticatedRequest } from "./auth.middleware";

export interface AdaptiveAuthRequest extends AuthenticatedRequest {
  adaptiveAuth?: {
    result: AdaptiveAuthResult;
    context: AdaptiveAuthContext;
    sessionId: string;
  };
}

export interface AdaptiveAuthOptions {
  enableBiometrics?: boolean;
  requireContinuous?: boolean;
  privilegedAction?: boolean;
  actionType?: string;
  resourceAccessed?: string;
  customRiskFactors?: Record<string, any>;
}

/**
 * Main adaptive authentication middleware
 * Performs risk assessment and adaptive authentication decisions
 */
export const adaptiveAuth = (options: AdaptiveAuthOptions = {}) => {
  return async (req: AdaptiveAuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const startTime = Date.now();
      
      // Extract biometric data from request if available
      const biometricData = req.body.biometricData || req.headers['x-biometric-data'] 
        ? JSON.parse(req.headers['x-biometric-data'] as string || '{}') 
        : undefined;

      // Build adaptive auth context
      const context: AdaptiveAuthContext = {
        userId: req.user?.id || req.user?.userId,
        email: req.user?.email,
        sessionId: req.headers['x-session-id'] as string || undefined,
        isLoginAttempt: req.path.includes('/login') || req.path.includes('/auth'),
        isPasswordReset: req.path.includes('/reset-password') || req.path.includes('/forgot-password'),
        isDeviceChange: req.headers['x-device-changed'] === 'true',
        isLocationChange: req.headers['x-location-changed'] === 'true',
        isPrivilegedAction: options.privilegedAction,
        actionType: options.actionType,
        resourceAccessed: options.resourceAccessed,
        biometricData: options.enableBiometrics ? biometricData : undefined
      };

      // Perform adaptive authentication
      const authResult = await AdaptiveAuthService.authenticateAdaptive(req, context);

      // Add adaptive auth info to request
      req.adaptiveAuth = {
        result: authResult,
        context,
        sessionId: authResult.sessionId
      };

      // Set response headers with auth info
      res.setHeader('X-Auth-Session-Id', authResult.sessionId);
      res.setHeader('X-Risk-Level', authResult.riskLevel);
      res.setHeader('X-Auth-Strength', authResult.authenticationStrength.toString());

      const processingTime = Date.now() - startTime;
      logger.debug('Adaptive auth completed', {
        userId: context.userId,
        decision: authResult.decision,
        riskScore: authResult.riskScore,
        riskLevel: authResult.riskLevel,
        challenges: authResult.challenges.length,
        processingTime
      });

      // Handle the authentication decision
      if (authResult.decision === 'block') {
        res.status(403).json({
          success: false,
          error: 'Access denied due to security policy',
          code: 'ADAPTIVE_AUTH_BLOCKED',
          riskLevel: authResult.riskLevel,
          reasons: authResult.reasons,
          sessionId: authResult.sessionId
        });
        return;
      }

      if (authResult.decision === 'challenge') {
        res.status(202).json({
          success: false,
          code: 'ADAPTIVE_AUTH_CHALLENGE_REQUIRED',
          message: 'Additional authentication required',
          challenges: authResult.challenges.map(challenge => ({
            id: challenge.challengeId,
            type: challenge.type,
            message: challenge.message,
            required: challenge.required,
            expiresAt: challenge.expiresAt,
            metadata: challenge.metadata
          })),
          riskLevel: authResult.riskLevel,
          sessionId: authResult.sessionId,
          nextSteps: generateNextStepsGuidance(authResult.challenges)
        });
        return;
      }

      // Authentication successful - continue with request
      next();

    } catch (error) {
      logger.error('Adaptive authentication middleware error', { 
        error: error instanceof Error ? error.message : 'Unknown error',
        path: req.path,
        userId: req.user?.id
      });
      
      // In case of error, allow request to continue with warning
      res.setHeader('X-Auth-Warning', 'Adaptive authentication temporarily unavailable');
      next();
    }
  };
};

/**
 * Middleware for privileged actions requiring high authentication strength
 */
export const requireHighSecurity = (options: { minStrength?: number; actionType?: string } = {}) => {
  return adaptiveAuth({
    privilegedAction: true,
    enableBiometrics: true,
    actionType: options.actionType || 'privileged_action',
    customRiskFactors: { minRequiredStrength: options.minStrength || 70 }
  });
};

/**
 * Middleware for actions requiring continuous authentication
 */
export const requireContinuousAuth = (options: { monitoringInterval?: number } = {}) => {
  return async (req: AdaptiveAuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user?.id) {
        res.status(401).json({ success: false, error: 'Authentication required' });
        return;
      }

      const sessionId = req.headers['x-session-id'] as string || 
                       req.adaptiveAuth?.sessionId || 
                       'default_session';

      // Extract current biometric data if available
      const biometricData = req.body.biometricData || 
                           (req.headers['x-biometric-data'] 
                             ? JSON.parse(req.headers['x-biometric-data'] as string)
                             : undefined);

      // Monitor continuous authentication
      const monitorResult = await AdaptiveAuthService.monitorContinuousAuth(
        req.user.id,
        sessionId,
        biometricData
      );

      if (monitorResult.needsReauth) {
        res.status(202).json({
          success: false,
          code: 'CONTINUOUS_AUTH_REQUIRED',
          message: 'Continuous authentication verification required',
          challenges: monitorResult.challenges,
          riskTrend: monitorResult.riskTrend,
          sessionId: sessionId
        });
        return;
      }

      // Update monitoring headers
      res.setHeader('X-Risk-Trend', monitorResult.riskTrend);
      res.setHeader('X-Monitoring-Active', 'true');

      next();

    } catch (error) {
      logger.error('Continuous auth middleware error', { 
        error: error instanceof Error ? error.message : 'Unknown error',
        userId: req.user?.id
      });
      next(); // Continue on error
    }
  };
};

/**
 * Middleware to handle challenge responses
 */
export const handleChallengeResponse = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { challengeId, response, sessionId } = req.body;
    const userId = req.body.userId || (req as AuthenticatedRequest).user?.id;

    if (!challengeId || !response || !userId) {
      res.status(400).json({
        success: false,
        error: 'Challenge ID, response, and user ID are required'
      });
      return;
    }

    // Complete the challenge
    const result = await AdaptiveAuthService.completeChallengeResponse(
      userId,
      challengeId,
      response,
      sessionId
    );

    if (!result.success) {
      res.status(400).json({
        success: false,
        error: result.message,
        code: 'CHALLENGE_VERIFICATION_FAILED'
      });
      return;
    }

    // Challenge completed successfully
    res.json({
      success: true,
      message: result.message,
      authenticationStrength: result.newStrength,
      sessionId: sessionId
    });

  } catch (error) {
    logger.error('Challenge response handler error', { error });
    res.status(500).json({
      success: false,
      error: 'Challenge verification failed'
    });
  }
};

/**
 * Middleware for device-specific authentication policies
 */
export const deviceAwareAuth = (options: { trustNewDevices?: boolean; deviceTimeout?: number } = {}) => {
  return async (req: AdaptiveAuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const deviceFingerprint = req.headers['x-device-fingerprint'] as string;
      const isNewDevice = req.headers['x-new-device'] === 'true';

      if (!deviceFingerprint) {
        res.status(400).json({
          success: false,
          error: 'Device fingerprint required',
          code: 'DEVICE_FINGERPRINT_MISSING'
        });
        return;
      }

      // If it's a new device and we don't auto-trust, require additional verification
      if (isNewDevice && !options.trustNewDevices) {
        req.headers['x-device-changed'] = 'true';
      }

      // Continue with adaptive auth
      next();

    } catch (error) {
      logger.error('Device-aware auth error', { error });
      next();
    }
  };
};

/**
 * Middleware for location-based authentication policies
 */
export const locationAwareAuth = (options: { 
  allowedCountries?: string[]; 
  blockedCountries?: string[];
  requireVpnVerification?: boolean;
} = {}) => {
  return async (req: AdaptiveAuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const country = req.headers['x-country'] as string;
      const isVpn = req.headers['x-vpn-detected'] === 'true';

      // Block if from blocked country
      if (options.blockedCountries?.includes(country)) {
        res.status(403).json({
          success: false,
          error: 'Access denied from this location',
          code: 'LOCATION_BLOCKED',
          country: country
        });
        return;
      }

      // Require additional verification if not in allowed countries
      if (options.allowedCountries && !options.allowedCountries.includes(country)) {
        req.headers['x-location-changed'] = 'true';
      }

      // Handle VPN detection
      if (isVpn && options.requireVpnVerification) {
        req.headers['x-location-changed'] = 'true';
      }

      next();

    } catch (error) {
      logger.error('Location-aware auth error', { error });
      next();
    }
  };
};

/**
 * Middleware for time-based authentication policies
 */
export const timeBasedAuth = (options: { 
  allowedHours?: { start: number; end: number }[];
  timezone?: string;
  requireStrongAuthOutsideHours?: boolean;
} = {}) => {
  return async (req: AdaptiveAuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const now = new Date();
      const currentHour = now.getHours();

      if (options.allowedHours) {
        const isAllowedTime = options.allowedHours.some(
          period => currentHour >= period.start && currentHour <= period.end
        );

        if (!isAllowedTime) {
          if (options.requireStrongAuthOutsideHours) {
            // Add custom risk factor for outside hours access
            req.body.customRiskFactors = {
              ...req.body.customRiskFactors,
              outsideBusinessHours: true
            };
          } else {
            res.status(403).json({
              success: false,
              error: 'Access denied outside allowed hours',
              code: 'TIME_RESTRICTION',
              allowedHours: options.allowedHours
            });
            return;
          }
        }
      }

      next();

    } catch (error) {
      logger.error('Time-based auth error', { error });
      next();
    }
  };
};

/**
 * Generate user-friendly guidance for completing challenges
 */
function generateNextStepsGuidance(challenges: any[]): string[] {
  const steps: string[] = [];
  
  for (const challenge of challenges) {
    switch (challenge.type) {
      case 'mfa':
        steps.push('Open your authenticator app and enter the 6-digit code');
        break;
      case 'email_verification':
        steps.push('Check your email for a verification code');
        break;
      case 'sms_verification':
        steps.push('Check your phone for a verification code');
        break;
      case 'device_confirmation':
        steps.push('Confirm this device is trusted for future logins');
        break;
      case 'security_questions':
        steps.push('Answer your security questions');
        break;
      case 'biometric':
        steps.push('Complete biometric verification to confirm your identity');
        break;
      case 'admin_approval':
        steps.push('Your login requires administrative approval due to high risk');
        break;
      default:
        steps.push(`Complete ${challenge.type} verification`);
    }
  }
  
  return steps;
}

/**
 * Middleware to extract and validate biometric data
 */
export const extractBiometrics = (req: Request, res: Response, next: NextFunction): void => {
  try {
    // Extract biometric data from various possible sources
    let biometricData = null;
    
    if (req.body.biometricData) {
      biometricData = req.body.biometricData;
    } else if (req.headers['x-biometric-data']) {
      biometricData = JSON.parse(req.headers['x-biometric-data'] as string);
    }
    
    // Validate biometric data structure if present
    if (biometricData) {
      if (!isValidBiometricData(biometricData)) {
        res.status(400).json({
          success: false,
          error: 'Invalid biometric data format',
          code: 'INVALID_BIOMETRIC_DATA'
        });
        return;
      }
    }
    
    // Attach to request for use by other middleware
    (req as any).biometricData = biometricData;
    next();
    
  } catch (error) {
    logger.error('Biometric extraction error', { error });
    next(); // Continue without biometric data
  }
};

/**
 * Validate biometric data structure
 */
function isValidBiometricData(data: any): boolean {
  if (typeof data !== 'object' || data === null) return false;
  
  // Check for at least one valid biometric data type
  const validTypes = ['keystrokeDynamics', 'mouseMovements', 'touchPatterns', 'scrollBehavior', 'deviceMotion', 'typingPattern'];
  return validTypes.some(type => data[type] !== undefined);
}

export default {
  adaptiveAuth,
  requireHighSecurity,
  requireContinuousAuth,
  handleChallengeResponse,
  deviceAwareAuth,
  locationAwareAuth,
  timeBasedAuth,
  extractBiometrics
};