import pool from "../config/database";
import { logger } from "../utils/logger.utils";

type Period = "7d" | "30d" | "90d" | "1y";

interface RevenueBucketRow {
  currency: string;
  gross_volume: string;
  platform_fees_collected: string;
}

interface DailyRevenueRow {
  date: string;
  gross_volume: string;
  platform_fees_collected: string;
}

interface DailyRefundRow {
  date: string;
  refunds_issued: string;
}

interface TransactionRow {
  id: string;
  created_at: string;
  completed_at: string | null;
  status: string;
  type: string;
  currency: string;
  amount: string;
  platform_fee: string;
  related_transaction_id: string | null;
  user_id: string | null;
  booking_id: string | null;
}

interface TransactionsFilter {
  status?: string;
  from: string;
  to: string;
}

interface ExportFilter {
  status?: string;
  from?: string;
  to?: string;
}

const PERIOD_DAYS: Record<Period, number> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
  "1y": 365,
};

const TRANSACTION_VIEW_CANDIDATES = Array.from(
  new Set(
    [
      process.env.ANALYTICS_TRANSACTION_MV,
      "mv_transaction_reporting",
      "mv_admin_transactions",
      "mv_transactions_reporting",
      "mv_transactions_report",
      "mv_revenue_transactions",
    ].filter((value): value is string => Boolean(value)),
  ),
);

let cachedTransactionViewName: string | null | undefined;

function parseAmount(value: string | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function round(value: number): number {
  return Number(value.toFixed(2));
}

function assertIsoDate(value: string, field: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${field} must be in YYYY-MM-DD format`);
  }
}

function parsePeriod(period: string): Period {
  if (period === "7d" || period === "30d" || period === "90d" || period === "1y") {
    return period;
  }

  throw new Error("Invalid period. Allowed values: 7d, 30d, 90d, 1y");
}

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = String(value);

  if (text.includes(",") || text.includes('"') || text.includes("\n")) {
    return `"${text.replace(/"/g, '""')}"`;
  }

  return text;
}

function validateMatViewName(name: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error("Invalid materialized view name configured for transaction reporting");
  }
  return name;
}

async function resolveTransactionViewName(): Promise<string> {
  if (cachedTransactionViewName !== undefined) {
    if (!cachedTransactionViewName) {
      throw new Error("Transaction reporting materialized view is not available");
    }
    return cachedTransactionViewName;
  }

  const { rows } = await pool.query<{ matviewname: string }>(
    `
      SELECT matviewname
      FROM pg_matviews
      WHERE schemaname = ANY(current_schemas(false))
      AND matviewname = ANY($1::text[])
      ORDER BY array_position($1::text[], matviewname)
      LIMIT 1
    `,
    [TRANSACTION_VIEW_CANDIDATES],
  );

  cachedTransactionViewName = rows[0]?.matviewname ?? null;

  if (!cachedTransactionViewName) {
    logger.error("No supported transaction-reporting materialized view found", {
      candidates: TRANSACTION_VIEW_CANDIDATES,
    });
    throw new Error(
      "No transaction-reporting materialized view found. Ensure BE-16 views are applied.",
    );
  }

  return validateMatViewName(cachedTransactionViewName);
}

function previousWindowDays(period: Period): number {
  return PERIOD_DAYS[period];
}

