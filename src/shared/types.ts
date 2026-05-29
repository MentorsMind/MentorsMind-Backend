// Common Result Pattern
export type Result<T, E = Error> = 
  | { success: true; data: T }
  | { success: false; error: E };

// Paginated Response
export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

// API Response
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: {
    message: string;
    code?: string;
    details?: any;
  };
}

// Common User Context
export interface UserContext {
  userId: string;
  email: string;
  role: string;
  isAdmin?: boolean;
  isMentor?: boolean;
  isLearner?: boolean;
}

// Health Check
export interface HealthStatus {
  status: "healthy" | "unhealthy" | "degraded";
  service: string;
  version?: string;
  timestamp: Date;
  checks?: {
    [key: string]: "ok" | "failed" | "degraded";
  };
}
