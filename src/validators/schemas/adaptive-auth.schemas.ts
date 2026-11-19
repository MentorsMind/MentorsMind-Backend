import { z } from "zod";

// Biometric data schemas
const keystrokeDynamicsSchema = z.object({
  dwellTimes: z.array(z.number()).optional(),
  flightTimes: z.array(z.number()).optional(),
  rhythm: z.number().optional(),
  pressure: z.array(z.number()).optional(),
  typingSpeed: z.number().optional(),
  pausePatterns: z.array(z.number()).optional()
});

const mouseMovementSchema = z.object({
  x: z.number(),
  y: z.number(),
  timestamp: z.number(),
  pressure: z.number().optional(),
  velocity: z.number().optional(),
  acceleration: z.number().optional()
});

const touchPatternSchema = z.object({
  x: z.number(),
  y: z.number(),
  pressure: z.number(),
  area: z.number(),
  duration: z.number(),
  timestamp: z.number(),
  gestureType: z.enum(['tap', 'swipe', 'pinch', 'rotate'])
});

const scrollBehaviorSchema = z.object({
  velocity: z.number(),
  acceleration: z.number(),
  direction: z.enum(['up', 'down', 'left', 'right']),
  pattern: z.enum(['smooth', 'jerky', 'consistent']),
  pauseFrequency: z.number()
});

const deviceMotionSchema = z.object({
  accelerometerX: z.number(),
  accelerometerY: z.number(),
  accelerometerZ: z.number(),
  gyroscopeX: z.number(),
  gyroscopeY: z.number(),
  gyroscopeZ: z.number(),
  orientation: z.number()
});

const typingPatternSchema = z.object({
  avgWordLength: z.number(),
  commonMistakes: z.array(z.string()),
  correctionPatterns: z.array(z.string()),
  preferredKeys: z.array(z.string()),
  handednessIndicators: z.object({
    leftHandDominance: z.number().min(0).max(1),
    rightHandDominance: z.number().min(0).max(1)
  })
});

const biometricDataSchema = z.object({
  keystrokeDynamics: keystrokeDynamicsSchema.optional(),
  mouseMovements: z.array(mouseMovementSchema).optional(),
  touchPatterns: z.array(touchPatternSchema).optional(),
  scrollBehavior: scrollBehaviorSchema.optional(),
  deviceMotion: deviceMotionSchema.optional(),
  typingPattern: typingPatternSchema.optional()
});

// Challenge response schema
export const challengeResponseSchema = z.object({
  body: z.object({
    challengeId: z.string().min(1, "Challenge ID is required"),
    response: z.union([
      z.object({
        token: z.string() // MFA token
      }),
      z.object({
        code: z.string() // Email/SMS verification code
      }),
      z.object({
        answers: z.array(z.string()) // Security question answers
      }),
      z.object({
        biometricData: biometricDataSchema // Biometric verification data
      }),
      z.object({
        confirmed: z.boolean() // Device confirmation
      })
    ]),
    sessionId: z.string().optional(),
    userId: z.string().optional()
  })
});

// Risk assessment schema
export const riskAssessmentSchema = z.object({
  body: z.object({
    actionType: z.string().optional(),
    isPrivilegedAction: z.boolean().optional().default(false),
    resourceAccessed: z.string().optional(),
    biometricData: biometricDataSchema.optional()
  })
});

// Device trust schema
export const deviceTrustSchema = z.object({
  body: z.object({
    deviceFingerprint: z.string().min(1, "Device fingerprint is required"),
    deviceName: z.string().optional()
  })
});

// Biometric verification schema
export const biometricVerificationSchema = z.object({
  body: z.object({
    biometricData: biometricDataSchema.refine(
      (data) => {
        // At least one biometric data type must be provided
        return Object.values(data).some(value => value !== undefined);
      },
      {
        message: "At least one type of biometric data must be provided"
      }
    )
  }),
  headers: z.object({
    'x-session-id': z.string().optional()
  }).partial()
});

// Continuous monitoring schemas
export const startMonitoringSchema = z.object({
  body: z.object({
    monitoringInterval: z.number().min(10).max(300).optional().default(30), // 10 seconds to 5 minutes
    biometricData: biometricDataSchema.optional()
  }),
  headers: z.object({
    'x-session-id': z.string().optional()
  }).partial()
});

export const monitoringHeartbeatSchema = z.object({
  body: z.object({
    biometricData: biometricDataSchema.optional(),
    activityData: z.object({
      keystrokeCount: z.number().optional(),
      mouseMovementCount: z.number().optional(),
      clickCount: z.number().optional(),
      scrollCount: z.number().optional(),
      focusLost: z.boolean().optional(),
      tabSwitched: z.boolean().optional(),
      windowMinimized: z.boolean().optional()
    }).optional()
  }),
  headers: z.object({
    'x-session-id': z.string().min(1, "Session ID is required")
  }).partial()
});

