/**
 * Earnings Report Validation Schemas
 */

import { z } from 'zod';

// Period validation
const periodSchema = z
  .enum(['7d', '30d', '90d', '1y'])
  .default('30d')
  .describe('Earnings period: 7 days, 30 days, 90 days, or 1 year');

// Format validation
const exportFormatSchema = z
  .enum(['csv', 'pdf'])
  .default('csv')
  .describe('Export format: CSV or PDF');

// Pagination schema
const paginationSchema = z.object({
  page: z
    .string()
    .optional()
    .transform((v) => (v ? parseInt(v, 10) : 1))
    .refine((v) => v >= 1, 'Page must be >= 1'),
  limit: z
    .string()
    .optional()
    .transform((v) => (v ? parseInt(v, 10) : 20))
    .refine((v) => v >= 1 && v <= 100, 'Limit must be between 1 and 100'),
});

// Date range schema
const dateRangeSchema = z.object({
  startDate: z.string().datetime({ offset: true }).optional(),
  endDate: z.string().datetime({ offset: true }).optional(),
});

// Earnings summary query schema
export const getEarningsSummarySchema = z.object({
  query: z.object({
    period: periodSchema,
  }),
});

// Earnings breakdown query schema
export const getEarningsBreakdownSchema = z.object({
  query: paginationSchema.merge(dateRangeSchema),
});

// Export earnings query schema
export const exportEarningsSchema = z.object({
  query: z
    .object({
      format: exportFormatSchema,
      period: periodSchema.optional(),
      startDate: z.string().datetime({ offset: true }).optional(),
      endDate: z.string().datetime({ offset: true }).optional(),
    })
    .refine(
      (data) => {
        // Either period or (startDate && endDate) must be provided
        if (data.period) return true;
        if (data.startDate && data.endDate) return true;
        return false;
      },
      {
        message: 'Either period or both startDate and endDate must be provided',
        path: ['period'],
      },
    ),
});

// Export status query schema
export const getExportStatusSchema = z.object({
  params: z.object({
    jobId: z.string().uuid().describe('Job ID for the export'),
  }),
});

// Download export query schema
export const downloadExportSchema = z.object({
  params: z.object({
    jobId: z.string().uuid().describe('Job ID for the export'),
  }),
});

// Types
export type GetEarningsSummaryQuery = z.infer<typeof getEarningsSummarySchema>['query'];
export type GetEarningsBreakdownQuery = z.infer<typeof getEarningsBreakdownSchema>['query'];
export type ExportEarningsQuery = z.infer<typeof exportEarningsSchema>['query'];
export type GetExportStatusParams = z.infer<typeof getExportStatusSchema>['params'];
export type DownloadExportParams = z.infer<typeof downloadExportSchema>['params'];
