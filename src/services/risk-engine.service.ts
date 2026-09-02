import { logger } from "../utils/logger.utils";
import pool from "../config/database";
import { Request } from "express";
import { DateTime } from "luxon";
import axios from "axios";
import { AuthenticatedRequest } from "../middleware/auth.middleware";

export interface RiskFactors {
  device: {
    newDevice: boolean;
    deviceFingerprint: string;
    trustedDevice: boolean;
  };
  location: {
    newLocation: boolean;
    country: string;
    city?: string;
    vpnDetected: boolean;
    highRiskCountry: boolean;
    travelPattern: boolean;
  };
  behavioral: {
    unusualLoginTime: boolean;
    frequentFailures: boolean;
    rapidSuccessiveLogins: boolean;
    suspiciousUserAgent: boolean;
  };
  historical: {
    accountAge: number; // days
    previousSecurityIncidents: number;
    mfaEnabled: boolean;
    passwordChangeRecency: number; // days
  };
  network: {
    ipReputation: 'clean' | 'suspicious' | 'malicious';
    isDataCenter: boolean;
    isProxy: boolean;
    torNetwork: boolean;
  };
}

export interface RiskScore {
  totalScore: number; // 0-100, higher is riskier
  level: 'low' | 'medium' | 'high' | 'critical';
  factors: RiskFactors;
  reasons: string[];
  recommendedActions: AuthAction[];
}

export type AuthAction = 
  | 'allow'
  | 'require_mfa' 
  | 'require_email_verification'
  | 'require_device_confirmation'
  | 'challenge_security_questions'
  | 'require_admin_approval'
  | 'block_temporarily'
  | 'block_permanently';

// High-risk countries for authentication
const HIGH_RISK_COUNTRIES = [
  'CN', 'RU', 'KP', 'IR', 'SY', 'VE', 'MM', 'AF', 'IQ', 'SO'
];

// Suspicious user agents patterns
const SUSPICIOUS_USER_AGENTS = [
  /bot/i,
  /crawler/i,
  /spider/i,
  /scraper/i,
  /python/i,
  /curl/i,
  /wget/i,
  /automated/i
];

