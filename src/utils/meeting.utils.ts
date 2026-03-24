/**
 * Meeting Utilities - Helper functions for meeting room management
 */

/**
 * Calculate meeting expiry time (30 minutes after session end)
 * @param scheduledAt - Session start time
 * @param durationMinutes - Session duration in minutes
 * @param bufferMinutes - Additional buffer time after session (default: 30)
 * @returns Expiry date
 */
export const calculateMeetingExpiry = (
  scheduledAt: Date,
  durationMinutes: number,
  bufferMinutes: number = 30
): Date => {
  const sessionEndTime = new Date(scheduledAt.getTime() + durationMinutes * 60000);
  return new Date(sessionEndTime.getTime() + bufferMinutes * 60000);
};

/**
 * Generate a clean, unique Jitsi room name
 * @param sessionId - Session UUID
 * @returns Formatted room name
 */
export const generateJitsiRoomName = (sessionId: string): string => {
  // Remove hyphens from UUID for cleaner URL
  const cleanId = sessionId.replace(/-/g, '');
  return `MentorMinds-${cleanId}`;
};

/**
 * Check if a meeting has expired
 * @param expiresAt - Meeting expiry date
 * @returns True if expired, false otherwise
 */
export const isMeetingExpired = (expiresAt: Date): boolean => {
  return new Date() > expiresAt;
};

/**
 * Get time until meeting expiry
 * @param expiresAt - Meeting expiry date
 * @returns Milliseconds until expiry
 */
export const getTimeUntilExpiry = (expiresAt: Date): number => {
  return expiresAt.getTime() - Date.now();
};

/**
 * Format meeting URL for display
 * @param url - Meeting URL
 * @returns Formatted URL
 */
export const formatMeetingUrl = (url: string): string => {
  try {
    const urlObj = new URL(url);
    return urlObj.href;
  } catch {
    return url;
  }
};

/**
 * Validate meeting URL
 * @param url - URL to validate
 * @returns True if valid URL
 */
export const isValidMeetingUrl = (url: string): boolean => {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
};
