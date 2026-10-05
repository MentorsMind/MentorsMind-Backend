import pool from "../config/database";
import { StorageService } from "./storage.service";
import { EmailService } from "./email.service";
import { generateInvoicePdf } from "../utils/invoice-pdf.utils";
import { env } from "../config/env";
import { Logger } from "../utils/logger.utils";

export interface LineItem {
  description: string;
  quantity: number;
  unitPrice: string;
  total: string;
  taxRate: number;
}

export interface Invoice {
  id: string;
  invoiceNumber: string;
  userId: string;
  type: "session" | "subscription" | "refund";
  lineItems: LineItem[];
  subtotal: string;
  tax: string;
  total: string;
  currency: string;
  status: "draft" | "sent" | "paid" | "overdue" | "cancelled";
  dueDate: Date;
  pdfUrl: string;
}

// ---------------------------------------------------------------------------
// S3 key helpers
// ---------------------------------------------------------------------------

function buildInvoiceS3Key(userId: string, invoiceId: string): string {
  const year = new Date().getFullYear();
  return `invoices/${userId}/${year}/${invoiceId}.pdf`;
}

/** Extracts the S3 object key from an s3://bucket/key URL stored in the DB. */
function keyFromS3Url(s3Url: string): string {
  // s3://<bucket>/<key>
  const withoutScheme = s3Url.replace(/^s3:\/\/[^/]+\//, "");
  return withoutScheme;
}

// ---------------------------------------------------------------------------
// User lookup helper
// ---------------------------------------------------------------------------

interface UserRecord {
  email: string;
  fullName: string;
}

async function getUserById(userId: string): Promise<UserRecord | null> {
  const result = await pool.query(
    "SELECT email, full_name FROM users WHERE id = $1",
    [userId],
  );
  if (!result.rows[0]) return null;
  return {
    email: result.rows[0].email,
    fullName: result.rows[0].full_name ?? "Valued Customer",
  };
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class InvoiceService {
  /**
   * Generate a sequential invoice number: INV-YYYYMM-NNNN
   */
  private static async generateInvoiceNumber(): Promise<string> {
    const result = await pool.query(
      `SELECT COUNT(*) AS count FROM invoices
       WHERE created_at >= date_trunc('month', NOW())`,
    );
    const seq = parseInt(result.rows[0].count) + 1;
    const now = new Date();
    const ym = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
    return `INV-${ym}-${String(seq).padStart(4, "0")}`;
  }

  /**
   * Calculate subtotal, tax, and total from line items.
   */
  private static calculateTotals(lineItems: LineItem[]): {
    subtotal: string;
    tax: string;
    total: string;
  } {
    let subtotal = 0;
    let tax = 0;
    for (const item of lineItems) {
      const itemTotal = parseFloat(item.total);
      subtotal += itemTotal;
      tax += itemTotal * (item.taxRate / 100);
    }
    return {
      subtotal: subtotal.toFixed(2),
      tax: tax.toFixed(2),
      total: (subtotal + tax).toFixed(2),
    };
  }

  /**
   * Create a new invoice.
   */
  static async createInvoice(
    userId: string,
    type: Invoice["type"],
    lineItems: LineItem[],
    currency: string,
    dueDate: Date,
  ): Promise<Invoice> {
    const invoiceNumber = await this.generateInvoiceNumber();
    const { subtotal, tax, total } = this.calculateTotals(lineItems);

    const result = await pool.query(
      `INSERT INTO invoices
         (invoice_number, user_id, type, line_items, subtotal, tax, total, currency, status, due_date, pdf_url, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'draft', $9, '', NOW())
       RETURNING *`,
      [
        invoiceNumber,
        userId,
        type,
        JSON.stringify(lineItems),
        subtotal,
        tax,
        total,
        currency,
        dueDate,
      ],
    );

    return this.mapRow(result.rows[0]);
  }

  /**
   * Get invoice by ID.
   */
  static async getInvoice(invoiceId: string): Promise<Invoice | null> {
    const result = await pool.query(`SELECT * FROM invoices WHERE id = $1`, [
      invoiceId,
    ]);
    return result.rows[0] ? this.mapRow(result.rows[0]) : null;
  }

  /**
   * List invoices for a user with optional status filter.
   */
  static async listInvoices(
    userId: string,
    status?: Invoice["status"],
  ): Promise<Invoice[]> {
    const params: any[] = [userId];
    let query = `SELECT * FROM invoices WHERE user_id = $1`;
    if (status) {
      query += ` AND status = $2`;
      params.push(status);
    }
    query += ` ORDER BY created_at DESC`;
    const result = await pool.query(query, params);
    return result.rows.map(this.mapRow);
  }

  /**
   * Update invoice status.
   */
  static async updateStatus(
    invoiceId: string,
    status: Invoice["status"],
  ): Promise<void> {
    await pool.query(
      `UPDATE invoices SET status = $1, updated_at = NOW() WHERE id = $2`,
      [status, invoiceId],
    );
  }

  /**
   * Attach a PDF URL to an invoice after generation.
   */
  static async attachPdf(invoiceId: string, pdfUrl: string): Promise<void> {
    await pool.query(
      `UPDATE invoices SET pdf_url = $1, updated_at = NOW() WHERE id = $2`,
      [pdfUrl, invoiceId],
    );
  }

  /**
   * Generate a PDF for the invoice, upload it to S3, and persist the S3 URL.
   *
   * Returns the S3 object key so the caller can generate presigned URLs later.
   */
  static async generatePdf(invoiceId: string): Promise<string> {
    const invoice = await this.getInvoice(invoiceId);
    if (!invoice) throw new Error(`Invoice not found: ${invoiceId}`);

    const user = await getUserById(invoice.userId);
    if (!user) throw new Error(`User not found for invoice: ${invoiceId}`);

    // Build the created_at date from DB for accurate "issued at" display
    const issuedAtResult = await pool.query(
      "SELECT created_at FROM invoices WHERE id = $1",
      [invoiceId],
    );
    const issuedAt: Date = issuedAtResult.rows[0]?.created_at ?? new Date();

    // Generate the PDF buffer
    const pdfBuffer = await generateInvoicePdf({
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      issuedAt,
      dueDate: invoice.dueDate,
      recipientName: user.fullName,
      recipientEmail: user.email,
      lineItems: invoice.lineItems,
      subtotal: invoice.subtotal,
      tax: invoice.tax,
      total: invoice.total,
      currency: invoice.currency,
      appBaseUrl: env.APP_BASE_URL,
    });

    // Upload to S3
    const s3Key = buildInvoiceS3Key(invoice.userId, invoiceId);
    const uploadResult = await StorageService.uploadFile(
      s3Key,
      pdfBuffer,
      "application/pdf",
      {
        invoiceId,
        invoiceNumber: invoice.invoiceNumber,
        userId: invoice.userId,
      },
    );

    // Persist the S3 URL in the invoices table
    await this.attachPdf(invoiceId, uploadResult.url);

    logger.info("Invoice PDF generated and uploaded", {
      invoiceId,
      invoiceNumber: invoice.invoiceNumber,
      s3Key,
    });

    return s3Key;
  }

  /**
   * Returns a presigned S3 download URL (valid for 1 hour) for the invoice PDF.
   * Generates the PDF first if pdf_url is empty.
   */
  static async getDownloadUrl(invoiceId: string): Promise<string> {
    let invoice = await this.getInvoice(invoiceId);
    if (!invoice) throw new Error(`Invoice not found: ${invoiceId}`);

    let s3Key: string;

    if (!invoice.pdfUrl) {
      // PDF has not been generated yet — generate it now
      s3Key = await this.generatePdf(invoiceId);
    } else {
      s3Key = keyFromS3Url(invoice.pdfUrl);
    }

    return StorageService.generatePresignedUrl(s3Key, 3600);
  }

  /**
   * Generate the PDF, email it to the invoice owner, and update status to "sent".
   * Idempotent: if the PDF already exists it skips regeneration.
   */
  static async sendInvoice(invoiceId: string): Promise<void> {
    const invoice = await this.getInvoice(invoiceId);
    if (!invoice) throw new Error(`Invoice not found: ${invoiceId}`);

    const user = await getUserById(invoice.userId);
    if (!user) throw new Error(`User not found for invoice: ${invoiceId}`);

    // Ensure PDF exists
    let s3Key: string;
    if (!invoice.pdfUrl) {
      s3Key = await this.generatePdf(invoiceId);
    } else {
      s3Key = keyFromS3Url(invoice.pdfUrl);
    }

    // Generate a short-lived presigned URL to embed in the email body and
    // fetch the PDF bytes for the attachment.
    const presignedUrl = await StorageService.generatePresignedUrl(s3Key, 3600);

    // Fetch PDF bytes from S3 for the nodemailer attachment
    const pdfBytes = await fetchPdfBytes(presignedUrl);

    // Build email
    const emailService = new EmailService();
    const formattedTotal = `${parseFloat(invoice.total).toFixed(2)} ${invoice.currency}`;
    const formattedDue = new Date(invoice.dueDate).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });

    const htmlContent = buildInvoiceEmailHtml({
      recipientName: user.fullName,
      invoiceNumber: invoice.invoiceNumber,
      total: formattedTotal,
      dueDate: formattedDue,
      downloadUrl: presignedUrl,
      platformName: "MentorMinds",
    });

    const textContent = buildInvoiceEmailText({
      recipientName: user.fullName,
      invoiceNumber: invoice.invoiceNumber,
      total: formattedTotal,
      dueDate: formattedDue,
      downloadUrl: presignedUrl,
    });

    // EmailService uses nodemailer under the hood for SMTP — pass attachment
    // via the request object extension used by the SMTP provider.
    const emailRequest: any = {
      to: [user.email],
      subject: `Invoice ${invoice.invoiceNumber} from MentorMinds`,
      htmlContent,
      textContent,
      attachments: [
        {
          filename: `${invoice.invoiceNumber}.pdf`,
          content: pdfBytes,
          contentType: "application/pdf",
        },
      ],
    };

    const result = await emailService.sendEmail(emailRequest);
    if (!result.success) {
      logger.error("Failed to send invoice email", {
        invoiceId,
        error: result.error,
      });
      throw new Error(`Email delivery failed: ${result.error}`);
    }

    // Mark invoice as sent
    await this.updateStatus(invoiceId, "sent");

    logger.info("Invoice sent", {
      invoiceId,
      invoiceNumber: invoice.invoiceNumber,
      to: user.email,
    });
  }

  /**
   * Bulk export invoices for a user as an array (for CSV/PDF export).
   */
  static async bulkExport(
    userId: string,
    from: Date,
    to: Date,
  ): Promise<Invoice[]> {
    const result = await pool.query(
      `SELECT * FROM invoices
       WHERE user_id = $1 AND created_at BETWEEN $2 AND $3
       ORDER BY created_at ASC`,
      [userId, from, to],
    );
    return result.rows.map(this.mapRow);
  }

  /**
   * Mark overdue invoices (due_date passed, status still 'sent').
   */
  static async markOverdue(): Promise<number> {
    const result = await pool.query(
      `UPDATE invoices SET status = 'overdue', updated_at = NOW()
       WHERE status = 'sent' AND due_date < NOW()
       RETURNING id`,
    );
    return result.rowCount ?? 0;
  }

  private static mapRow(row: any): Invoice {
    return {
      id: row.id,
      invoiceNumber: row.invoice_number,
      userId: row.user_id,
      type: row.type,
      lineItems:
        typeof row.line_items === "string"
          ? JSON.parse(row.line_items)
          : row.line_items,
      subtotal: row.subtotal,
      tax: row.tax,
      total: row.total,
      currency: row.currency,
      status: row.status,
      dueDate: row.due_date,
      pdfUrl: row.pdf_url,
    };
  }
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Fetches the PDF bytes from a presigned S3 URL.
 * Uses Node's built-in https module to avoid adding dependencies.
 */
async function fetchPdfBytes(url: string): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const protocol = url.startsWith("https") ? require("https") : require("http");
    const chunks: Buffer[] = [];

    const req = protocol.get(url, (res: any) => {
      if (res.statusCode !== 200) {
        reject(new Error(`Failed to fetch PDF: HTTP ${res.statusCode}`));
        return;
      }
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => resolve(Buffer.concat(chunks)));
      res.on("error", reject);
    });

    req.on("error", reject);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Email templates
