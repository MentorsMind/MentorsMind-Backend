/**
 * Data Quality Service
 * Validates and monitors data quality in ETL pipelines
 * Issue #873
 */

import { Logger } from "../utils/logger.utils";

export interface DataQualityRule {
  name: string;
  field: string;
  validator: (value: any) => boolean;
  severity: 'error' | 'warning';
}

export interface DataQualityReport {
  totalRecords: number;
  validRecords: number;
  invalidRecords: number;
  warnings: number;
  errors: Array<{ rule: string; field: string; value: any; record: any }>;
}

export class DataQualityService {
  private logger: Logger;
  private rules: DataQualityRule[] = [];

  constructor() {
    this.logger = new Logger('DataQuality');
    this.initializeDefaultRules();
  }

  private initializeDefaultRules(): void {
    this.addRule({
      name: 'notNull',
      field: '*',
      validator: (value) => value !== null && value !== undefined,
      severity: 'error',
    });

    this.addRule({
      name: 'emailFormat',
      field: 'email',
      validator: (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value),
      severity: 'error',
    });

    this.addRule({
      name: 'positiveNumber',
      field: 'amount',
      validator: (value) => typeof value === 'number' && value >= 0,
      severity: 'error',
    });
  }

  public addRule(rule: DataQualityRule): void {
    this.rules.push(rule);
    this.logger.debug(`Added data quality rule: ${rule.name} for field ${rule.field}`);
  }

  public validateBatch(records: any[]): DataQualityReport {
    const report: DataQualityReport = {
      totalRecords: records.length,
      validRecords: 0,
      invalidRecords: 0,
      warnings: 0,
      errors: [],
    };

    for (const record of records) {
      const violations = this.validateRecord(record);
      
      if (violations.length === 0) {
        report.validRecords++;
      } else {
        report.invalidRecords++;
        const errorViolations = violations.filter(v => v.severity === 'error');
        const warningViolations = violations.filter(v => v.severity === 'warning');
        
        report.warnings += warningViolations.length;
        report.errors.push(...errorViolations.map(v => ({
          rule: v.rule,
          field: v.field,
          value: record[v.field],
          record,
        })));
      }
    }

    this.logger.info(
      `Data quality check: ${report.validRecords}/${report.totalRecords} valid, ` +
      `${report.errors.length} errors, ${report.warnings} warnings`
    );

    return report;
  }

  private validateRecord(record: any): Array<{ rule: string; field: string; severity: 'error' | 'warning' }> {
    const violations: Array<{ rule: string; field: string; severity: 'error' | 'warning' }> = [];

    for (const rule of this.rules) {
      const fieldsToCheck = rule.field === '*' ? Object.keys(record) : [rule.field];

      for (const field of fieldsToCheck) {
        if (record.hasOwnProperty(field)) {
          if (!rule.validator(record[field])) {
            violations.push({
              rule: rule.name,
              field,
              severity: rule.severity,
            });
          }
        }
      }
    }

    return violations;
  }

  public sanitizeRecord(record: any): any {
    const sanitized = { ...record };

    // Remove null/undefined values
    for (const key in sanitized) {
      if (sanitized[key] === null || sanitized[key] === undefined) {
        delete sanitized[key];
      }
    }

    // Trim string values
    for (const key in sanitized) {
      if (typeof sanitized[key] === 'string') {
        sanitized[key] = sanitized[key].trim();
      }
    }

    return sanitized;
  }
}
