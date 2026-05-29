import { TenantModel } from '../models/tenant.model';
import { TenantRecord } from '../types/tenant.types';

export const TenantService = {
  async getByDomain(domain: string): Promise<TenantRecord | null> {
    return TenantModel.findByDomain(domain);
  },

  async getById(id: string): Promise<TenantRecord | null> {
    return TenantModel.findById(id);
  },

  async create(data: {
    name: string;
    domain: string;
    branding: TenantRecord['branding'];
    features?: string[];
    limits?: TenantRecord['limits'];
    status?: TenantRecord['status'];
  }): Promise<TenantRecord> {
    return TenantModel.create(data);
  },

  async update(
    id: string,
    data: Partial<Omit<TenantRecord, 'id' | 'created_at' | 'updated_at'>>,
  ): Promise<TenantRecord | null> {
    const tenant = await TenantModel.findById(id);
    if (!tenant) return null;
    return TenantModel.update(id, data);
  },

  async list(filters?: {
    status?: string;
    page?: number;
    limit?: number;
  }): Promise<{ tenants: TenantRecord[]; total: number }> {
    return TenantModel.list(filters);
  },

  hasFeature(tenant: TenantRecord, feature: string): boolean {
    return tenant.features.includes(feature);
  },
};
