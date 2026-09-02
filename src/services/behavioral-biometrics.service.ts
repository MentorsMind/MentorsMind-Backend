import { logger } from "../utils/logger.utils";
import pool from "../config/database";
import { Request } from "express";
import { DateTime } from "luxon";

export interface BiometricData {
  keystrokeDynamics?: KeystrokeDynamics;
  mouseMovements?: MouseMovement[];
  touchPatterns?: TouchPattern[];
  scrollBehavior?: ScrollBehavior;
  deviceMotion?: DeviceMotion;
  typingPattern?: TypingPattern;
}

export interface KeystrokeDynamics {
  dwellTimes: number[]; // Time key is held down
  flightTimes: number[]; // Time between key presses
  rhythm: number; // Overall typing rhythm score
  pressure: number[]; // Key press pressure (if available)
  typingSpeed: number; // Words per minute
  pausePatterns: number[]; // Pauses between words
}

export interface MouseMovement {
  x: number;
  y: number;
  timestamp: number;
  pressure?: number;
  velocity?: number;
  acceleration?: number;
}

export interface TouchPattern {
  x: number;
  y: number;
  pressure: number;
  area: number;
  duration: number;
  timestamp: number;
  gestureType: 'tap' | 'swipe' | 'pinch' | 'rotate';
}

export interface ScrollBehavior {
  velocity: number;
  acceleration: number;
  direction: 'up' | 'down' | 'left' | 'right';
  pattern: 'smooth' | 'jerky' | 'consistent';
  pauseFrequency: number;
}

export interface DeviceMotion {
  accelerometerX: number;
  accelerometerY: number;
  accelerometerZ: number;
  gyroscopeX: number;
  gyroscopeY: number;
  gyroscopeZ: number;
  orientation: number;
}

export interface TypingPattern {
  avgWordLength: number;
  commonMistakes: string[];
  correctionPatterns: string[];
  preferredKeys: string[];
  handednessIndicators: {
    leftHandDominance: number; // 0-1 score
    rightHandDominance: number; // 0-1 score
  };
}

export interface BiometricProfile {
  userId: string;
  baseline: BiometricData;
  confidence: number; // 0-1, how confident we are in this profile
  sampleCount: number;
  lastUpdated: Date;
  authenticityScore: number; // Current session authenticity (0-1)
}

export interface BiometricVerificationResult {
  isAuthentic: boolean;
  confidence: number; // 0-1
  anomalies: string[];
  riskScore: number; // 0-100
  recommendedActions: ('allow' | 'challenge' | 'block' | 'monitor')[];
}

// Thresholds for behavioral analysis
const AUTHENTICITY_THRESHOLD = 0.7;
const ANOMALY_THRESHOLD = 0.3;
const MIN_SAMPLES_FOR_BASELINE = 10;
const KEYSTROKE_TOLERANCE = 0.2; // 20% variance allowed
const MOUSE_VELOCITY_THRESHOLD = 1000; // pixels per second

