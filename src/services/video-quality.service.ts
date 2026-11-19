import { WsService } from './ws.service';

export interface VideoQualityConfig {
  resolution: '360p' | '480p' | '720p' | '1080p';
  frameRate: 15 | 24 | 30 | 60;
  bitrate: number;
  codec: 'VP8' | 'VP9' | 'H264';
  adaptiveBitrate: boolean;
}

export interface NetworkQuality {
  bandwidth: number; // kbps
  latency: number; // ms
  packetLoss: number; // percentage
  jitter: number; // ms
  quality: 'excellent' | 'good' | 'fair' | 'poor';
}

/** Threshold after which session:quality_degraded is emitted (ms) */
const POOR_QUALITY_ALERT_THRESHOLD_MS = 30_000; // 30 seconds

/** Threshold after which audio-only fallback is suggested (ms) */
const AUDIO_FALLBACK_THRESHOLD_MS = 120_000; // 2 minutes

export class VideoQualityService {
  private readonly QUALITY_THRESHOLDS = {
    excellent: { bandwidth: 2000, latency: 50, packetLoss: 1 },
    good: { bandwidth: 1000, latency: 100, packetLoss: 5 },
    fair: { bandwidth: 500, latency: 200, packetLoss: 10 },
  };

  /**
   * Tracks the timestamp (ms) when a session first entered 'poor' quality.
   * Cleared when quality improves or clearQualityTracking() is called.
   */
  public poorQualityStartTime = new Map<string, number>();

  /**
   * Tracks whether the 30-second degradation alert has already been emitted
   * for the current poor-quality window, to avoid spamming participants.
   */
  private degradedAlertEmitted = new Map<string, boolean>();

  /**
   * Tracks whether the audio-fallback suggestion has already been emitted
   * for the current poor-quality window.
   */
  private audioFallbackEmitted = new Map<string, boolean>();

  /**
   * Determine network quality based on current network metrics
   */
  public determineNetworkQuality(metrics: Omit<NetworkQuality, 'quality'>): NetworkQuality {
    let quality: NetworkQuality['quality'] = 'poor';

    if (
      metrics.bandwidth >= this.QUALITY_THRESHOLDS.excellent.bandwidth &&
      metrics.latency <= this.QUALITY_THRESHOLDS.excellent.latency &&
      metrics.packetLoss <= this.QUALITY_THRESHOLDS.excellent.packetLoss
    ) {
      quality = 'excellent';
    } else if (
      metrics.bandwidth >= this.QUALITY_THRESHOLDS.good.bandwidth &&
      metrics.latency <= this.QUALITY_THRESHOLDS.good.latency &&
      metrics.packetLoss <= this.QUALITY_THRESHOLDS.good.packetLoss
    ) {
      quality = 'good';
    } else if (
      metrics.bandwidth >= this.QUALITY_THRESHOLDS.fair.bandwidth &&
      metrics.latency <= this.QUALITY_THRESHOLDS.fair.latency &&
      metrics.packetLoss <= this.QUALITY_THRESHOLDS.fair.packetLoss
    ) {
      quality = 'fair';
    }

    return { ...metrics, quality };
  }

