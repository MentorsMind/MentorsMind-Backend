import ipaddr from 'ipaddr.js';
import pool from '../config/database';
import { env } from '../config/env';
import { CacheService } from './cache.service';
import { logger } from '../utils/logger.utils';
import { AuditLogService } from './auditLog.service';

export interface IpRule {
  id: string;
  ip_range: string;
  rule_type: 'allow' | 'block';
  context: 'admin' | 'global';
  reason?: string;
  created_at: Date;
}

const CACHE_KEY = 'ip_filter:rules';
const CACHE_TTL = 30; // 30 seconds as per requirement

export class IpFilterService {
  /**
   * Get all active IP rules, cached for performance.
   */
  static async getRules(): Promise<IpRule[]> {
    return CacheService.wrap(CACHE_KEY, CACHE_TTL, async () => {
      const { rows } = await pool.query<IpRule>(
        'SELECT * FROM ip_rules ORDER BY created_at DESC'
      );
      return rows;
    });
  }

  /**
   * Add a new IP rule.
   */
  static async addRule(data: {
    ipRange: string;
    ruleType: 'allow' | 'block';
    context: 'admin' | 'global';
    reason?: string;
    adminId: string;
    ipAddress?: string;
  }): Promise<IpRule> {
    // Validate IP/CIDR format
    try {
      if (data.ipRange.includes('/')) {
        ipaddr.parseCIDR(data.ipRange);
      } else {
        ipaddr.parse(data.ipRange);
      }
    } catch (err) {
      throw new Error(`Invalid IP or CIDR format: ${data.ipRange}`);
    }

    const { rows } = await pool.query<IpRule>(
      `INSERT INTO ip_rules (ip_range, rule_type, context, reason)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [data.ipRange, data.ruleType, data.context, data.reason]
    );

    await CacheService.del(CACHE_KEY);

    await AuditLogService.log({
      userId: data.adminId,
      action: 'IP_RULE_ADDED',
      resourceType: 'security',
      resourceId: rows[0].id,
      ipAddress: data.ipAddress || 'unknown',
      metadata: { 
        ipRange: data.ipRange, 
        ruleType: data.ruleType, 
        context: data.context 
      },
    });

    return rows[0];
  }

  /**
   * Remove an IP rule.
   */
  static async removeRule(id: string, adminId: string, ipAddress?: string): Promise<boolean> {
    const { rows } = await pool.query<IpRule>(
      'DELETE FROM ip_rules WHERE id = $1 RETURNING *',
      [id]
    );

    if (rows.length === 0) return false;

    await CacheService.del(CACHE_KEY);

    await AuditLogService.log({
      userId: adminId,
      action: 'IP_RULE_REMOVED',
      resourceType: 'security',
      resourceId: id,
      ipAddress: ipAddress || 'unknown',
      metadata: { 
        ipRange: rows[0].ip_range, 
        ruleType: rows[0].rule_type, 
        context: rows[0].context 
      },
    });

    return true;
  }

  /**
   * Check if an IP is blocked globally.
   */
  static async isIpBlocked(ip: string): Promise<boolean> {
    const rules = await this.getRules();
    const globalBlocklist = rules.filter(r => r.rule_type === 'block' && r.context === 'global');
    
    return this.matchIp(ip, globalBlocklist.map(r => r.ip_range));
  }

  /**
   * Check if an IP is allowed for a specific context (e.g., admin routes).
   * If the allowlist is empty for that context, all are allowed.
   */
  static async isIpAllowed(ip: string, context: 'admin'): Promise<boolean> {
    const rules = await this.getRules();
    const dbAllowlist = rules.filter(r => r.rule_type === 'allow' && r.context === context).map(r => r.ip_range);
    
    // Merge with environment-based whitelist
    const envWhitelist = env.ADMIN_IP_WHITELIST
      ? env.ADMIN_IP_WHITELIST.split(',').map(s => s.trim()).filter(Boolean)
      : [];
    
    const combinedAllowlist = [...dbAllowlist, ...envWhitelist];

    if (combinedAllowlist.length === 0) return true;

    return this.matchIp(ip, combinedAllowlist);
  }

  /**
   * Helper to match an IP against a list of IP/CIDR ranges.
   */
  private static matchIp(ip: string, ranges: string[]): boolean {
    if (ranges.length === 0) return false;

    try {
      const addr = ipaddr.parse(ip);
      
      return ranges.some(rangeStr => {
        try {
          if (rangeStr.includes('/')) {
            const range = ipaddr.parseCIDR(rangeStr);
            return addr.match(range);
          } else {
            const rangeAddr = ipaddr.parse(rangeStr);
            // Handle IPv4-mapped IPv6 addresses if necessary
            if (addr.kind() !== rangeAddr.kind()) {
                if (addr.kind() === 'ipv6' && (addr as any).isIPv4MappedAddress()) {
                    return (addr as any).toIPv4Address().match(ipaddr.parse(rangeStr));
                }
                return false;
            }
            return addr.toString() === rangeAddr.toString();
          }
        } catch (e) {
          logger.error({ rangeStr, error: e }, 'Error matching IP range');
          return false;
        }
      });
    } catch (err) {
      logger.error({ ip, error: err }, 'Error parsing incoming IP');
      return false;
    }
  }
}
