import pool from '../config/database';
import { TenantRecord } from '../types/tenant.types';

export const TenantModel = {
  async findByDomain(domain: string): Promise<TenantRecord | null> {
    const { rows } = await pool.query<TenantRecord>(
      `SELECT id, name, domain, branding, features, limits, status, created_at, updated_at
       FROM tenants WHERE domain = $1 AND status != 'suspended'`,
      [domain],
    );
    return rows[0] || null;
  },

  async findById(id: string): Promise<TenantRecord | null> {
    const { rows } = await pool.query<TenantRecord>(
      `SELECT id, name, domain, branding, features, limits, status, created_at, updated_at
       FROM tenants WHERE id = $1`,
      [id],
    );
    return rows[0] || null;
  },

  async create(data: {
    name: string;
    domain: string;
    branding: TenantRecord['branding'];
    features?: string[];
    limits?: TenantRecord['limits'];
    status?: TenantRecord['status'];
  }): Promise<TenantRecord> {
    const features = data.features ?? [];
    const limits = data.limits ?? { maxUsers: 100, maxMentors: 20, maxSessions: 500 };
    const status = data.status ?? 'trial';

    const { rows } = await pool.query<TenantRecord>(
      `INSERT INTO tenants (name, domain, branding, features, limits, status)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [data.name, data.domain, JSON.stringify(data.branding), JSON.stringify(features), JSON.stringify(limits), status],
    );
    return rows[0];
  },

  async update(
    id: string,
    data: Partial<{
      name: string;
      domain: string;
      branding: TenantRecord['branding'];
      features: string[];
      limits: TenantRecord['limits'];
      status: TenantRecord['status'];
    }>,
  ): Promise<TenantRecord | null> {
    const fields: string[] = [];
    const values: any[] = [];
    let idx = 1;

    if (data.name !== undefined) { fields.push(`name = $${idx++}`); values.push(data.name); }
    if (data.domain !== undefined) { fields.push(`domain = $${idx++}`); values.push(data.domain); }
    if (data.branding !== undefined) { fields.push(`branding = $${idx++}`); values.push(JSON.stringify(data.branding)); }
    if (data.features !== undefined) { fields.push(`features = $${idx++}`); values.push(JSON.stringify(data.features)); }
    if (data.limits !== undefined) { fields.push(`limits = $${idx++}`); values.push(JSON.stringify(data.limits)); }
    if (data.status !== undefined) { fields.push(`status = $${idx++}`); values.push(data.status); }

    if (fields.length === 0) return this.findById(id);

    fields.push(`updated_at = NOW()`);
    values.push(id);

    const { rows } = await pool.query<TenantRecord>(
      `UPDATE tenants SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
      values,
    );
    return rows[0] || null;
  },

  async list(filters?: { status?: string; page?: number; limit?: number }): Promise<{ tenants: TenantRecord[]; total: number }> {
    const page = filters?.page ?? 1;
    const limit = filters?.limit ?? 20;
    const offset = (page - 1) * limit;

    const where = filters?.status ? `WHERE status = $1` : '';
    const params: any[] = filters?.status ? [filters.status, limit, offset] : [limit, offset];
    const limitIdx = filters?.status ? 2 : 1;

    const [data, count] = await Promise.all([
      pool.query<TenantRecord>(
        `SELECT * FROM tenants ${where} ORDER BY created_at DESC LIMIT $${limitIdx} OFFSET $${limitIdx + 1}`,
        params,
      ),
      pool.query(`SELECT COUNT(*) FROM tenants ${where}`, filters?.status ? [filters.status] : []),
    ]);

    return { tenants: data.rows, total: parseInt(count.rows[0].count, 10) };
  },
};