  /**
   * Report network quality for an active session.
   *
   * Tracks consecutive poor-quality duration and:
   * - After >30 s of poor quality: emits `session:quality_degraded` to both participants
   *   with the recommended VideoQualityConfig.
   * - After >2 min of poor quality: emits `session:audio_fallback_suggested` to both
   *   participants, prompting a switch to audio-only mode via PATCH /bookings/:id/video-mode.
   *
   * @param sessionId  The booking/session UUID
   * @param mentorId   User ID of the mentor participant
   * @param menteeId   User ID of the mentee participant
   * @param metrics    Raw network metrics (bandwidth, latency, packetLoss, jitter)
   */
  public async reportQuality(
    sessionId: string,
    mentorId: string,
    menteeId: string,
    metrics: Omit<NetworkQuality, 'quality'>,
  ): Promise<void> {
    const networkQuality = this.determineNetworkQuality(metrics);
    const now = Date.now();

    if (networkQuality.quality !== 'poor') {
      // Quality has recovered — reset tracking state for this session
      this.poorQualityStartTime.delete(sessionId);
      this.degradedAlertEmitted.delete(sessionId);
      this.audioFallbackEmitted.delete(sessionId);
      return;
    }

    // Record when this poor-quality window started (if not already tracked)
    if (!this.poorQualityStartTime.has(sessionId)) {
      this.poorQualityStartTime.set(sessionId, now);
    }

    const poorDurationMs = now - this.poorQualityStartTime.get(sessionId)!;
    const recommendedConfig = this.optimizeVideoQuality(networkQuality);

    // --- Emit session:quality_degraded after 30 seconds ---
    if (
      poorDurationMs >= POOR_QUALITY_ALERT_THRESHOLD_MS &&
      !this.degradedAlertEmitted.get(sessionId)
    ) {
      const payload = {
        sessionId,
        quality: networkQuality.quality,
        metrics: {
          bandwidth: networkQuality.bandwidth,
          latency: networkQuality.latency,
          packetLoss: networkQuality.packetLoss,
          jitter: networkQuality.jitter,
        },
        poorDurationMs,
        recommendedConfig,
        timestamp: new Date().toISOString(),
      };

      await Promise.all([
        WsService.publish(mentorId, 'session:quality_degraded', payload),
        WsService.publish(menteeId, 'session:quality_degraded', payload),
      ]);

      this.degradedAlertEmitted.set(sessionId, true);
    }

    // --- Emit session:audio_fallback_suggested after 2 minutes ---
    if (
      poorDurationMs >= AUDIO_FALLBACK_THRESHOLD_MS &&
      !this.audioFallbackEmitted.get(sessionId)
    ) {
      const fallbackPayload = {
        sessionId,
        poorDurationMs,
        message:
          'Network quality has been poor for over 2 minutes. Consider switching to audio-only mode.',
        audioFallbackEndpoint: `/api/v1/bookings/${sessionId}/video-mode`,
        timestamp: new Date().toISOString(),
      };

      await Promise.all([
        WsService.publish(mentorId, 'session:audio_fallback_suggested', fallbackPayload),
        WsService.publish(menteeId, 'session:audio_fallback_suggested', fallbackPayload),
      ]);

      this.audioFallbackEmitted.set(sessionId, true);
    }
  }

  /**
   * Clear all quality tracking state for a session.
   * Should be called when a session ends or a participant disconnects.
   *
   * @param sessionId  The booking/session UUID to clear tracking for
   */
  public clearQualityTracking(sessionId: string): void {
    this.poorQualityStartTime.delete(sessionId);
    this.degradedAlertEmitted.delete(sessionId);
    this.audioFallbackEmitted.delete(sessionId);
  }

  /**
   * Optimize video configuration based on the detected network quality
   */
  public optimizeVideoQuality(networkQuality: NetworkQuality): VideoQualityConfig {
    const baseConfig: VideoQualityConfig = {
      resolution: '480p',
      frameRate: 30,
      bitrate: 500,
      codec: 'VP8',
      adaptiveBitrate: true,
    };

    switch (networkQuality.quality) {
      case 'excellent':
        return { ...baseConfig, resolution: '1080p', frameRate: 60, bitrate: 2500, codec: 'VP9' };
      case 'good':
        return { ...baseConfig, resolution: '720p', frameRate: 30, bitrate: 1500, codec: 'VP8' };
      case 'fair':
        return { ...baseConfig, resolution: '480p', frameRate: 24, bitrate: 500, codec: 'VP8' };
      case 'poor':
        return { ...baseConfig, resolution: '360p', frameRate: 15, bitrate: 250, codec: 'VP8' };
      default:
        return baseConfig;
    }
  }

  /**
   * Echo cancellation and noise suppression settings
   */
  public getAudioProcessingConfig() {
    return {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    };
  }
}
