import helmet from 'helmet';
import { Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import slowDown from 'express-slow-down';
import { validationConfig } from '../config/validation.config';

export const securityMiddleware = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      scriptSrc: ["'self'", "'strict-dynamic'"],
      imgSrc: ["'self'", 'data:', 'https:'],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      connectSrc: ["'self'", "https://api.stellar.org", "wss://"],
      frameSrc: ["'none'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      manifestSrc: ["'self'"],
      workerSrc: ["'self'"],
      upgradeInsecureRequests: [],
    },
    reportOnly: false,
  },
  hsts: {
    maxAge: 31536000, // 1 year
    includeSubDomains: true,
    preload: true,
  },
  frameguard: {
    action: 'deny',
  },
  noSniff: true,
  xssFilter: true,
  referrerPolicy: {
    policy: 'strict-origin-when-cross-origin'
  },
  permittedCrossDomainPolicies: false,
  crossOriginEmbedderPolicy: false, // May interfere with Stellar operations
});

// Enhanced rate limiting for different endpoint types
export const createRateLimit = (options: {
  windowMs: number;
  maxRequests: number;
  message?: string;
  skipSuccessfulRequests?: boolean;
}) => {
  return rateLimit({
    windowMs: options.windowMs,
    max: options.maxRequests,
    message: {
      status: 'error',
      code: 'RATE_LIMIT_EXCEEDED',
      message: options.message || 'Too many requests, please try again later.'
    },
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: options.skipSuccessfulRequests || false,
    handler: (req, res) => {
      res.status(429).json({
        status: 'error',
        code: 'RATE_LIMIT_EXCEEDED', 
        message: options.message || 'Too many requests, please try again later.',
        retryAfter: Math.ceil(options.windowMs / 1000)
      });
    }
  });
};

// Slow down middleware for gradual response delays
export const createSlowDown = (options: {
  windowMs: number;
  delayAfter: number;
  delayMs: number;
  maxDelayMs?: number;
}) => {
  return slowDown({
    windowMs: options.windowMs,
    delayAfter: options.delayAfter,
    delayMs: options.delayMs,
    maxDelayMs: options.maxDelayMs || 10000, // Max 10 second delay
    skipSuccessfulRequests: false,
    skipFailedRequests: false,
  });
};

// General API rate limiting
export const generalRateLimit = createRateLimit({
  windowMs: validationConfig.rateLimiting.general.windowMs,
  maxRequests: validationConfig.rateLimiting.general.maxRequests,
  message: 'Too many API requests, please slow down.',
});

// Auth endpoints rate limiting (more restrictive)
export const authRateLimit = createRateLimit({
  windowMs: validationConfig.rateLimiting.auth.windowMs,
  maxRequests: validationConfig.rateLimiting.auth.maxRequests,
  message: 'Too many authentication attempts, please try again later.',
});

// Password reset rate limiting
export const passwordResetRateLimit = createRateLimit({
  windowMs: validationConfig.rateLimiting.passwordReset.windowMs,
  maxRequests: validationConfig.rateLimiting.passwordReset.maxRequests,
  message: 'Too many password reset attempts, please try again later.',
});

// File upload rate limiting
export const uploadRateLimit = createRateLimit({
  windowMs: validationConfig.rateLimiting.upload.windowMs,
  maxRequests: validationConfig.rateLimiting.upload.maxRequests,
  message: 'Too many file uploads, please slow down.',
});

// Slow down for authentication endpoints
export const authSlowDown = createSlowDown({
  windowMs: 15 * 60 * 1000, // 15 minutes
  delayAfter: 2, // Start slowing down after 2 requests
  delayMs: 500, // Add 500ms delay per request
  maxDelayMs: 5000, // Max 5 second delay
});

import { sanitizeObject, detectAndLogSqlInjection, detectXSSAttempts, detectCommandInjection } from '../utils/sanitization.utils';
import { logger } from '../utils/logger.utils';

