import { Request, Response, NextFunction } from 'express';
import { getT, detectLanguage, SupportedLanguage } from '../config/i18n.config';

declare global {
  namespace Express {
    interface Request {
      t: (key: string, options?: any) => string;
      language: SupportedLanguage;
    }
  }
}

/**
 * i18n Middleware
 * Detects language from user preference or Accept-Language header
 * and attaches translation function to request object
 */
export const i18nMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  // Priority: user preference > Accept-Language header > default
  const userLanguage = (req as any).user?.language;
  const headerLanguage = req.headers['accept-language'] as string | undefined;
  
  const language: SupportedLanguage = userLanguage 
    || detectLanguage(headerLanguage) 
    || 'en';
  
  // Attach translation function and language to request
  req.t = getT(language);
  req.language = language;
  
  // Add language to response headers
  res.setHeader('Content-Language', language);
  
  next();
};

export default i18nMiddleware;