// ---------------------------------------------------------------------------

interface EmailTemplateVars {
  recipientName: string;
  invoiceNumber: string;
  total: string;
  dueDate: string;
  downloadUrl: string;
  platformName?: string;
}

function buildInvoiceEmailHtml(v: EmailTemplateVars): string {
  const platform = v.platformName ?? "MentorMinds";
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;font-family:Arial,Helvetica,sans-serif;background:#f4f4f4">
  <table width="100%" cellpadding="0" cellspacing="0">
    <tr><td align="center" style="padding:32px 0">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08)">
        <!-- Header -->
        <tr><td style="background:#0066cc;padding:24px 32px">
          <h1 style="margin:0;color:#ffffff;font-size:22px">${platform}</h1>
        </td></tr>
        <!-- Body -->
        <tr><td style="padding:32px">
          <p style="margin:0 0 16px;font-size:16px;color:#333333">Hi ${escapeHtml(v.recipientName)},</p>
          <p style="margin:0 0 16px;font-size:15px;color:#555555">
            Please find attached your invoice <strong>${escapeHtml(v.invoiceNumber)}</strong>.
          </p>
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f6ff;border-radius:6px;margin:24px 0">
            <tr>
              <td style="padding:16px 20px">
                <p style="margin:0 0 8px;font-size:13px;color:#777777">Invoice Number</p>
                <p style="margin:0;font-size:16px;font-weight:bold;color:#222222">${escapeHtml(v.invoiceNumber)}</p>
              </td>
              <td style="padding:16px 20px">
                <p style="margin:0 0 8px;font-size:13px;color:#777777">Amount Due</p>
                <p style="margin:0;font-size:16px;font-weight:bold;color:#0055bb">${escapeHtml(v.total)}</p>
              </td>
              <td style="padding:16px 20px">
                <p style="margin:0 0 8px;font-size:13px;color:#777777">Due Date</p>
                <p style="margin:0;font-size:16px;font-weight:bold;color:#222222">${escapeHtml(v.dueDate)}</p>
              </td>
            </tr>
          </table>
          <p style="margin:0 0 24px;font-size:15px;color:#555555">
            You can also download the PDF directly:
          </p>
          <table cellpadding="0" cellspacing="0"><tr><td>
            <a href="${v.downloadUrl}" style="display:inline-block;background:#0066cc;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:5px;font-size:15px;font-weight:bold">
              Download Invoice PDF
            </a>
          </td></tr></table>
          <p style="margin:24px 0 0;font-size:13px;color:#999999">This link expires in 1 hour.</p>
        </td></tr>
        <!-- Footer -->
        <tr><td style="background:#f8f8f8;padding:16px 32px;text-align:center">
          <p style="margin:0;font-size:12px;color:#aaaaaa">&copy; ${new Date().getFullYear()} ${escapeHtml(platform)}. All rights reserved.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function buildInvoiceEmailText(v: Omit<EmailTemplateVars, "platformName">): string {
  return [
    `Hi ${v.recipientName},`,
    "",
    `Please find attached your invoice ${v.invoiceNumber}.`,
    "",
    `Invoice Number: ${v.invoiceNumber}`,
    `Amount Due:     ${v.total}`,
    `Due Date:       ${v.dueDate}`,
    "",
    `Download your invoice PDF here (link expires in 1 hour):`,
    v.downloadUrl,
    "",
    "Thank you for using MentorMinds.",
  ].join("\n");
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