export const RevenueReportService = {
  async getRevenueSummary(period: string = "30d") {
    const parsedPeriod = parsePeriod(period);
    const days = PERIOD_DAYS[parsedPeriod];
    const prevDays = previousWindowDays(parsedPeriod);
    const txViewName = await resolveTransactionViewName();

    const [currentRevenue, previousRevenue, refunds, previousRefunds] = await Promise.all([
      pool.query<RevenueBucketRow>(
        `
          SELECT
            currency,
            SUM(total_amount)::text AS gross_volume,
            SUM(total_platform_fee)::text AS platform_fees_collected
          FROM mv_daily_revenue
          WHERE date >= CURRENT_DATE - $1::integer
          GROUP BY currency
          ORDER BY currency
        `,
        [days],
      ),
      pool.query<{ platform_fees_collected: string }>(
        `
          SELECT
            COALESCE(SUM(total_platform_fee), 0)::text AS platform_fees_collected
          FROM mv_daily_revenue
          WHERE date >= CURRENT_DATE - ($1::integer * 2)
          AND date < CURRENT_DATE - $1::integer
        `,
        [prevDays],
      ),
      pool.query<{ refunds_issued: string }>(
        `
          SELECT
            COALESCE(SUM(amount), 0)::text AS refunds_issued
          FROM ${txViewName}
          WHERE type = 'refund'
          AND status IN ('completed', 'refunded')
          AND created_at >= CURRENT_DATE - $1::integer
        `,
        [days],
      ),
      pool.query<{ refunds_issued: string }>(
        `
          SELECT
            COALESCE(SUM(amount), 0)::text AS refunds_issued
          FROM ${txViewName}
          WHERE type = 'refund'
          AND status IN ('completed', 'refunded')
          AND created_at >= CURRENT_DATE - ($1::integer * 2)
          AND created_at < CURRENT_DATE - $1::integer
        `,
        [prevDays],
      ),
    ]);

    const grossVolume = currentRevenue.rows.reduce(
      (sum, row) => sum + parseAmount(row.gross_volume),
      0,
    );
    const platformFees = currentRevenue.rows.reduce(
      (sum, row) => sum + parseAmount(row.platform_fees_collected),
      0,
    );
    const refundsIssued = parseAmount(refunds.rows[0]?.refunds_issued);

    const previousPlatformFees = parseAmount(
      previousRevenue.rows[0]?.platform_fees_collected,
    );
    const previousRefundsIssued = parseAmount(
      previousRefunds.rows[0]?.refunds_issued,
    );
    const netRevenue = platformFees - refundsIssued;
    const previousNetRevenue = previousPlatformFees - previousRefundsIssued;

    const vsPreviousPeriod =
      previousNetRevenue === 0
        ? netRevenue === 0
          ? 0
          : 100
        : ((netRevenue - previousNetRevenue) / previousNetRevenue) * 100;

    return {
      gross_volume: round(grossVolume),
      platform_fees_collected: round(platformFees),
      refunds_issued: round(refundsIssued),
      net_revenue: round(netRevenue),
      by_asset: currentRevenue.rows.map((row) => ({
        asset: row.currency,
        gross_volume: round(parseAmount(row.gross_volume)),
        platform_fees_collected: round(parseAmount(row.platform_fees_collected)),
      })),
      vs_previous_period: round(vsPreviousPeriod),
    };
  },

  async getDailyRevenue(from: string, to: string) {
    assertIsoDate(from, "from");
    assertIsoDate(to, "to");

    const txViewName = await resolveTransactionViewName();

    const [revenueRows, refundRows] = await Promise.all([
      pool.query<DailyRevenueRow>(
        `
          SELECT
            date::text,
            COALESCE(SUM(total_amount), 0)::text AS gross_volume,
            COALESCE(SUM(total_platform_fee), 0)::text AS platform_fees_collected
          FROM mv_daily_revenue
          WHERE date BETWEEN $1::date AND $2::date
          GROUP BY date
          ORDER BY date ASC
        `,
        [from, to],
      ),
      pool.query<DailyRefundRow>(
        `
          SELECT
            DATE(created_at)::text AS date,
            COALESCE(SUM(amount), 0)::text AS refunds_issued
          FROM ${txViewName}
          WHERE type = 'refund'
          AND status IN ('completed', 'refunded')
          AND DATE(created_at) BETWEEN $1::date AND $2::date
          GROUP BY DATE(created_at)
          ORDER BY DATE(created_at) ASC
        `,
        [from, to],
      ),
    ]);

    const refundMap = new Map<string, number>(
      refundRows.rows.map((row) => [row.date, parseAmount(row.refunds_issued)]),
    );

    return revenueRows.rows.map((row) => {
      const grossVolume = parseAmount(row.gross_volume);
      const platformFees = parseAmount(row.platform_fees_collected);
      const refundsIssued = refundMap.get(row.date) || 0;

      return {
        date: row.date,
        gross_volume: round(grossVolume),
        platform_fees_collected: round(platformFees),
        refunds_issued: round(refundsIssued),
        net_revenue: round(platformFees - refundsIssued),
      };
    });
  },

  async getTransactions(filter: TransactionsFilter) {
    assertIsoDate(filter.from, "from");
    assertIsoDate(filter.to, "to");

    const txViewName = await resolveTransactionViewName();
    const params: Array<string> = [filter.from, filter.to];
    let whereClause = `DATE(created_at) BETWEEN $1::date AND $2::date`;

    if (filter.status) {
      params.push(filter.status);
      whereClause += ` AND status = $${params.length}`;
    }

    const { rows } = await pool.query<TransactionRow>(
      `
        SELECT
          id,
          created_at::text,
          completed_at::text,
          status,
          type,
          currency,
          amount::text,
          platform_fee::text,
          related_transaction_id,
          user_id,
          booking_id
        FROM ${txViewName}
        WHERE ${whereClause}
        ORDER BY created_at DESC
      `,
      params,
    );

    return rows.map((row) => {
      const amount = parseAmount(row.amount);
      const fee = parseAmount(row.platform_fee);
      const refundAmount = row.type === "refund" ? amount : 0;

      return {
        id: row.id,
        created_at: row.created_at,
        completed_at: row.completed_at,
        status: row.status,
        type: row.type,
        currency: row.currency,
        amount: round(amount),
        platform_fee: round(fee),
        refund_amount: round(refundAmount),
        net_revenue: round(fee - refundAmount),
        related_transaction_id: row.related_transaction_id,
        user_id: row.user_id,
        booking_id: row.booking_id,
      };
    });
  },

  async exportRevenueCSV(filter: ExportFilter = {}): Promise<string> {
    const to = filter.to || new Date().toISOString().slice(0, 10);
    const from =
      filter.from || new Date(Date.now() - 29 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const transactions = await this.getTransactions({
      status: filter.status,
      from,
      to,
    });

    const headers = [
      "id",
      "created_at",
      "completed_at",
      "status",
      "type",
      "currency",
      "amount",
      "platform_fee",
      "refund_amount",
      "net_revenue",
      "related_transaction_id",
      "user_id",
      "booking_id",
    ];

    const csvRows = [headers.join(",")];

    for (const transaction of transactions) {
      const row = headers.map((header) =>
        csvEscape(transaction[header as keyof typeof transaction]),
      );
      csvRows.push(row.join(","));
    }

    return csvRows.join("\n");
  },
};
