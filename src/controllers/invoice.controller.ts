import { Request, Response } from "express";
import { InvoiceService } from "../services/invoice.service";
import { logger } from "../utils/logger";

export class InvoiceController {
  static async createInvoice(req: Request, res: Response): Promise<void> {
    const userId = (req as any).user?.id;
    const { type, lineItems, currency, dueDate } = req.body;
    const invoice = await InvoiceService.createInvoice(
      userId,
      type,
      lineItems,
      currency ?? "USD",
      new Date(dueDate),
    );
    res.status(201).json({ success: true, data: invoice });
  }

  static async getInvoice(req: Request, res: Response): Promise<void> {
    const invoice = await InvoiceService.getInvoice(
      req.params.invoiceId as string,
    );
    if (!invoice) {
      res.status(404).json({ success: false, message: "Invoice not found" });
      return;
    }
    res.json({ success: true, data: invoice });
  }

  static async listInvoices(req: Request, res: Response): Promise<void> {
    const userId = (req as any).user?.id;
    const status = req.query.status as any;
    const invoices = await InvoiceService.listInvoices(userId, status);
    res.json({ success: true, data: invoices });
  }

  static async updateStatus(req: Request, res: Response): Promise<void> {
    await InvoiceService.updateStatus(
      req.params.invoiceId as string,
      req.body.status,
    );
    res.json({ success: true, message: "Invoice status updated" });
  }

  static async bulkExport(req: Request, res: Response): Promise<void> {
    const userId = (req as any).user?.id;
    const fromParam = req.query.from;
    const toParam = req.query.to;
    const from = Array.isArray(fromParam) ? fromParam[0] : fromParam;
    const to = Array.isArray(toParam) ? toParam[0] : toParam;
    const invoices = await InvoiceService.bulkExport(
      userId,
      new Date(from as string),
      new Date(to as string),
    );
    res.json({ success: true, data: invoices });
  }

  /**
   * GET /invoices/:invoiceId/download
   *
   * Returns a presigned S3 URL (valid for 1 hour) for the invoice PDF.
   * Triggers PDF generation on-demand if the invoice has no PDF yet.
   */
  static async downloadInvoice(req: Request, res: Response): Promise<void> {
    const { invoiceId } = req.params;
    const requestingUserId = (req as any).user?.id;

    try {
      const invoice = await InvoiceService.getInvoice(invoiceId);
      if (!invoice) {
        res.status(404).json({ success: false, message: "Invoice not found" });
        return;
      }

      // Users may only download their own invoices (admins bypass this)
      const userRole = (req as any).user?.role;
      if (invoice.userId !== requestingUserId && userRole !== "admin") {
        res.status(403).json({ success: false, message: "Access denied" });
        return;
      }

      const downloadUrl = await InvoiceService.getDownloadUrl(invoiceId);
      const downloadUrlStr = Array.isArray(downloadUrl) ? downloadUrl[0] : downloadUrl;

      res.json({
        success: true,
        data: {
          downloadUrl: downloadUrlStr,
          expiresInSeconds: 3600,
          invoiceNumber: invoice.invoiceNumber,
        },
      });
    } catch (err) {
      logger.error("Failed to generate invoice download URL", {
        invoiceId,
        error: err,
      });
      res.status(500).json({
        success: false,
        message: "Failed to generate download URL. Please try again later.",
      });
    }
  }

  /**
   * POST /invoices/:invoiceId/send
   *
   * Generates the PDF (if not already done), emails it to the invoice owner,
   * and updates the invoice status to "sent".
   */
  static async sendInvoice(req: Request, res: Response): Promise<void> {
    const { invoiceId } = req.params;
    const requestingUserId = (req as any).user?.id;

    try {
      const invoice = await InvoiceService.getInvoice(invoiceId);
      if (!invoice) {
        res.status(404).json({ success: false, message: "Invoice not found" });
        return;
      }

      // Only the invoice owner or an admin may trigger a send
      const userRole = (req as any).user?.role;
      if (invoice.userId !== requestingUserId && userRole !== "admin") {
        res.status(403).json({ success: false, message: "Access denied" });
        return;
      }

      await InvoiceService.sendInvoice(invoiceId);

      res.json({
        success: true,
        message: "Invoice sent successfully",
        data: { invoiceId, status: "sent" },
      });
    } catch (err) {
      logger.error("Failed to send invoice", { invoiceId, error: err });
      res.status(500).json({
        success: false,
        message: "Failed to send invoice. Please try again later.",
      });
    }
  }
}