// Admin schemas
export const adminRiskAssessmentQuerySchema = z.object({
  query: z.object({
    userId: z.string().optional(),
    riskLevel: z.enum(['low', 'medium', 'high', 'critical']).optional(),
    startDate: z.string().datetime().optional(),
    endDate: z.string().datetime().optional(),
    limit: z.string().regex(/^\d+$/).transform(Number).optional().default(50),
    offset: z.string().regex(/^\d+$/).transform(Number).optional().default(0)
  }).partial()
});

export const resetUserRiskSchema = z.object({
  params: z.object({
    userId: z.string().uuid("Valid user ID required")
  }),
  body: z.object({
    reason: z.string().min(10, "Reason must be at least 10 characters"),
    resetLevel: z.enum(['partial', 'complete']).default('partial')
  })
});

export const investigateIncidentSchema = z.object({
  params: z.object({
    incidentId: z.string().uuid("Valid incident ID required")
  }),
  body: z.object({
    status: z.enum(['investigating', 'resolved', 'false_positive']),
    notes: z.string().optional(),
    escalate: z.boolean().optional().default(false)
  })
});

// Configuration schemas
export const authPolicySchema = z.object({
  body: z.object({
    policies: z.object({
      riskThresholds: z.object({
        low: z.number().min(0).max(100),
        medium: z.number().min(0).max(100),
        high: z.number().min(0).max(100),
        critical: z.number().min(0).max(100)
      }).optional(),
      authenticationRequirements: z.object({
        minPasswordStrength: z.number().min(1).max(5).optional(),
        requireMfaForHighRisk: z.boolean().optional(),
        biometricThreshold: z.number().min(0).max(1).optional(),
        deviceTrustExpiry: z.number().min(1).optional() // days
      }).optional(),
      continuousAuth: z.object({
        enabled: z.boolean().optional(),
        intervalMinutes: z.number().min(1).max(60).optional(),
        riskThreshold: z.number().min(0).max(100).optional()
      }).optional(),
      blockedCountries: z.array(z.string().length(2)).optional(),
      allowedIpRanges: z.array(z.string()).optional()
    })
  })
});

// Session management schemas
export const sessionListQuerySchema = z.object({
  query: z.object({
    active: z.enum(['true', 'false']).optional().transform(val => val === 'true'),
    limit: z.string().regex(/^\d+$/).transform(Number).optional().default(20),
    offset: z.string().regex(/^\d+$/).transform(Number).optional().default(0)
  }).partial()
});

// Analytics schemas
export const analyticsQuerySchema = z.object({
  query: z.object({
    startDate: z.string().datetime().optional(),
    endDate: z.string().datetime().optional(),
    groupBy: z.enum(['day', 'week', 'month']).optional().default('day'),
    metrics: z.string().optional() // comma-separated list
  }).partial()
});

// Device management schemas
export const deviceListQuerySchema = z.object({
  query: z.object({
    trusted: z.enum(['true', 'false']).optional().transform(val => val === 'true'),
    active: z.enum(['true', 'false']).optional().transform(val => val === 'true'),
    limit: z.string().regex(/^\d+$/).transform(Number).optional().default(20)
  }).partial()
});

// Security incident schemas
export const securityIncidentQuerySchema = z.object({
  query: z.object({
    severity: z.enum(['low', 'medium', 'high', 'critical']).optional(),
    status: z.enum(['open', 'investigating', 'resolved', 'false_positive']).optional(),
    incidentType: z.string().optional(),
    startDate: z.string().datetime().optional(),
    endDate: z.string().datetime().optional(),
    limit: z.string().regex(/^\d+$/).transform(Number).optional().default(10),
    offset: z.string().regex(/^\d+$/).transform(Number).optional().default(0)
  }).partial()
});

export const resolveSecurityIncidentSchema = z.object({
  params: z.object({
    incidentId: z.string().uuid("Valid incident ID required")
  }),
  body: z.object({
    resolution: z.string().min(10, "Resolution notes must be at least 10 characters"),
    preventiveActions: z.array(z.string()).optional(),
    escalateToAdmin: z.boolean().optional().default(false)
  })
});

// Testing/simulation schemas (development only)
export const simulateRiskSchema = z.object({
  body: z.object({
    riskFactors: z.object({
      newDevice: z.boolean().optional(),
      newLocation: z.boolean().optional(),
      highRiskCountry: z.boolean().optional(),
      suspiciousUserAgent: z.boolean().optional(),
      vpnDetected: z.boolean().optional(),
      failedAttempts: z.number().min(0).optional(),
      biometricAnomaly: z.boolean().optional()
    }),
    targetRiskLevel: z.enum(['low', 'medium', 'high', 'critical']).optional()
  })
});

// Export commonly used sub-schemas
export { 
  biometricDataSchema, 
  keystrokeDynamicsSchema, 
  mouseMovementSchema, 
  touchPatternSchema, 
  scrollBehaviorSchema,
  deviceMotionSchema,
  typingPatternSchema 
};