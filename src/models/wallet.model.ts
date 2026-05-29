import pool from '../config/database';

export interface Wallet {
  id: string;
  user_id: string;
  stellar_public_key: string;
  status: 'active' | 'inactive' | 'suspended';
  created_at: Date;
  updated_at: Date;
}

export const WalletModel = {
  async initializeTable(): Promise<void> {
    const query = `
      CREATE TABLE IF NOT EXISTS wallets (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL UNIQUE,
        stellar_public_key VARCHAR(56) NOT NULL UNIQUE,
        status VARCHAR(20) NOT NULL DEFAULT 'active',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        
        CONSTRAINT wallets_status_check CHECK (status IN ('active', 'inactive', 'suspended')),
        CONSTRAINT wallets_stellar_key_format CHECK (stellar_public_key ~ '^G[A-Z2-7]{55}$')
      );

      CREATE INDEX IF NOT EXISTS idx_wallets_user_id ON wallets(user_id);
      CREATE INDEX IF NOT EXISTS idx_wallets_stellar_key ON wallets(stellar_public_key);
      CREATE INDEX IF NOT EXISTS idx_wallets_status ON wallets(status);
    `;
    await pool.query(query);
  },

  async findByUserId(userId: string): Promise<Wallet | null> {
    const query = 'SELECT * FROM wallets WHERE user_id = $1;';
    const { rows } = await pool.query<Wallet>(query, [userId]);
    return rows[0] || null;
  },

  async findByStellarPublicKey(stellarPublicKey: string): Promise<Wallet | null> {
    const query = 'SELECT * FROM wallets WHERE stellar_public_key = $1;';
    const { rows } = await pool.query<Wallet>(query, [stellarPublicKey]);
    return rows[0] || null;
  },

  async create(userId: string, stellarPublicKey: string): Promise<Wallet> {
    const query = `
      INSERT INTO wallets (user_id, stellar_public_key, status)
      VALUES ($1, $2, 'active')
      RETURNING *;
    `;
    const { rows } = await pool.query<Wallet>(query, [userId, stellarPublicKey]);
    return rows[0];
  },

  async updateStatus(userId: string, status: 'active' | 'inactive' | 'suspended'): Promise<Wallet | null> {
    const query = `
      UPDATE wallets 
      SET status = $2, updated_at = CURRENT_TIMESTAMP
      WHERE user_id = $1
      RETURNING *;
    `;
    const { rows } = await pool.query<Wallet>(query, [userId, status]);
    return rows[0] || null;
  },

  async updateStellarPublicKey(userId: string, stellarPublicKey: string): Promise<Wallet | null> {
    const query = `
      UPDATE wallets 
      SET stellar_public_key = $2, updated_at = CURRENT_TIMESTAMP
      WHERE user_id = $1
      RETURNING *;
    `;
    const { rows } = await pool.query<Wallet>(query, [userId, stellarPublicKey]);
    return rows[0] || null;
  },

  async delete(userId: string): Promise<boolean> {
    const query = 'DELETE FROM wallets WHERE user_id = $1;';
    const { rowCount } = await pool.query(query, [userId]);
    return (rowCount ?? 0) > 0;
  },

  async findAll(limit = 50, offset = 0): Promise<Wallet[]> {
    const query = `
      SELECT * FROM wallets 
      ORDER BY created_at DESC 
      LIMIT $1 OFFSET $2;
    `;
    const { rows } = await pool.query<Wallet>(query, [limit, offset]);
    return rows;
  },

  async count(): Promise<number> {
    const { rows } = await pool.query('SELECT COUNT(*) FROM wallets');
    return parseInt(rows[0].count, 10);
  },

  async getStats(): Promise<{ total: number; active: number; inactive: number; suspended: number }> {
    const query = `
      SELECT 
        COUNT(*) as total,
        COUNT(CASE WHEN status = 'active' THEN 1 END) as active,
        COUNT(CASE WHEN status = 'inactive' THEN 1 END) as inactive,
        COUNT(CASE WHEN status = 'suspended' THEN 1 END) as suspended
      FROM wallets;
    `;
    const { rows } = await pool.query(query);
    return {
      total: parseInt(rows[0].total, 10),
      active: parseInt(rows[0].active, 10),
      inactive: parseInt(rows[0].inactive, 10),
      suspended: parseInt(rows[0].suspended, 10),
    };
  },
};