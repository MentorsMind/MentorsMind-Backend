import { Request, Response } from "express";
import { logger } from "../utils/logger.utils";
import { AdaptiveAuthService } from "../services/adaptive-auth.service";
import { RiskEngineService } from "../services/risk-engine.service";
import { BehavioralBiometricsService } from "../services/behavioral-biometrics.service";
import { AuthenticatedRequest } from "../middleware/auth.middleware";
import { AdaptiveAuthRequest } from "../middleware/adaptive-auth.middleware";
import pool from "../config/database";
import { DateTime } from "luxon";

export const AdaptiveAuthController = {
  /**
   * Assess authentication risk for current request
   */
  async assessRisk(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { actionType, isPrivilegedAction, resourceAccessed } = req.body;
      const userId = req.user?.id;
      
      if (!userId) {
        res.status(401).json({ success: false, error: "Authentication required" });
        return;
      }

      const riskScore = await RiskEngineService.calculateRiskScore(
        userId,
        req,
        {
          userId,
          email: req.user?.email,
          isPrivilegedAction: isPrivilegedAction || false,
          actionType,
          resourceAccessed
        }
      );

      res.json({
        success: true,
        data: {
          riskScore: riskScore.totalScore,
          riskLevel: riskScore.level,
          factors: riskScore.factors,
          reasons: riskScore.reasons,
          recommendedActions: riskScore.recommendedActions
        }
      });

    } catch (error) {
      logger.error("Risk assessment failed", { error, userId: req.user?.id });
      res.status(500).json({ 
        success: false, 
        error: "Risk assessment failed" 
      });
    }
  },

  /**
   * Verify biometric data against user's profile
   */
  async verifyBiometric(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;
      const sessionId = req.headers['x-session-id'] as string;
      const biometricData = (req as any).biometricData;

      if (!userId) {
        res.status(401).json({ success: false, error: "Authentication required" });
        return;
      }

      if (!biometricData) {
        res.status(400).json({ 
          success: false, 
          error: "Biometric data required" 
        });
        return;
      }

      const result = await BehavioralBiometricsService.verifyBehavioralBiometrics(
        userId,
        biometricData,
        sessionId
      );

      res.json({
        success: true,
        data: {
          isAuthentic: result.isAuthentic,
          confidence: result.confidence,
          riskScore: result.riskScore,
          anomalies: result.anomalies,
          recommendedActions: result.recommendedActions
        }
      });

    } catch (error) {
      logger.error("Biometric verification failed", { error, userId: req.user?.id });
      res.status(500).json({ 
        success: false, 
        error: "Biometric verification failed" 
      });
    }
  },

  /**
   * Submit biometric sample for training
   */
  async submitBiometricSample(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;
      const biometricData = (req as any).biometricData;

      if (!userId) {
        res.status(401).json({ success: false, error: "Authentication required" });
        return;
      }

      if (!biometricData) {
        res.status(400).json({ 
          success: false, 
          error: "Biometric data required" 
        });
        return;
      }

      await BehavioralBiometricsService.storeBiometricSample(userId, biometricData);

      res.json({
        success: true,
        message: "Biometric sample stored successfully"
      });

    } catch (error) {
      logger.error("Biometric sample submission failed", { error, userId: req.user?.id });
      res.status(500).json({ 
        success: false, 
        error: "Failed to store biometric sample" 
      });
    }
  },

  /**
   * Get user's biometric profile
   */
  async getBiometricProfile(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;

      if (!userId) {
        res.status(401).json({ success: false, error: "Authentication required" });
        return;
      }

      const profile = await BehavioralBiometricsService.getUserBiometricProfile(userId);

      if (!profile) {
        res.json({
          success: true,
          data: {
            hasProfile: false,
            sampleCount: 0,
            confidence: 0,
            message: "No biometric profile established yet"
          }
        });
        return;
      }

      res.json({
        success: true,
        data: {
          hasProfile: true,
          sampleCount: profile.sampleCount,
          confidence: profile.confidence,
          lastUpdated: profile.lastUpdated,
          authenticityScore: profile.authenticityScore
        }
      });

    } catch (error) {
      logger.error("Get biometric profile failed", { error, userId: req.user?.id });
      res.status(500).json({ 
        success: false, 
        error: "Failed to get biometric profile" 
      });
    }
  },

  /**
   * Get user's registered devices
   */
  async getUserDevices(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;

      if (!userId) {
        res.status(401).json({ success: false, error: "Authentication required" });
        return;
      }

      const { rows } = await pool.query(`
        SELECT 
          id,
          device_fingerprint,
          device_name,
          user_agent,
          first_seen_at,
          last_seen_at,
          trusted_at,
          trust_level
        FROM user_devices 
        WHERE user_id = $1 
        ORDER BY last_seen_at DESC
      `, [userId]);

      const devices = rows.map(row => ({
        id: row.id,
        deviceFingerprint: row.device_fingerprint,
        deviceName: row.device_name || 'Unknown Device',
        userAgent: row.user_agent,
        firstSeenAt: row.first_seen_at,
        lastSeenAt: row.last_seen_at,
        isTrusted: !!row.trusted_at,
        trustedAt: row.trusted_at,
        trustLevel: row.trust_level
      }));

      res.json({
        success: true,
        data: devices
      });

    } catch (error) {
      logger.error("Get user devices failed", { error, userId: req.user?.id });
      res.status(500).json({ 
        success: false, 
        error: "Failed to get user devices" 
      });
    }
  },

  /**
   * Trust a device
   */
  async trustDevice(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;
      const { deviceFingerprint, deviceName } = req.body;

      if (!userId) {
        res.status(401).json({ success: false, error: "Authentication required" });
        return;
      }

      await RiskEngineService.trustDevice(userId, deviceFingerprint);

      // Update device name if provided
      if (deviceName) {
        await pool.query(`
          UPDATE user_devices 
          SET device_name = $3, trust_level = 2
          WHERE user_id = $1 AND device_fingerprint = $2
        `, [userId, deviceFingerprint, deviceName]);
      }

      res.json({
        success: true,
        message: "Device trusted successfully"
      });

    } catch (error) {
      logger.error("Trust device failed", { error, userId: req.user?.id });
      res.status(500).json({ 
        success: false, 
        error: "Failed to trust device" 
      });
    }
  },

  /**
   * Untrust a device
   */
  async untrustDevice(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;
      const { deviceId } = req.params;

      if (!userId) {
        res.status(401).json({ success: false, error: "Authentication required" });
        return;
      }

      // Get device fingerprint
      const { rows } = await pool.query(`
        SELECT device_fingerprint 
        FROM user_devices 
        WHERE id = $1 AND user_id = $2
      `, [deviceId, userId]);

      if (rows.length === 0) {
        res.status(404).json({ 
          success: false, 
          error: "Device not found" 
        });
        return;
      }

      await RiskEngineService.untrustDevice(userId, rows[0].device_fingerprint);

      res.json({
        success: true,
        message: "Device untrusted successfully"
      });

    } catch (error) {
      logger.error("Untrust device failed", { error, userId: req.user?.id });
      res.status(500).json({ 
        success: false, 
        error: "Failed to untrust device" 
      });
    }
  },

  /**
   * Remove a device
   */
  async removeDevice(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;
      const { deviceId } = req.params;

      if (!userId) {
        res.status(401).json({ success: false, error: "Authentication required" });
        return;
      }

      await pool.query(`
        DELETE FROM user_devices 
        WHERE id = $1 AND user_id = $2
      `, [deviceId, userId]);

      res.json({
        success: true,
        message: "Device removed successfully"
      });

    } catch (error) {
      logger.error("Remove device failed", { error, userId: req.user?.id });
      res.status(500).json({ 
        success: false, 
        error: "Failed to remove device" 
      });
    }
  },

  /**
   * Get adaptive authentication sessions
   */
  async getAdaptiveSessions(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;

      if (!userId) {
        res.status(401).json({ success: false, error: "Authentication required" });
        return;
      }

      const { rows } = await pool.query(`
        SELECT 
          session_id,
          strength_score,
          progressive_level,
          risk_score,
          last_verification,
          expires_at,
          active,
          created_at
        FROM adaptive_auth_sessions 
        WHERE user_id = $1 
        ORDER BY last_verification DESC
        LIMIT 20
      `, [userId]);

      const sessions = rows.map(row => ({
        sessionId: row.session_id,
        strengthScore: row.strength_score,
        progressiveLevel: row.progressive_level,
        riskScore: row.risk_score,
        lastVerification: row.last_verification,
        expiresAt: row.expires_at,
        active: row.active,
        createdAt: row.created_at
      }));

      res.json({
        success: true,
        data: sessions
      });

    } catch (error) {
      logger.error("Get adaptive sessions failed", { error, userId: req.user?.id });
      res.status(500).json({ 
        success: false, 
        error: "Failed to get adaptive sessions" 
      });
    }
  },

  /**
   * Get session status
   */
  async getSessionStatus(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;
      const { sessionId } = req.params;

      if (!userId) {
        res.status(401).json({ success: false, error: "Authentication required" });
        return;
      }

      const { rows } = await pool.query(`
        SELECT 
          strength_score,
          progressive_level,
          risk_score,
          last_verification,
          expires_at,
          active
        FROM adaptive_auth_sessions 
        WHERE user_id = $1 AND session_id = $2
      `, [userId, sessionId]);

      if (rows.length === 0) {
        res.status(404).json({ 
          success: false, 
          error: "Session not found" 
        });
        return;
      }

      const session = rows[0];
      const now = new Date();
      const isExpired = session.expires_at && now > session.expires_at;

      res.json({
        success: true,
        data: {
          sessionId,
          strengthScore: session.strength_score,
          progressiveLevel: session.progressive_level,
          riskScore: session.risk_score,
          lastVerification: session.last_verification,
          expiresAt: session.expires_at,
          active: session.active && !isExpired,
          expired: isExpired
        }
      });

    } catch (error) {
      logger.error("Get session status failed", { error, userId: req.user?.id });
      res.status(500).json({ 
        success: false, 
        error: "Failed to get session status" 
      });
    }
  },

  /**
   * Refresh authentication for session
   */
  async refreshAuthentication(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;
      const { sessionId } = req.params;
      const biometricData = (req as any).biometricData;

      if (!userId) {
        res.status(401).json({ success: false, error: "Authentication required" });
        return;
      }

      const result = await AdaptiveAuthService.authenticateAdaptive(req, {
        userId,
        email: req.user?.email,
        sessionId,
        biometricData
      });

      res.json({
        success: true,
        data: {
          decision: result.decision,
          challenges: result.challenges,
          riskScore: result.riskScore,
          riskLevel: result.riskLevel,
          authenticationStrength: result.authenticationStrength,
          requiresContinuousAuth: result.requiresContinuousAuth
        }
      });

    } catch (error) {
      logger.error("Refresh authentication failed", { error, userId: req.user?.id });
      res.status(500).json({ 
        success: false, 
        error: "Failed to refresh authentication" 
      });
    }
  },

  /**
   * Get security incidents for user
   */
  async getSecurityIncidents(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;
      const limit = parseInt(req.query.limit as string) || 10;
      const offset = parseInt(req.query.offset as string) || 0;

      if (!userId) {
        res.status(401).json({ success: false, error: "Authentication required" });
        return;
      }

      const { rows } = await pool.query(`
        SELECT 
          id,
          incident_type,
          severity,
          description,
          ip_address,
          status,
          created_at,
          resolved_at
        FROM security_incidents 
        WHERE user_id = $1 
        ORDER BY created_at DESC
        LIMIT $2 OFFSET $3
      `, [userId, limit, offset]);

      const incidents = rows.map(row => ({
        id: row.id,
        incidentType: row.incident_type,
        severity: row.severity,
        description: row.description,
        ipAddress: row.ip_address,
        status: row.status,
        createdAt: row.created_at,
        resolvedAt: row.resolved_at
      }));

      res.json({
        success: true,
        data: incidents,
        pagination: {
          limit,
          offset,
          hasMore: rows.length === limit
        }
      });

    } catch (error) {
      logger.error("Get security incidents failed", { error, userId: req.user?.id });
      res.status(500).json({ 
        success: false, 
        error: "Failed to get security incidents" 
      });
    }
  },

  /**
   * Start continuous monitoring
   */
  async startContinuousMonitoring(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;
      const sessionId = req.headers['x-session-id'] as string || `monitoring_${Date.now()}`;

      if (!userId) {
        res.status(401).json({ success: false, error: "Authentication required" });
        return;
      }

      await BehavioralBiometricsService.startContinuousMonitoring(userId, sessionId);

      res.json({
        success: true,
        data: {
          sessionId,
          message: "Continuous monitoring started",
          monitoringInterval: 30 // seconds
        }
      });

    } catch (error) {
      logger.error("Start continuous monitoring failed", { error, userId: req.user?.id });
      res.status(500).json({ 
        success: false, 
        error: "Failed to start continuous monitoring" 
      });
    }
  },

  /**
   * Monitoring heartbeat
   */
  async monitoringHeartbeat(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;
      const sessionId = req.headers['x-session-id'] as string;
      const biometricData = (req as any).biometricData;

      if (!userId || !sessionId) {
        res.status(400).json({ 
          success: false, 
          error: "User ID and session ID required" 
        });
        return;
      }

      const result = await AdaptiveAuthService.monitorContinuousAuth(
        userId,
        sessionId,
        biometricData
      );

      res.json({
        success: true,
        data: {
          needsReauth: result.needsReauth,
          challenges: result.challenges,
          riskTrend: result.riskTrend,
          nextHeartbeat: new Date(Date.now() + 30000) // 30 seconds
        }
      });

    } catch (error) {
      logger.error("Monitoring heartbeat failed", { error, userId: req.user?.id });
      res.status(500).json({ 
        success: false, 
        error: "Monitoring heartbeat failed" 
      });
    }
  },

  /**
   * Stop continuous monitoring
   */
  async stopContinuousMonitoring(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;
      const sessionId = req.headers['x-session-id'] as string;

      if (!userId || !sessionId) {
        res.status(400).json({ 
          success: false, 
          error: "User ID and session ID required" 
        });
        return;
      }

      await BehavioralBiometricsService.stopContinuousMonitoring(userId, sessionId);

      res.json({
        success: true,
        message: "Continuous monitoring stopped"
      });

    } catch (error) {
      logger.error("Stop continuous monitoring failed", { error, userId: req.user?.id });
      res.status(500).json({ 
        success: false, 
        error: "Failed to stop continuous monitoring" 
      });
    }
  },

  /**
   * Placeholder methods for admin functions (implement based on requirements)
   */
  async getAdminRiskAssessments(req: AuthenticatedRequest, res: Response): Promise<void> {
    res.status(501).json({ success: false, error: "Not implemented yet" });
  },

  async resetUserRisk(req: AuthenticatedRequest, res: Response): Promise<void> {
    res.status(501).json({ success: false, error: "Not implemented yet" });
  },

  async investigateIncident(req: AuthenticatedRequest, res: Response): Promise<void> {
    res.status(501).json({ success: false, error: "Not implemented yet" });
  },

  async resolveSecurityIncident(req: AuthenticatedRequest, res: Response): Promise<void> {
    res.status(501).json({ success: false, error: "Not implemented yet" });
  },

  async getRiskTrends(req: AuthenticatedRequest, res: Response): Promise<void> {
    res.status(501).json({ success: false, error: "Not implemented yet" });
  },

  async getAuthenticationPatterns(req: AuthenticatedRequest, res: Response): Promise<void> {
    res.status(501).json({ success: false, error: "Not implemented yet" });
  },

  async getAuthPolicies(req: AuthenticatedRequest, res: Response): Promise<void> {
    res.status(501).json({ success: false, error: "Not implemented yet" });
  },

  async updateAuthPolicies(req: AuthenticatedRequest, res: Response): Promise<void> {
    res.status(501).json({ success: false, error: "Not implemented yet" });
  },

  async simulateRisk(req: AuthenticatedRequest, res: Response): Promise<void> {
    res.status(501).json({ success: false, error: "Not implemented yet" });
  }
};