export const RiskEngineService = {
  /**
   * Calculate comprehensive risk score for authentication attempt
   */
  async calculateRiskScore(
    userId: string | null,
    req: Request | AuthenticatedRequest,
    context: {
      email?: string;
      isLoginAttempt?: boolean;
      isPasswordReset?: boolean;
      isDeviceChange?: boolean;
    } = {}
  ): Promise<RiskScore> {
    try {
      const ipAddress = this.extractIpAddress(req);
      const userAgent = req.headers['user-agent'] || '';
      const deviceFingerprint = this.generateDeviceFingerprint(req);

      // Get geo-location data
      const locationData = await this.getLocationData(ipAddress);
      
      // Get network reputation
      const networkData = await this.analyzeNetwork(ipAddress);

      // Device analysis
      const deviceData = await this.analyzeDevice(userId, deviceFingerprint, userAgent);

      // Behavioral analysis
      const behavioralData = await this.analyzeBehavior(userId, context.email, ipAddress, userAgent);

      // Historical analysis
      const historicalData = await this.analyzeHistorical(userId, context.email);

      const riskFactors: RiskFactors = {
        device: deviceData,
        location: locationData,
        behavioral: behavioralData,
        historical: historicalData,
        network: networkData
      };

      // Calculate weighted risk score
      const totalScore = this.calculateWeightedScore(riskFactors);
      const level = this.determineRiskLevel(totalScore);
      const reasons = this.generateReasons(riskFactors);
      const recommendedActions = this.recommendActions(totalScore, riskFactors, context);

      const riskScore: RiskScore = {
        totalScore,
        level,
        factors: riskFactors,
        reasons,
        recommendedActions
      };

      // Log risk assessment
      await this.logRiskAssessment(userId, context.email, riskScore, req);

      return riskScore;
    } catch (error) {
      logger.error('Risk engine calculation failed', { 
        userId, 
        email: context.email,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      
      // Return medium risk as fallback
      return this.getFallbackRiskScore();
    }
  },

  /**
   * Analyze device characteristics
   */
  async analyzeDevice(userId: string | null, deviceFingerprint: string, userAgent: string): Promise<RiskFactors['device']> {
    let newDevice = true;
    let trustedDevice = false;

    if (userId) {
      // Check if device has been seen before
      const deviceQuery = `
        SELECT id, trusted_at, last_seen_at 
        FROM user_devices 
        WHERE user_id = $1 AND device_fingerprint = $2
      `;
      const { rows } = await pool.query(deviceQuery, [userId, deviceFingerprint]);
      
      if (rows.length > 0) {
        newDevice = false;
        trustedDevice = !!rows[0].trusted_at;
        
        // Update last seen
        await pool.query(
          'UPDATE user_devices SET last_seen_at = NOW() WHERE id = $1',
          [rows[0].id]
        );
      } else {
        // Register new device
        await pool.query(`
          INSERT INTO user_devices (user_id, device_fingerprint, user_agent, first_seen_at, last_seen_at)
          VALUES ($1, $2, $3, NOW(), NOW())
          ON CONFLICT (user_id, device_fingerprint) DO UPDATE SET last_seen_at = NOW()
        `, [userId, deviceFingerprint, userAgent]);
      }
    }

    return {
      newDevice,
      deviceFingerprint,
      trustedDevice
    };
  },

  /**
   * Analyze location and geographical factors
   */
  async getLocationData(ipAddress: string): Promise<RiskFactors['location']> {
    try {
      // Use IP geolocation service (in production, use a proper service like MaxMind)
      const geoResponse = await axios.get(`http://ip-api.com/json/${ipAddress}`, {
        timeout: 3000,
        params: {
          fields: 'status,country,countryCode,city,proxy,hosting'
        }
      });

      if (geoResponse.data.status === 'success') {
        const { country, countryCode, city, proxy, hosting } = geoResponse.data;
        
        return {
          newLocation: false, // This would need historical comparison
          country: countryCode || 'Unknown',
          city: city || undefined,
          vpnDetected: proxy || hosting,
          highRiskCountry: HIGH_RISK_COUNTRIES.includes(countryCode),
          travelPattern: false // This would need temporal analysis
        };
      }
    } catch (error) {
      logger.warn('Geolocation lookup failed', { ipAddress, error });
    }

    return {
      newLocation: false,
      country: 'Unknown',
      vpnDetected: false,
      highRiskCountry: false,
      travelPattern: false
    };
  },

  /**
   * Analyze network reputation and characteristics
   */
  async analyzeNetwork(ipAddress: string): Promise<RiskFactors['network']> {
    // In production, integrate with threat intelligence feeds
    const isPrivateIP = this.isPrivateIP(ipAddress);
    
    return {
      ipReputation: 'clean', // Would integrate with threat feeds
      isDataCenter: false, // Would check against datacenter IP ranges
      isProxy: false, // Would check proxy detection services
      torNetwork: false // Would check Tor exit node lists
    };
  },

  /**
   * Analyze behavioral patterns
   */
  async analyzeBehavior(
    userId: string | null, 
    email: string | undefined, 
    ipAddress: string,
    userAgent: string
  ): Promise<RiskFactors['behavioral']> {
    const now = DateTime.now();
    const identifier = userId || email;

    if (!identifier) {
      return {
        unusualLoginTime: false,
        frequentFailures: false,
        rapidSuccessiveLogins: false,
        suspiciousUserAgent: false
      };
    }

    // Check for unusual login time (based on user's historical pattern)
    const unusualLoginTime = await this.checkUnusualLoginTime(identifier);
    
    // Check for frequent login failures in recent period
    const recentFailures = await pool.query(`
      SELECT COUNT(*) as count 
      FROM auth_attempts 
      WHERE (user_id = $1 OR email = $2) 
        AND success = false 
        AND created_at > NOW() - INTERVAL '1 hour'
    `, [userId, email]);
    
    const frequentFailures = parseInt(recentFailures.rows[0]?.count || '0') >= 3;

    // Check for rapid successive logins
    const recentLogins = await pool.query(`
      SELECT COUNT(*) as count 
      FROM auth_attempts 
      WHERE (user_id = $1 OR email = $2) 
        AND success = true 
        AND created_at > NOW() - INTERVAL '10 minutes'
    `, [userId, email]);
    
    const rapidSuccessiveLogins = parseInt(recentLogins.rows[0]?.count || '0') >= 3;

    // Check suspicious user agent
    const suspiciousUserAgent = SUSPICIOUS_USER_AGENTS.some(pattern => pattern.test(userAgent));

    return {
      unusualLoginTime,
      frequentFailures,
      rapidSuccessiveLogins,
      suspiciousUserAgent
    };
  },

  /**
   * Analyze historical user data
   */
  async analyzeHistorical(userId: string | null, email: string | undefined): Promise<RiskFactors['historical']> {
    if (!userId && !email) {
      return {
        accountAge: 0,
        previousSecurityIncidents: 0,
        mfaEnabled: false,
        passwordChangeRecency: 999
      };
    }

    let userQuery = 'SELECT created_at, mfa_enabled, password_changed_at FROM users WHERE ';
    let params: any[] = [];
    
    if (userId) {
      userQuery += 'id = $1';
      params.push(userId);
    } else {
      userQuery += 'email = $1';
      params.push(email);
    }

    const { rows } = await pool.query(userQuery, params);
    
    if (rows.length === 0) {
      return {
        accountAge: 0,
        previousSecurityIncidents: 0,
        mfaEnabled: false,
        passwordChangeRecency: 999
      };
    }

    const user = rows[0];
    const accountAge = DateTime.now().diff(DateTime.fromJSDate(user.created_at), 'days').days;
    const passwordChangeRecency = user.password_changed_at 
      ? DateTime.now().diff(DateTime.fromJSDate(user.password_changed_at), 'days').days
      : 999;

    // Count security incidents
    const incidentsQuery = `
      SELECT COUNT(*) as count 
      FROM security_incidents 
      WHERE user_id = $1 
        AND created_at > NOW() - INTERVAL '90 days'
    `;
    const incidentResult = await pool.query(incidentsQuery, [userId]);
    const previousSecurityIncidents = parseInt(incidentResult.rows[0]?.count || '0');

    return {
      accountAge,
      previousSecurityIncidents,
      mfaEnabled: user.mfa_enabled || false,
      passwordChangeRecency
    };
  },

  /**
   * Calculate weighted risk score
   */
  calculateWeightedScore(factors: RiskFactors): number {
    let score = 0;

    // Device factors (30% weight)
    if (factors.device.newDevice) score += 15;
    if (!factors.device.trustedDevice) score += 10;

    // Location factors (25% weight)
    if (factors.location.newLocation) score += 10;
    if (factors.location.highRiskCountry) score += 20;
    if (factors.location.vpnDetected) score += 8;
    if (factors.location.travelPattern) score += 5;

    // Behavioral factors (25% weight)
    if (factors.behavioral.unusualLoginTime) score += 8;
    if (factors.behavioral.frequentFailures) score += 15;
    if (factors.behavioral.rapidSuccessiveLogins) score += 10;
    if (factors.behavioral.suspiciousUserAgent) score += 12;

    // Historical factors (10% weight)
    if (factors.historical.accountAge < 1) score += 8;
    if (factors.historical.previousSecurityIncidents > 0) score += 10;
    if (!factors.historical.mfaEnabled) score += 5;
    if (factors.historical.passwordChangeRecency > 90) score += 3;

    // Network factors (10% weight)
    if (factors.network.ipReputation === 'suspicious') score += 8;
    if (factors.network.ipReputation === 'malicious') score += 20;
    if (factors.network.isDataCenter) score += 5;
    if (factors.network.isProxy) score += 8;
    if (factors.network.torNetwork) score += 15;

    return Math.min(100, Math.max(0, score));
  },

  /**
   * Determine risk level from score
   */
  determineRiskLevel(score: number): RiskScore['level'] {
    if (score < 20) return 'low';
    if (score < 40) return 'medium';
    if (score < 70) return 'high';
    return 'critical';
  },

  /**
   * Generate human-readable reasons
   */
  generateReasons(factors: RiskFactors): string[] {
    const reasons: string[] = [];

    if (factors.device.newDevice) reasons.push('Login from new device');
    if (factors.location.newLocation) reasons.push('Login from new location');
    if (factors.location.highRiskCountry) reasons.push('Login from high-risk country');
    if (factors.location.vpnDetected) reasons.push('VPN/proxy detected');
    if (factors.behavioral.frequentFailures) reasons.push('Multiple recent failed attempts');
    if (factors.behavioral.unusualLoginTime) reasons.push('Unusual login time');
    if (factors.behavioral.suspiciousUserAgent) reasons.push('Suspicious user agent');
    if (factors.network.ipReputation !== 'clean') reasons.push('IP address has poor reputation');
    if (!factors.historical.mfaEnabled) reasons.push('MFA not enabled');
    if (factors.historical.previousSecurityIncidents > 0) reasons.push('Previous security incidents');

    return reasons;
  },

  /**
   * Recommend authentication actions
   */
  recommendActions(score: number, factors: RiskFactors, context: any): AuthAction[] {
    const actions: AuthAction[] = [];

    if (score >= 80) {
      actions.push('block_temporarily');
      return actions;
    }

    if (score >= 60) {
      actions.push('require_admin_approval');
      if (!factors.historical.mfaEnabled) {
        actions.push('require_mfa');
      }
      return actions;
    }

    if (score >= 40) {
      actions.push('require_device_confirmation');
      if (factors.device.newDevice) {
        actions.push('require_email_verification');
      }
    }

    if (score >= 25 || factors.device.newDevice || factors.location.newLocation) {
      actions.push('require_mfa');
    }

    if (actions.length === 0) {
      actions.push('allow');
    }

    return actions;
  },

  /**
   * Check if current login time is unusual for user
   */
  async checkUnusualLoginTime(identifier: string): Promise<boolean> {
    try {
      const historicalLogins = await pool.query(`
        SELECT EXTRACT(hour FROM created_at) as login_hour
        FROM auth_attempts 
        WHERE (user_id = $1 OR email = $1) 
          AND success = true 
          AND created_at > NOW() - INTERVAL '30 days'
        ORDER BY created_at DESC 
        LIMIT 50
      `, [identifier]);

      if (historicalLogins.rows.length < 5) return false;

      const currentHour = new Date().getHours();
      const historicalHours = historicalLogins.rows.map(row => parseInt(row.login_hour));
      
      // Check if current hour is within 2 hours of typical login times
      const typicalHours = this.getTypicalHours(historicalHours);
      const isUnusual = !typicalHours.some(hour => Math.abs(hour - currentHour) <= 2);

      return isUnusual;
    } catch (error) {
      return false;
    }
  },

  /**
   * Get typical login hours for user
   */
  getTypicalHours(hours: number[]): number[] {
    const hourCounts = new Map<number, number>();
    
    hours.forEach(hour => {
      hourCounts.set(hour, (hourCounts.get(hour) || 0) + 1);
    });

    // Return hours that appear more than 20% of the time
    const threshold = hours.length * 0.2;
    return Array.from(hourCounts.entries())
      .filter(([_, count]) => count >= threshold)
      .map(([hour, _]) => hour);
  },

  /**
   * Extract IP address from request
   */
  extractIpAddress(req: Request): string {
    return (
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      (req.headers['x-real-ip'] as string) ||
      req.connection?.remoteAddress ||
      req.socket?.remoteAddress ||
      '127.0.0.1'
    );
  },

  /**
   * Generate device fingerprint
   */
  generateDeviceFingerprint(req: Request): string {
    const components = [
      req.headers['user-agent'] || '',
      req.headers['accept-language'] || '',
      req.headers['accept-encoding'] || '',
      req.headers['accept'] || ''
    ];
    
    return Buffer.from(components.join('|')).toString('base64');
  },

  /**
   * Check if IP is private
   */
  isPrivateIP(ip: string): boolean {
    const privateRanges = [
      /^10\./,
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
      /^192\.168\./,
      /^127\./,
      /^::1$/,
      /^fc00:/,
      /^fe80:/
    ];
    
    return privateRanges.some(range => range.test(ip));
  },

  /**
   * Log risk assessment
   */
  async logRiskAssessment(
    userId: string | null, 
    email: string | undefined, 
    riskScore: RiskScore, 
    req: Request
  ): Promise<void> {
    try {
      await pool.query(`
        INSERT INTO risk_assessments (
          user_id, email, risk_score, risk_level, factors, reasons, 
          recommended_actions, ip_address, user_agent, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
      `, [
        userId,
        email,
        riskScore.totalScore,
        riskScore.level,
        JSON.stringify(riskScore.factors),
        JSON.stringify(riskScore.reasons),
        JSON.stringify(riskScore.recommendedActions),
        this.extractIpAddress(req),
        req.headers['user-agent'] || null
      ]);
    } catch (error) {
      logger.error('Failed to log risk assessment', { error });
    }
  },

  /**
   * Get fallback risk score when calculation fails
   */
  getFallbackRiskScore(): RiskScore {
    return {
      totalScore: 30,
      level: 'medium',
      factors: {
        device: { newDevice: false, deviceFingerprint: '', trustedDevice: false },
        location: { newLocation: false, country: 'Unknown', vpnDetected: false, highRiskCountry: false, travelPattern: false },
        behavioral: { unusualLoginTime: false, frequentFailures: false, rapidSuccessiveLogins: false, suspiciousUserAgent: false },
        historical: { accountAge: 0, previousSecurityIncidents: 0, mfaEnabled: false, passwordChangeRecency: 999 },
        network: { ipReputation: 'clean', isDataCenter: false, isProxy: false, torNetwork: false }
      },
      reasons: ['Risk calculation unavailable'],
      recommendedActions: ['require_mfa']
    };
  },

  /**
   * Update device trust status
   */
  async trustDevice(userId: string, deviceFingerprint: string): Promise<void> {
    await pool.query(`
      UPDATE user_devices 
      SET trusted_at = NOW() 
      WHERE user_id = $1 AND device_fingerprint = $2
    `, [userId, deviceFingerprint]);
  },

  /**
   * Revoke device trust
   */
  async untrustDevice(userId: string, deviceFingerprint: string): Promise<void> {
    await pool.query(`
      UPDATE user_devices 
      SET trusted_at = NULL 
      WHERE user_id = $1 AND device_fingerprint = $2
    `, [userId, deviceFingerprint]);
  }
};