export const BehavioralBiometricsService = {
  /**
   * Analyze submitted biometric data against user's baseline
   */
  async verifyBehavioralBiometrics(
    userId: string,
    currentData: BiometricData,
    sessionId?: string
  ): Promise<BiometricVerificationResult> {
    try {
      // Get user's biometric profile
      const profile = await this.getUserBiometricProfile(userId);
      
      if (!profile || profile.sampleCount < MIN_SAMPLES_FOR_BASELINE) {
        // Not enough data for verification - collect more samples
        await this.storeBiometricSample(userId, currentData);
        return {
          isAuthentic: true,
          confidence: 0.5,
          anomalies: ['Insufficient baseline data'],
          riskScore: 25,
          recommendedActions: ['monitor']
        };
      }

      // Perform behavioral verification
      const keystrokeResult = await this.verifyKeystrokeDynamics(
        profile.baseline.keystrokeDynamics,
        currentData.keystrokeDynamics
      );
      
      const mouseResult = await this.verifyMouseBehavior(
        profile.baseline.mouseMovements,
        currentData.mouseMovements
      );
      
      const typingResult = await this.verifyTypingPattern(
        profile.baseline.typingPattern,
        currentData.typingPattern
      );
      
      const touchResult = await this.verifyTouchPatterns(
        profile.baseline.touchPatterns,
        currentData.touchPatterns
      );

      // Combine results
      const results = [keystrokeResult, mouseResult, typingResult, touchResult]
        .filter(r => r !== null) as { score: number; anomalies: string[] }[];
      
      if (results.length === 0) {
        return {
          isAuthentic: true,
          confidence: 0.3,
          anomalies: ['No biometric data available'],
          riskScore: 40,
          recommendedActions: ['monitor']
        };
      }

      const avgScore = results.reduce((sum, r) => sum + r.score, 0) / results.length;
      const allAnomalies = results.flatMap(r => r.anomalies);
      
      const isAuthentic = avgScore >= AUTHENTICITY_THRESHOLD;
      const confidence = avgScore;
      const riskScore = (1 - avgScore) * 100;

      // Determine recommended actions
      const recommendedActions = this.determineActions(avgScore, allAnomalies.length);

      // Update user's biometric profile with new data
      await this.updateBiometricProfile(userId, currentData, avgScore);

      // Log verification attempt
      await this.logBiometricVerification(userId, {
        isAuthentic,
        confidence,
        anomalies: allAnomalies,
        riskScore,
        recommendedActions
      }, sessionId);

      return {
        isAuthentic,
        confidence,
        anomalies: allAnomalies,
        riskScore,
        recommendedActions
      };

    } catch (error) {
      logger.error('Behavioral biometrics verification failed', { 
        userId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      
      return {
        isAuthentic: true,
        confidence: 0.5,
        anomalies: ['Verification system error'],
        riskScore: 30,
        recommendedActions: ['monitor']
      };
    }
  },

  /**
   * Verify keystroke dynamics
   */
  async verifyKeystrokeDynamics(
    baseline?: KeystrokeDynamics,
    current?: KeystrokeDynamics
  ): Promise<{ score: number; anomalies: string[] } | null> {
    if (!baseline || !current) return null;

    const anomalies: string[] = [];
    let score = 1.0;

    // Compare typing speed
    const speedVariance = Math.abs(current.typingSpeed - baseline.typingSpeed) / baseline.typingSpeed;
    if (speedVariance > KEYSTROKE_TOLERANCE) {
      anomalies.push(`Typing speed anomaly: ${(speedVariance * 100).toFixed(1)}% variance`);
      score *= (1 - speedVariance * 0.5);
    }

    // Compare rhythm
    const rhythmVariance = Math.abs(current.rhythm - baseline.rhythm) / baseline.rhythm;
    if (rhythmVariance > KEYSTROKE_TOLERANCE) {
      anomalies.push(`Typing rhythm anomaly: ${(rhythmVariance * 100).toFixed(1)}% variance`);
      score *= (1 - rhythmVariance * 0.3);
    }

    // Compare dwell times (statistical analysis)
    if (current.dwellTimes.length > 0 && baseline.dwellTimes.length > 0) {
      const dwellScore = this.compareTimingArrays(baseline.dwellTimes, current.dwellTimes);
      if (dwellScore < 0.7) {
        anomalies.push('Keystroke dwell time patterns differ significantly');
        score *= dwellScore;
      }
    }

    // Compare flight times
    if (current.flightTimes.length > 0 && baseline.flightTimes.length > 0) {
      const flightScore = this.compareTimingArrays(baseline.flightTimes, current.flightTimes);
      if (flightScore < 0.7) {
        anomalies.push('Keystroke flight time patterns differ significantly');
        score *= flightScore;
      }
    }

    return { score: Math.max(0, score), anomalies };
  },

  /**
   * Verify mouse movement behavior
   */
  async verifyMouseBehavior(
    baseline?: MouseMovement[],
    current?: MouseMovement[]
  ): Promise<{ score: number; anomalies: string[] } | null> {
    if (!baseline || !current || baseline.length === 0 || current.length === 0) return null;

    const anomalies: string[] = [];
    let score = 1.0;

    // Calculate baseline metrics
    const baselineVelocities = this.calculateMouseVelocities(baseline);
    const currentVelocities = this.calculateMouseVelocities(current);

    // Compare average velocities
    const baselineAvgVel = this.average(baselineVelocities);
    const currentAvgVel = this.average(currentVelocities);
    
    const velocityVariance = Math.abs(currentAvgVel - baselineAvgVel) / baselineAvgVel;
    if (velocityVariance > 0.5) {
      anomalies.push(`Mouse velocity anomaly: ${(velocityVariance * 100).toFixed(1)}% variance`);
      score *= (1 - velocityVariance * 0.3);
    }

    // Check for suspiciously high velocities (bot-like behavior)
    const maxCurrentVel = Math.max(...currentVelocities);
    if (maxCurrentVel > MOUSE_VELOCITY_THRESHOLD) {
      anomalies.push(`Suspiciously high mouse velocity: ${maxCurrentVel.toFixed(0)} px/s`);
      score *= 0.5;
    }

    // Compare movement patterns (smoothness)
    const baselineSmoothness = this.calculateMovementSmoothness(baseline);
    const currentSmoothness = this.calculateMovementSmoothness(current);
    
    const smoothnessVariance = Math.abs(currentSmoothness - baselineSmoothness) / baselineSmoothness;
    if (smoothnessVariance > 0.4) {
      anomalies.push(`Mouse movement smoothness differs: ${(smoothnessVariance * 100).toFixed(1)}% variance`);
      score *= (1 - smoothnessVariance * 0.2);
    }

    return { score: Math.max(0, score), anomalies };
  },

  /**
   * Verify typing patterns
   */
  async verifyTypingPattern(
    baseline?: TypingPattern,
    current?: TypingPattern
  ): Promise<{ score: number; anomalies: string[] } | null> {
    if (!baseline || !current) return null;

    const anomalies: string[] = [];
    let score = 1.0;

    // Compare average word length
    const wordLengthVariance = Math.abs(current.avgWordLength - baseline.avgWordLength) / baseline.avgWordLength;
    if (wordLengthVariance > 0.3) {
      anomalies.push(`Average word length differs: ${(wordLengthVariance * 100).toFixed(1)}% variance`);
      score *= (1 - wordLengthVariance * 0.2);
    }

    // Compare handedness indicators
    const leftHandVariance = Math.abs(current.handednessIndicators.leftHandDominance - baseline.handednessIndicators.leftHandDominance);
    const rightHandVariance = Math.abs(current.handednessIndicators.rightHandDominance - baseline.handednessIndicators.rightHandDominance);
    
    if (leftHandVariance > 0.2 || rightHandVariance > 0.2) {
      anomalies.push('Hand dominance patterns differ from baseline');
      score *= 0.8;
    }

    // Compare common mistakes (behavioral indicator)
    const mistakeOverlap = this.calculateArrayOverlap(baseline.commonMistakes, current.commonMistakes);
    if (mistakeOverlap < 0.3) {
      anomalies.push('Typing mistake patterns differ significantly');
      score *= 0.9;
    }

    return { score: Math.max(0, score), anomalies };
  },

  /**
   * Verify touch patterns (mobile devices)
   */
  async verifyTouchPatterns(
    baseline?: TouchPattern[],
    current?: TouchPattern[]
  ): Promise<{ score: number; anomalies: string[] } | null> {
    if (!baseline || !current || baseline.length === 0 || current.length === 0) return null;

    const anomalies: string[] = [];
    let score = 1.0;

    // Compare average touch pressure
    const baselinePressure = this.average(baseline.map(t => t.pressure));
    const currentPressure = this.average(current.map(t => t.pressure));
    
    const pressureVariance = Math.abs(currentPressure - baselinePressure) / baselinePressure;
    if (pressureVariance > 0.4) {
      anomalies.push(`Touch pressure differs: ${(pressureVariance * 100).toFixed(1)}% variance`);
      score *= (1 - pressureVariance * 0.3);
    }

    // Compare touch area (finger size consistency)
    const baselineArea = this.average(baseline.map(t => t.area));
    const currentArea = this.average(current.map(t => t.area));
    
    const areaVariance = Math.abs(currentArea - baselineArea) / baselineArea;
    if (areaVariance > 0.3) {
      anomalies.push(`Touch area differs: ${(areaVariance * 100).toFixed(1)}% variance`);
      score *= (1 - areaVariance * 0.2);
    }

    // Compare gesture patterns
    const baselineGestures = this.aggregateGestures(baseline);
    const currentGestures = this.aggregateGestures(current);
    
    const gestureOverlap = this.calculateObjectOverlap(baselineGestures, currentGestures);
    if (gestureOverlap < 0.6) {
      anomalies.push('Touch gesture patterns differ from baseline');
      score *= 0.8;
    }

    return { score: Math.max(0, score), anomalies };
  },

  /**
   * Get user's biometric profile
   */
  async getUserBiometricProfile(userId: string): Promise<BiometricProfile | null> {
    try {
      const { rows } = await pool.query(`
        SELECT * FROM biometric_profiles 
        WHERE user_id = $1 AND active = true
      `, [userId]);

      if (rows.length === 0) return null;

      const row = rows[0];
      return {
        userId: row.user_id,
        baseline: typeof row.baseline_data === 'string'
          ? JSON.parse(row.baseline_data)
          : row.baseline_data,
        confidence: row.confidence,
        sampleCount: row.sample_count,
        lastUpdated: row.updated_at,
        authenticityScore: row.authenticity_score
      };
    } catch (error) {
      logger.error('Failed to get biometric profile', { userId, error });
      return null;
    }
  },

  /**
   * Store new biometric sample
   */
  async storeBiometricSample(userId: string, data: BiometricData): Promise<void> {
    try {
      await pool.query(`
        INSERT INTO biometric_samples (user_id, sample_data, created_at)
        VALUES ($1, $2, NOW())
      `, [userId, JSON.stringify(data)]);

      // Update sample count in profile
      await this.updateSampleCount(userId);
    } catch (error) {
      logger.error('Failed to store biometric sample', { userId, error });
    }
  },

  /**
   * Update user's biometric profile
   */
  async updateBiometricProfile(userId: string, newData: BiometricData, authenticityScore: number): Promise<void> {
    try {
      const existingProfile = await this.getUserBiometricProfile(userId);
      
      if (!existingProfile) {
        // Create new profile
        await pool.query(`
          INSERT INTO biometric_profiles (
            user_id, baseline_data, confidence, sample_count, authenticity_score, 
            created_at, updated_at, active
          ) VALUES ($1, $2, 0.5, 1, $3, NOW(), NOW(), true)
        `, [userId, JSON.stringify(newData), authenticityScore]);
      } else {
        // Update existing profile with weighted average
        const updatedBaseline = this.mergeBaselineData(existingProfile.baseline, newData, existingProfile.sampleCount);
        const newConfidence = Math.min(1.0, existingProfile.confidence + 0.1);
        
        await pool.query(`
          UPDATE biometric_profiles 
          SET baseline_data = $2, confidence = $3, authenticity_score = $4, 
              sample_count = sample_count + 1, updated_at = NOW()
          WHERE user_id = $1
        `, [userId, JSON.stringify(updatedBaseline), newConfidence, authenticityScore]);
      }
    } catch (error) {
      logger.error('Failed to update biometric profile', { userId, error });
    }
  },

  /**
   * Update sample count
   */
  async updateSampleCount(userId: string): Promise<void> {
    await pool.query(`
      UPDATE biometric_profiles 
      SET sample_count = (
        SELECT COUNT(*) FROM biometric_samples WHERE user_id = $1
      )
      WHERE user_id = $1
    `, [userId]);
  },

  /**
   * Log biometric verification attempt
   */
  async logBiometricVerification(
    userId: string,
    result: BiometricVerificationResult,
    sessionId?: string
  ): Promise<void> {
    try {
      await pool.query(`
        INSERT INTO biometric_verifications (
          user_id, session_id, is_authentic, confidence, anomalies, 
          risk_score, recommended_actions, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
      `, [
        userId,
        sessionId,
        result.isAuthentic,
        result.confidence,
        JSON.stringify(result.anomalies),
        result.riskScore,
        JSON.stringify(result.recommendedActions)
      ]);
    } catch (error) {
      logger.error('Failed to log biometric verification', { userId, error });
    }
  },

  /**
   * Calculate mouse velocities from movement data
   */
  calculateMouseVelocities(movements: MouseMovement[]): number[] {
    const velocities: number[] = [];
    
    for (let i = 1; i < movements.length; i++) {
      const prev = movements[i - 1];
      const curr = movements[i];
      
      const dx = curr.x - prev.x;
      const dy = curr.y - prev.y;
      const dt = curr.timestamp - prev.timestamp;
      
      if (dt > 0) {
        const distance = Math.sqrt(dx * dx + dy * dy);
        const velocity = distance / (dt / 1000); // pixels per second
        velocities.push(velocity);
      }
    }
    
    return velocities;
  },

  /**
   * Calculate movement smoothness score
   */
  calculateMovementSmoothness(movements: MouseMovement[]): number {
    if (movements.length < 3) return 1.0;

    const velocities = this.calculateMouseVelocities(movements);
    const accelerations: number[] = [];

    for (let i = 1; i < velocities.length; i++) {
      accelerations.push(Math.abs(velocities[i] - velocities[i - 1]));
    }

    const avgAcceleration = this.average(accelerations);
    const maxAcceleration = Math.max(...accelerations);

    // Higher values indicate less smooth movement
    return Math.max(0, 1 - (avgAcceleration / maxAcceleration));
  },

  /**
   * Compare timing arrays using statistical methods
   */
  compareTimingArrays(baseline: number[], current: number[]): number {
    if (baseline.length === 0 || current.length === 0) return 0.5;

    const baselineMean = this.average(baseline);
    const currentMean = this.average(current);
    const baselineStd = this.standardDeviation(baseline);
    const currentStd = this.standardDeviation(current);

    // Compare means
    const meanDiff = Math.abs(baselineMean - currentMean) / baselineMean;
    
    // Compare standard deviations
    const stdDiff = Math.abs(baselineStd - currentStd) / baselineStd;

    // Combined similarity score
    return Math.max(0, 1 - (meanDiff + stdDiff) / 2);
  },

  /**
   * Calculate array overlap percentage
   */
  calculateArrayOverlap(arr1: string[], arr2: string[]): number {
    if (arr1.length === 0 && arr2.length === 0) return 1.0;
    if (arr1.length === 0 || arr2.length === 0) return 0.0;

    const set1 = new Set(arr1);
    const set2 = new Set(arr2);
    const intersection = new Set([...set1].filter(x => set2.has(x)));
    const union = new Set([...set1, ...set2]);

    return intersection.size / union.size;
  },

  /**
   * Calculate object overlap for gesture patterns
   */
  calculateObjectOverlap(obj1: Record<string, number>, obj2: Record<string, number>): number {
    const keys1 = Object.keys(obj1);
    const keys2 = Object.keys(obj2);
    const allKeys = new Set([...keys1, ...keys2]);

    if (allKeys.size === 0) return 1.0;

    let similarity = 0;
    let totalKeys = 0;

    for (const key of allKeys) {
      const val1 = obj1[key] || 0;
      const val2 = obj2[key] || 0;
      
      if (val1 > 0 || val2 > 0) {
        const maxVal = Math.max(val1, val2);
        const minVal = Math.min(val1, val2);
        similarity += minVal / maxVal;
        totalKeys++;
      }
    }

    return totalKeys > 0 ? similarity / totalKeys : 0;
  },

  /**
   * Aggregate gesture patterns from touch data
   */
  aggregateGestures(touches: TouchPattern[]): Record<string, number> {
    const gestures: Record<string, number> = {};
    
    for (const touch of touches) {
      gestures[touch.gestureType] = (gestures[touch.gestureType] || 0) + 1;
    }

    return gestures;
  },

  /**
   * Merge baseline data with new sample
   */
  mergeBaselineData(baseline: BiometricData, newData: BiometricData, sampleCount: number): BiometricData {
    const weight = 1 / (sampleCount + 1);
    
    return {
      keystrokeDynamics: baseline.keystrokeDynamics && newData.keystrokeDynamics ? 
        this.mergeKeystrokeDynamics(baseline.keystrokeDynamics, newData.keystrokeDynamics, weight) : 
        baseline.keystrokeDynamics || newData.keystrokeDynamics,
      mouseMovements: newData.mouseMovements || baseline.mouseMovements,
      touchPatterns: newData.touchPatterns || baseline.touchPatterns,
      scrollBehavior: newData.scrollBehavior || baseline.scrollBehavior,
      deviceMotion: newData.deviceMotion || baseline.deviceMotion,
      typingPattern: baseline.typingPattern && newData.typingPattern ?
        this.mergeTypingPatterns(baseline.typingPattern, newData.typingPattern, weight) :
        baseline.typingPattern || newData.typingPattern
    };
  },

  /**
   * Merge keystroke dynamics with weighted average
   */
  mergeKeystrokeDynamics(baseline: KeystrokeDynamics, newData: KeystrokeDynamics, weight: number): KeystrokeDynamics {
    return {
      dwellTimes: [...baseline.dwellTimes, ...newData.dwellTimes].slice(-100), // Keep last 100
      flightTimes: [...baseline.flightTimes, ...newData.flightTimes].slice(-100),
      rhythm: baseline.rhythm * (1 - weight) + newData.rhythm * weight,
      pressure: [...(baseline.pressure || []), ...(newData.pressure || [])].slice(-100),
      typingSpeed: baseline.typingSpeed * (1 - weight) + newData.typingSpeed * weight,
      pausePatterns: [...baseline.pausePatterns, ...newData.pausePatterns].slice(-50)
    };
  },

  /**
   * Merge typing patterns
   */
  mergeTypingPatterns(baseline: TypingPattern, newData: TypingPattern, weight: number): TypingPattern {
    return {
      avgWordLength: baseline.avgWordLength * (1 - weight) + newData.avgWordLength * weight,
      commonMistakes: [...new Set([...baseline.commonMistakes, ...newData.commonMistakes])].slice(0, 20),
      correctionPatterns: [...new Set([...baseline.correctionPatterns, ...newData.correctionPatterns])].slice(0, 20),
      preferredKeys: [...new Set([...baseline.preferredKeys, ...newData.preferredKeys])].slice(0, 30),
      handednessIndicators: {
        leftHandDominance: baseline.handednessIndicators.leftHandDominance * (1 - weight) + 
                          newData.handednessIndicators.leftHandDominance * weight,
        rightHandDominance: baseline.handednessIndicators.rightHandDominance * (1 - weight) + 
                           newData.handednessIndicators.rightHandDominance * weight
      }
    };
  },

  /**
   * Determine recommended actions based on score and anomalies
   */
  determineActions(score: number, anomalyCount: number): ('allow' | 'challenge' | 'block' | 'monitor')[] {
    if (score < 0.3 || anomalyCount > 5) {
      return ['block'];
    } else if (score < 0.6 || anomalyCount > 3) {
      return ['challenge', 'monitor'];
    } else if (score < 0.8 || anomalyCount > 1) {
      return ['monitor'];
    } else {
      return ['allow'];
    }
  },

  /**
   * Utility functions
   */
  average(numbers: number[]): number {
    return numbers.length > 0 ? numbers.reduce((a, b) => a + b, 0) / numbers.length : 0;
  },

  standardDeviation(numbers: number[]): number {
    const avg = this.average(numbers);
    const squaredDiffs = numbers.map(num => Math.pow(num - avg, 2));
    return Math.sqrt(this.average(squaredDiffs));
  },

  /**
   * Start continuous monitoring session
   */
  async startContinuousMonitoring(userId: string, sessionId: string): Promise<void> {
    try {
      await pool.query(`
        INSERT INTO biometric_sessions (
          user_id, session_id, started_at, active, monitoring_interval
        ) VALUES ($1, $2, NOW(), true, 30)
        ON CONFLICT (user_id, session_id) 
        DO UPDATE SET started_at = NOW(), active = true
      `, [userId, sessionId]);
    } catch (error) {
      logger.error('Failed to start biometric monitoring', { userId, sessionId, error });
    }
  },

  /**
   * Stop continuous monitoring
   */
  async stopContinuousMonitoring(userId: string, sessionId: string): Promise<void> {
    try {
      await pool.query(`
        UPDATE biometric_sessions 
        SET active = false, ended_at = NOW()
        WHERE user_id = $1 AND session_id = $2
      `, [userId, sessionId]);
    } catch (error) {
      logger.error('Failed to stop biometric monitoring', { userId, sessionId, error });
    }
  }
};