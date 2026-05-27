/**
 * Dependency Review Utility
 * 
 * Handles security review of dependencies and vulnerability scanning.
 * Integrates with npm audit and GitHub security advisories.
 */

import { logInfo, logWarning, logError } from './error.utils';

// Declare require for dynamic imports
declare const require: any;
const { execSync } = require('child_process');

export interface Vulnerability {
  id: string;
  package: string;
  severity: 'critical' | 'high' | 'moderate' | 'low';
  title: string;
  description: string;
  affectedVersions: string;
  patchedVersions: string;
  url: string;
}

export interface AuditResult {
  timestamp: Date;
  vulnerabilities: Vulnerability[];
  totalVulnerabilities: number;
  criticalCount: number;
  highCount: number;
  moderateCount: number;
  lowCount: number;
  status: 'pass' | 'warning' | 'fail';
}

class DependencyReviewManager {
  private auditHistory: AuditResult[] = [];
  private readonly MAX_HISTORY = 52; // One year of weekly audits

  /**
   * Run npm audit to check for vulnerabilities
   */
  async runAudit(): Promise<AuditResult> {
    const timestamp = new Date();

    try {
      logInfo('Running npm audit for security vulnerabilities');

      let auditOutput: string;
      try {
        auditOutput = execSync('npm audit --json', { encoding: 'utf-8' });
      } catch (error) {
        // npm audit returns non-zero exit code if vulnerabilities found
        auditOutput = (error as any).stdout || '';
      }

      const auditData = JSON.parse(auditOutput);
      const vulnerabilities = this.parseAuditOutput(auditData);

      const result: AuditResult = {
        timestamp,
        vulnerabilities,
        totalVulnerabilities: vulnerabilities.length,
        criticalCount: vulnerabilities.filter((v) => v.severity === 'critical').length,
        highCount: vulnerabilities.filter((v) => v.severity === 'high').length,
        moderateCount: vulnerabilities.filter((v) => v.severity === 'moderate').length,
        lowCount: vulnerabilities.filter((v) => v.severity === 'low').length,
        status: vulnerabilities.length === 0 ? 'pass' : vulnerabilities.some((v) => v.severity === 'critical') ? 'fail' : 'warning',
      };

      this.auditHistory.push(result);

      // Keep only recent history
      if (this.auditHistory.length > this.MAX_HISTORY) {
        this.auditHistory = this.auditHistory.slice(-this.MAX_HISTORY);
      }

      if (result.status === 'pass') {
        logInfo('npm audit passed - no vulnerabilities found');
      } else if (result.status === 'fail') {
        logError(new Error('Critical vulnerabilities found'), 'critical', {
          vulnerabilities: result.totalVulnerabilities,
          critical: result.criticalCount,
        });
      } else {
        logWarning('npm audit found vulnerabilities', {
          total: result.totalVulnerabilities,
          critical: result.criticalCount,
          high: result.highCount,
        });
      }

      return result;
    } catch (error) {
      logError(error as Error, 'high', {
        operation: 'npm_audit',
      });

      return {
        timestamp,
        vulnerabilities: [],
        totalVulnerabilities: 0,
        criticalCount: 0,
        highCount: 0,
        moderateCount: 0,
        lowCount: 0,
        status: 'fail',
      };
    }
  }

  /**
   * Parse npm audit output
   */
  private parseAuditOutput(auditData: any): Vulnerability[] {
    const vulnerabilities: Vulnerability[] = [];

    if (!auditData.vulnerabilities) {
      return vulnerabilities;
    }

    for (const [packageName, vulnData] of Object.entries(auditData.vulnerabilities)) {
      const data = vulnData as any;

      if (data.vulnerabilities) {
        for (const vuln of data.vulnerabilities) {
          vulnerabilities.push({
            id: vuln.id || `${packageName}-${vuln.title}`,
            package: packageName,
            severity: vuln.severity || 'moderate',
            title: vuln.title || 'Unknown vulnerability',
            description: vuln.description || '',
            affectedVersions: vuln.range || 'unknown',
            patchedVersions: vuln.patched || 'unknown',
            url: vuln.url || '',
          });
        }
      }
    }

    return vulnerabilities;
  }

  /**
   * Get audit history
   */
  getAuditHistory(limit: number = 10): AuditResult[] {
    return this.auditHistory.slice(-limit);
  }

  /**
   * Get latest audit result
   */
  getLatestAudit(): AuditResult | undefined {
    return this.auditHistory[this.auditHistory.length - 1];
  }

  /**
   * Get audit statistics
   */
  getAuditStats() {
    if (this.auditHistory.length === 0) {
      return {
        totalAudits: 0,
        passedAudits: 0,
        failedAudits: 0,
        warningAudits: 0,
        averageVulnerabilities: 0,
        criticalVulnerabilities: 0,
      };
    }

    const passed = this.auditHistory.filter((a) => a.status === 'pass').length;
    const failed = this.auditHistory.filter((a) => a.status === 'fail').length;
    const warning = this.auditHistory.filter((a) => a.status === 'warning').length;
    const avgVulns = this.auditHistory.reduce((sum, a) => sum + a.totalVulnerabilities, 0) / this.auditHistory.length;
    const criticalVulns = this.auditHistory.reduce((sum, a) => sum + a.criticalCount, 0);

    return {
      totalAudits: this.auditHistory.length,
      passedAudits: passed,
      failedAudits: failed,
      warningAudits: warning,
      averageVulnerabilities: Math.round(avgVulns * 100) / 100,
      criticalVulnerabilities: criticalVulns,
      latestAudit: this.auditHistory[this.auditHistory.length - 1],
    };
  }

  /**
   * Clear audit history
   */
  clearHistory(): void {
    this.auditHistory = [];
    logInfo('Dependency audit history cleared');
  }
}

export default new DependencyReviewManager();
