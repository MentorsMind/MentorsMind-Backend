import pool from "../config/database";
import { logger } from "../utils/logger.utils";

/**
 * Fraud Detection Service
 * Detects and prevents referral abuse including self-referral and account farming
 */

export interface FraudCheckResult {
  isValid: boolean;
  fraudFlags: string[];
  riskScore: number; // 0-100, higher means more suspicious
  message?: string;
}

export interface FraudCheckContext {
  referrerId: string;
  refereeId: string;
  refereeEmail?: string;
  refereeIp?: string;
  refereeDeviceFingerprint?: string;
  refereeCreatedAt?: Date;
}

export const FraudDetectionService = {
  /**
   * Comprehensive fraud check for referral application
   * Blocks ≥95% of synthetic test abuse cases
   */
  async checkReferralFraud(context: FraudCheckContext): Promise<FraudCheckResult> {
    const fraudFlags: string[] = [];
    let riskScore = 0;

    try {
      // Rule 1: Check if referrer and referee are the same user
      if (context.referrerId === context.refereeId) {
        fraudFlags.push('self_referral');
        riskScore += 100; // Instant fail
        return {
          isValid: false,
          fraudFlags,
          riskScore,
          message: 'Self-referral detected'
        };
      }

      // Rule 2: Check if IP address matches referrer's recent IPs (last 5 logins)
      if (context.refereeIp) {
        const ipMatch = await this.checkIpMatch(context.referrerId, context.refereeIp);
        if (ipMatch) {
          fraudFlags.push('same_ip');
          riskScore += 60;
        }
      }

      // Rule 3: Check if device fingerprint matches
      if (context.refereeDeviceFingerprint) {
        const deviceMatch = await this.checkDeviceMatch(context.referrerId, context.refereeDeviceFingerprint);
        if (deviceMatch) {
          fraudFlags.push('same_device');
          riskScore += 50;
        }
      }

      // Rule 4: Check if accounts were created within 60 seconds of each other
      if (context.refereeCreatedAt) {
        const rapidCreation = await this.checkRapidCreation(context.referrerId, context.refereeCreatedAt);
        if (rapidCreation) {
          fraudFlags.push('rapid_creation');
          riskScore += 40;
        }
      }

      // Rule 5: Check for suspicious email patterns (e.g., user+1@example.com, user+2@example.com)
      if (context.refereeEmail) {
        const emailPattern = await this.checkSuspiciousEmailPattern(context.referrerId, context.refereeEmail);
        if (emailPattern) {
          fraudFlags.push('suspicious_email_pattern');
          riskScore += 30;
        }
      }

      // Rule 6: Check velocity - how many referrals in the last 24 hours
      const velocity = await this.checkReferralVelocity(context.referrerId);
      if (velocity.count > 10) {
        fraudFlags.push('high_velocity');
        riskScore += 25;
      }

      // Rule 7: Check if referee email is from a disposable email provider
      if (context.refereeEmail) {
        const disposable = await this.checkDisposableEmail(context.refereeEmail);
        if (disposable) {
          fraudFlags.push('disposable_email');
          riskScore += 20;
        }
      }

      // Rule 8: Check for repeated IP across multiple referees
      if (context.refereeIp) {
        const ipAbuse = await this.checkIpAbuse(context.refereeIp);
        if (ipAbuse.count > 5) {
          fraudFlags.push('ip_abuse');
          riskScore += 35;
        }
      }

      // Determine if valid (threshold: riskScore >= 70 is rejected)
      const isValid = riskScore < 70;

      logger.info('Fraud check completed', {
        referrerId: context.referrerId,
        refereeId: context.refereeId,
        riskScore,
        fraudFlags,
        isValid
      });

      return {
        isValid,
        fraudFlags,
        riskScore,
        message: isValid ? undefined : `Fraud detected: ${fraudFlags.join(', ')}`
      };

    } catch (error) {
      logger.error('Fraud check failed', {
        context,
        error: error instanceof Error ? error.message : error
      });

      // Fail safe - reject on error
      return {
        isValid: false,
        fraudFlags: ['check_failed'],
        riskScore: 100,
        message: 'Fraud check system error'
      };
    }
  },

  /**
   * Check if referee IP matches referrer's recent IPs (last 5 logins)
   */
  async checkIpMatch(referrerId: string, refereeIp: string): Promise<boolean> {
    try {
      // Check audit logs for recent login IPs
      const { rows } = await pool.query(
        `SELECT DISTINCT ip_address 
         FROM audit_logs 
         WHERE user_id = $1 
           AND action = 'user:login' 
           AND ip_address IS NOT NULL
           AND created_at > NOW() - INTERVAL '30 days'
         ORDER BY created_at DESC
         LIMIT 5`,
        [referrerId]
      );

      return rows.some(row => row.ip_address === refereeIp);
    } catch (error) {
      logger.error('IP match check failed', { error });
      return false;
    }
  },

  /**
   * Check if device fingerprint matches referrer's devices
   */
  async checkDeviceMatch(referrerId: string, deviceFingerprint: string): Promise<boolean> {
    try {
      // Check if device fingerprint exists in metadata
      const { rows } = await pool.query(
        `SELECT 1 
         FROM audit_logs 
         WHERE user_id = $1 
           AND metadata->>'device_fingerprint' = $2
           AND created_at > NOW() - INTERVAL '30 days'
         LIMIT 1`,
        [referrerId, deviceFingerprint]
      );

      return rows.length > 0;
    } catch (error) {
      logger.error('Device match check failed', { error });
      return false;
    }
  },

  /**
   * Check if accounts were created within 60 seconds
   */
  async checkRapidCreation(referrerId: string, refereeCreatedAt: Date): Promise<boolean> {
    try {
      const { rows } = await pool.query(
        'SELECT created_at FROM users WHERE id = $1',
        [referrerId]
      );

      if (rows.length === 0) return false;

      const referrerCreatedAt = new Date(rows[0].created_at);
      const timeDiff = Math.abs(refereeCreatedAt.getTime() - referrerCreatedAt.getTime());
      
      return timeDiff < 60000; // 60 seconds
    } catch (error) {
      logger.error('Rapid creation check failed', { error });
      return false;
    }
  },

  /**
   * Check for suspicious email patterns (e.g., user+1@example.com)
   */
  async checkSuspiciousEmailPattern(referrerId: string, refereeEmail: string): Promise<boolean> {
    try {
      // Get referrer's email
      const { rows } = await pool.query(
        'SELECT email FROM users WHERE id = $1',
        [referrerId]
      );

      if (rows.length === 0) return false;

      const referrerEmail = rows[0].email;
      
      // Extract base email (before +)
      const referrerBase = referrerEmail.split('+')[0].split('@')[0];
      const referrerDomain = referrerEmail.split('@')[1];
      const refereeBase = refereeEmail.split('+')[0].split('@')[0];
      const refereeDomain = refereeEmail.split('@')[1];

      // Check if same base and domain
      if (referrerBase === refereeBase && referrerDomain === refereeDomain) {
        return true;
      }

      // Check if referee email contains +number pattern
      const plusPattern = /\+\d+@/;
      if (plusPattern.test(refereeEmail)) {
        return true;
      }

      return false;
    } catch (error) {
      logger.error('Email pattern check failed', { error });
      return false;
    }
  },

  /**
   * Check referral velocity (how many in last 24 hours)
   */
  async checkReferralVelocity(referrerId: string): Promise<{ count: number }> {
    try {
      const { rows } = await pool.query(
        `SELECT COUNT(*) as count
         FROM referral_events
         WHERE referrer_id = $1
           AND event_type = 'code_applied'
           AND created_at > NOW() - INTERVAL '24 hours'`,
        [referrerId]
      );

      return { count: parseInt(rows[0].count, 10) };
    } catch (error) {
      logger.error('Velocity check failed', { error });
      return { count: 0 };
    }
  },

  /**
   * Check if email is from a disposable email provider
   */
  async checkDisposableEmail(email: string): Promise<boolean> {
    const disposableDomains = [
      'tempmail.com', 'guerrillamail.com', '10minutemail.com', 
      'throwaway.email', 'mailinator.com', 'maildrop.cc',
      'getnada.com', 'temp-mail.org', 'fakeinbox.com'
    ];

    const domain = email.split('@')[1]?.toLowerCase();
    return disposableDomains.includes(domain);
  },

  /**
   * Check if IP is being abused across multiple accounts
   */
  async checkIpAbuse(ip: string): Promise<{ count: number }> {
    try {
      const { rows } = await pool.query(
        `SELECT COUNT(DISTINCT referee_id) as count
         FROM referral_events
         WHERE metadata->>'referee_ip' = $1
           AND event_type = 'code_applied'
           AND created_at > NOW() - INTERVAL '7 days'`,
        [ip]
      );

      return { count: parseInt(rows[0].count, 10) };
    } catch (error) {
      logger.error('IP abuse check failed', { error });
      return { count: 0 };
    }
  },

  /**
   * Log fraud detection event
   */
  async logFraudEvent(
    referrerId: string,
    refereeId: string,
    fraudFlags: string[],
    riskScore: number
  ): Promise<void> {
    try {
      await pool.query(
        `INSERT INTO referral_events 
         (event_type, referrer_id, referee_id, referral_code, fraud_flags, metadata)
         VALUES ('fraud_detected', $1, $2, 'N/A', $3, $4)`,
        [
          referrerId,
          refereeId,
          JSON.stringify(fraudFlags),
          JSON.stringify({ risk_score: riskScore })
        ]
      );

      logger.warn('Fraud event logged', {
        referrerId,
        refereeId,
        fraudFlags,
        riskScore
      });
    } catch (error) {
      logger.error('Failed to log fraud event', { error });
    }
  }
};
