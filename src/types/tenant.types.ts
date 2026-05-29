export interface TenantBranding {
  logo: string;
  primaryColor: string;
  secondaryColor: string;
  customCSS?: string;
}

export interface TenantLimits {
  maxUsers: number;
  maxMentors: number;
  maxSessions: number;
}

export type TenantStatus = 'active' | 'suspended' | 'trial';

export interface Tenant {
  id: string;
  name: string;
  domain: string;
  branding: TenantBranding;
  features: string[];
  limits: TenantLimits;
  status: TenantStatus;
  created_at: Date;
  updated_at: Date;
}

export interface TenantRecord {
  id: string;
  name: string;
  domain: string;
  branding: TenantBranding;
  features: string[];
  limits: TenantLimits;
  status: TenantStatus;
  created_at: Date;
  updated_at: Date;
}