export const sanitizeInput = (req: Request, res: Response, next: NextFunction): void => {
  const requestId = req.headers['x-request-id'] as string || `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const clientIP = req.ip || req.connection.remoteAddress || 'unknown';
  
  try {
    // Check request size limits
    const contentLength = parseInt(req.headers['content-length'] || '0', 10);
    if (contentLength > validationConfig.maxBodySize) {
      logger.warn('Request body size exceeds limit', {
        requestId,
        clientIP,
        contentLength,
        maxAllowed: validationConfig.maxBodySize
      });
      res.status(413).json({

        status: 'error',
        code: 'PAYLOAD_TOO_LARGE',
        message: 'Request body size exceeds the allowed limit'
      });
    }

    // Sanitize and validate request body
    if (req.body && typeof req.body === 'object') {
      const originalBody = JSON.stringify(req.body);
      
      // Detect various injection attempts
      const sqlDetected = detectAndLogSqlInjection(originalBody, 'body', requestId, clientIP);
      const xssDetected = detectXSSAttempts(originalBody, 'body', requestId, clientIP);
      const cmdDetected = detectCommandInjection(originalBody, 'body', requestId, clientIP);
      
      // Block request if multiple injection types detected (likely attack)
      const injectionCount = [sqlDetected, xssDetected, cmdDetected].filter(Boolean).length;
      if (injectionCount >= 2) {
        logger.error('Multiple injection attempts detected - blocking request', {
          requestId,
          clientIP,
          userAgent: req.get('User-Agent'),
          url: req.originalUrl,
          injectionTypes: { sql: sqlDetected, xss: xssDetected, cmd: cmdDetected }
        });
        res.status(400).json({
          status: 'error',
          code: 'MALICIOUS_INPUT_DETECTED',
          message: 'Request contains potentially malicious content'
        });
      }
      
      // Sanitize the body
      req.body = sanitizeObject(req.body);
    }

    // Check query parameters (read-only, only detection/logging)
    if (req.query && Object.keys(req.query).length > 0) {
      const queryString = JSON.stringify(req.query);
      detectAndLogSqlInjection(queryString, 'query', requestId, clientIP);
      detectXSSAttempts(queryString, 'query', requestId, clientIP);
      detectCommandInjection(queryString, 'query', requestId, clientIP);
      
      // Validate query parameter sizes
      for (const [key, value] of Object.entries(req.query)) {
        if (typeof value === 'string' && value.length > validationConfig.maxQueryParamLength) {
          logger.warn('Query parameter exceeds size limit', {
            requestId,
            clientIP,
            paramName: key,
            paramLength: value.length,
            maxAllowed: validationConfig.maxQueryParamLength
          });
          res.status(400).json({
            status: 'error',
            code: 'QUERY_PARAM_TOO_LARGE',
            message: `Query parameter '${key}' exceeds size limit`
          });
        }
      }
    }

    // Check path parameters (read-only, only detection/logging)
    if (req.params && Object.keys(req.params).length > 0) {
      const paramsString = JSON.stringify(req.params);
      detectAndLogSqlInjection(paramsString, 'params', requestId, clientIP);
      detectXSSAttempts(paramsString, 'params', requestId, clientIP);
      detectCommandInjection(paramsString, 'params', requestId, clientIP);
    }

    // Add security headers to request for downstream middleware
    req.headers['x-security-validated'] = 'true';
    req.headers['x-request-id'] = requestId;
    
    next();
  } catch (error) {
    logger.error('Security middleware error', {
      requestId,
      clientIP,
      error: error instanceof Error ? error.message : error,
      url: req.originalUrl
    });
    
    // Fail securely - reject request if security validation fails
    res.status(500).json({
      status: 'error',
      code: 'SECURITY_VALIDATION_ERROR',
      message: 'Security validation failed'
    });
  }
};

// Additional security middleware for file uploads
export const fileUploadSecurity = (req: Request, res: Response, next: NextFunction): void => {
  const requestId = req.headers['x-request-id'] as string;
  const clientIP = req.ip;
  
  // Check for file upload attempts
  if (req.headers['content-type']?.includes('multipart/form-data')) {
    logger.info('File upload detected', {
      requestId,
      clientIP,
      contentType: req.headers['content-type'],
      url: req.originalUrl
    });
    
    // Additional file upload specific validations would go here
    // This is handled by multer middleware in the actual upload endpoints
  }
  
  next();
};

// IP-based security checks
export const ipSecurityCheck = (req: Request, res: Response, next: NextFunction): void => {
  const clientIP = req.ip;
  const forwardedIPs = req.headers['x-forwarded-for'] as string;
  
  // Log potentially spoofed IPs
  if (forwardedIPs && forwardedIPs.split(',').length > 3) {
    logger.warn('Suspicious IP forwarding chain detected', {
      clientIP,
      forwardedIPs,
      url: req.originalUrl,
      userAgent: req.get('User-Agent')
    });
  }
  
  // Check for localhost/private IP access from public endpoints
  if (req.originalUrl.includes('/admin') || req.originalUrl.includes('/internal')) {
    const isPrivateIP = /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|127\.)/.test(clientIP || '');
    if (!isPrivateIP && clientIP !== '::1') {
      logger.warn('Public IP attempting to access admin endpoint', {
        clientIP,
        url: req.originalUrl,
        userAgent: req.get('User-Agent')
      });
      // Don't block automatically - let admin middleware handle authorization
    }
  }
  
  next();
};
