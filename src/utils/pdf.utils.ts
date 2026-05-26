/**
 * PDF Utility - Generate earnings reports in PDF format
 */

import PDFDocument from 'pdfkit';
import { Readable } from 'stream';

export interface EarningsReportData {
  mentorName: string;
  mentorEmail: string;
  period: string;
  startDate: string;
  endDate: string;
  grossEarnings: number;
  platformFee: number;
  netEarnings: number;
  pendingEscrow: number;
  byAsset: Array<{
    assetCode: string;
    assetType: string;
    amount: number;
    sessions: number;
  }>;
  sessions: Array<{
    date: string;
    title: string;
    duration: number;
    amount: number;
    assetCode: string;
    status: string;
  }>;
  platformName?: string;
  platformBrandColor?: string;
}

export class PDFUtils {
  /**
   * Generate an earnings report PDF
   */
  static generateEarningsReport(data: EarningsReportData): Readable {
    const doc = new PDFDocument({
      margin: 50,
      size: 'A4',
    });

    // Platform branding
    const platformName = data.platformName || 'MentorMinds';
    const brandColor = data.platformBrandColor || '#0066cc';

    // Header with platform branding
    this.addHeader(doc, platformName, brandColor);

    // Title
    doc.fontSize(24).font('Helvetica-Bold').text('Earnings Report', { align: 'center' });
    doc.moveDown(0.5);

    // Report metadata
    this.addReportMetadata(doc, data);
    doc.moveDown(1);

    // Summary section
    this.addSummarySectionn(doc, data);
    doc.moveDown(1);

    // Asset breakdown section
    this.addAssetBreakdown(doc, data);
    doc.moveDown(1);

    // Sessions table
    this.addSessionsTable(doc, data);
    doc.moveDown(1);

    // Footer
    this.addFooter(doc, platformName);

    doc.end();
    return doc;
  }

  /**
   * Add header with platform branding
   */
  private static addHeader(doc: PDFDocument, platformName: string, brandColor: string): void {
    // Platform name
    doc
      .fontSize(16)
      .font('Helvetica-Bold')
      .fillColor(brandColor)
      .text(platformName, 50, 40);

    // Horizontal line
    doc
      .strokeColor('#cccccc')
      .lineWidth(1)
      .moveTo(50, 65)
      .lineTo(550, 65)
      .stroke();

    doc.moveDown(1);
  }

  /**
   * Add report metadata section
   */
  private static addReportMetadata(doc: PDFDocument, data: EarningsReportData): void {
    doc.fontSize(10).fillColor('#333333');

    // Mentor information
    doc.font('Helvetica-Bold').text('Mentor Information', { underline: true });
    doc.font('Helvetica').text(`Name: ${data.mentorName}`);
    doc.text(`Email: ${data.mentorEmail}`);
    doc.moveDown(0.5);

    // Period information
    doc.font('Helvetica-Bold').text('Reporting Period', { underline: true });
    doc.font('Helvetica').text(`${data.period}`);
    doc.text(`From: ${data.startDate} to ${data.endDate}`);
    doc.text(`Generated: ${new Date().toLocaleDateString()}`);
  }

  /**
   * Add earnings summary section
   */
  private static addSummarySectionn(doc: PDFDocument, data: EarningsReportData): void {
    doc.fontSize(12).font('Helvetica-Bold').text('Earnings Summary', { underline: true });
    doc.moveDown(0.3);

    // Create a summary box
    const boxX = 50;
    const boxY = doc.y;
    const boxWidth = 500;
    const boxHeight = 120;

    doc
      .strokeColor('#e0e0e0')
      .lineWidth(1)
      .rect(boxX, boxY, boxWidth, boxHeight)
      .stroke();

    // Summary items
    const summaryX = boxX + 15;
    let currentY = boxY + 15;
    doc.fontSize(10);

    // Gross Earnings
    doc.font('Helvetica').fillColor('#666666').text('Gross Earnings:', summaryX, currentY);
    doc
      .font('Helvetica-Bold')
      .fillColor('#333333')
      .text(`${this.formatCurrency(data.grossEarnings)}`, summaryX + 120, currentY);
    currentY += 25;

    // Platform Fee
    doc.font('Helvetica').fillColor('#666666').text('Platform Fee:', summaryX, currentY);
    doc
      .font('Helvetica-Bold')
      .fillColor('#d32f2f')
      .text(`-${this.formatCurrency(data.platformFee)}`, summaryX + 120, currentY);
    currentY += 25;

    // Net Earnings
    doc.moveTo(summaryX, currentY - 5).lineTo(summaryX + 300, currentY - 5).stroke();
    doc.font('Helvetica-Bold').fillColor('#1976d2').text('Net Earnings:', summaryX, currentY);
    doc
      .font('Helvetica-Bold')
      .fontSize(12)
      .fillColor('#1976d2')
      .text(`${this.formatCurrency(data.netEarnings)}`, summaryX + 120, currentY);
    currentY += 25;

    // Pending Escrow
    doc.fontSize(10).font('Helvetica').fillColor('#666666').text('Pending in Escrow:', summaryX, currentY);
    doc
      .font('Helvetica-Bold')
      .fillColor('#f57c00')
      .text(`${this.formatCurrency(data.pendingEscrow)}`, summaryX + 120, currentY);

    doc.y = boxY + boxHeight + 10;
  }

  /**
   * Add asset breakdown section
   */
  private static addAssetBreakdown(doc: PDFDocument, data: EarningsReportData): void {
    if (!data.byAsset || data.byAsset.length === 0) {
      return;
    }

    doc.fontSize(12).font('Helvetica-Bold').text('Breakdown by Asset Type', { underline: true });
    doc.moveDown(0.5);

    // Table header
    const tableX = 50;
    let tableY = doc.y;
    const colWidths = { asset: 80, type: 150, amount: 100, sessions: 80 };
    const rowHeight = 20;

    // Header background
    doc.rect(tableX, tableY, 500, rowHeight).fill('#f5f5f5').stroke();
    doc.fillColor('#000000').font('Helvetica-Bold').fontSize(10);

    doc.text('Asset Code', tableX + 5, tableY + 5);
    doc.text('Type', tableX + colWidths.asset + 5, tableY + 5);
    doc.text('Amount', tableX + colWidths.asset + colWidths.type + 5, tableY + 5);
    doc.text('Sessions', tableX + colWidths.asset + colWidths.type + colWidths.amount + 5, tableY + 5);

    tableY += rowHeight;

    // Table rows
    doc.font('Helvetica').fontSize(9).fillColor('#333333');
    data.byAsset.forEach((asset, index) => {
      const alternateRow = index % 2 === 0;
      if (alternateRow) {
        doc.rect(tableX, tableY, 500, rowHeight).fill('#fafafa');
      }

      doc.text(asset.assetCode, tableX + 5, tableY + 5);
      doc.text(asset.assetType, tableX + colWidths.asset + 5, tableY + 5);
      doc.text(this.formatCurrency(asset.amount), tableX + colWidths.asset + colWidths.type + 5, tableY + 5);
      doc.text(asset.sessions.toString(), tableX + colWidths.asset + colWidths.type + colWidths.amount + 5, tableY + 5);

      tableY += rowHeight;
    });

    doc.y = tableY;
    doc.moveDown(0.5);
  }

  /**
   * Add sessions table
   */
  private static addSessionsTable(doc: PDFDocument, data: EarningsReportData): void {
    if (!data.sessions || data.sessions.length === 0) {
      return;
    }

    doc.fontSize(12).font('Helvetica-Bold').text('Session Details', { underline: true });
    doc.moveDown(0.5);

    // Determine if we need to add a new page for the table
    if (doc.y > 700) {
      doc.addPage();
    }

    // Table header
    const tableX = 50;
    let tableY = doc.y;
    const colWidths = { date: 80, title: 140, duration: 80, amount: 80, asset: 50 };
    const rowHeight = 18;

    // Header background
    doc.rect(tableX, tableY, 490, rowHeight).fill('#f5f5f5').stroke();
    doc.fillColor('#000000').font('Helvetica-Bold').fontSize(9);

    doc.text('Date', tableX + 5, tableY + 5);
    doc.text('Session', tableX + colWidths.date + 5, tableY + 5);
    doc.text('Duration', tableX + colWidths.date + colWidths.title + 5, tableY + 5);
    doc.text('Amount', tableX + colWidths.date + colWidths.title + colWidths.duration + 5, tableY + 5);
    doc.text('Asset', tableX + colWidths.date + colWidths.title + colWidths.duration + colWidths.amount + 5, tableY + 5);

    tableY += rowHeight;

    // Table rows (limit to 20 for readability)
    doc.font('Helvetica').fontSize(8).fillColor('#333333');
    const displaySessions = data.sessions.slice(0, 20);
    
    displaySessions.forEach((session, index) => {
      // Check if we need a new page
      if (tableY > 750) {
        doc.addPage();
        tableY = 50;
      }

      const alternateRow = index % 2 === 0;
      if (alternateRow) {
        doc.rect(tableX, tableY, 490, rowHeight).fill('#fafafa');
      }

      doc.text(session.date, tableX + 5, tableY + 5);
      doc.text(session.title.substring(0, 20), tableX + colWidths.date + 5, tableY + 5);
      doc.text(`${session.duration}m`, tableX + colWidths.date + colWidths.title + 5, tableY + 5);
      doc.text(this.formatCurrency(session.amount), tableX + colWidths.date + colWidths.title + colWidths.duration + 5, tableY + 5);
      doc.text(session.assetCode, tableX + colWidths.date + colWidths.title + colWidths.duration + colWidths.amount + 5, tableY + 5);

      tableY += rowHeight;
    });

    if (data.sessions.length > 20) {
      doc.fontSize(9).fillColor('#666666').text(`... and ${data.sessions.length - 20} more sessions`, tableX, tableY + 10);
    }

    doc.y = tableY;
  }

  /**
   * Add footer with platform information
   */
  private static addFooter(doc: PDFDocument, platformName: string): void {
    const pageHeight = doc.page.height;
    const footerY = pageHeight - 40;

    doc
      .fontSize(8)
      .fillColor('#999999')
      .moveTo(50, footerY)
      .lineTo(550, footerY)
      .stroke()
      .text(`© ${new Date().getFullYear()} ${platformName}. All rights reserved.`, 50, footerY + 10, {
        align: 'center',
      })
      .text(`Page 1`, 50, footerY + 25, { align: 'center' });
  }

  /**
   * Format number as currency
   */
  private static formatCurrency(amount: number, currency: string = 'XLM'): string {
    const formatted = amount.toFixed(2);
    return `${formatted} ${currency}`;
  }

  /**
   * Generate CSV content for earnings report
   */
  static generateEarningsCSV(data: EarningsReportData): string {
    const lines: string[] = [];

    // Header
    lines.push('Mentor Earnings Report');
    lines.push(`Mentor Name,${this.escapeCsvValue(data.mentorName)}`);
    lines.push(`Mentor Email,${this.escapeCsvValue(data.mentorEmail)}`);
    lines.push(`Period,${this.escapeCsvValue(data.period)}`);
    lines.push(`Start Date,${data.startDate}`);
    lines.push(`End Date,${data.endDate}`);
    lines.push(`Generated,${new Date().toISOString()}`);
    lines.push('');

    // Summary
    lines.push('EARNINGS SUMMARY');
    lines.push(`Gross Earnings,${data.grossEarnings.toFixed(2)}`);
    lines.push(`Platform Fee,${data.platformFee.toFixed(2)}`);
    lines.push(`Net Earnings,${data.netEarnings.toFixed(2)}`);
    lines.push(`Pending Escrow,${data.pendingEscrow.toFixed(2)}`);
    lines.push('');

    // Asset breakdown
    if (data.byAsset && data.byAsset.length > 0) {
      lines.push('ASSET BREAKDOWN');
      lines.push('Asset Code,Asset Type,Amount,Sessions');
      data.byAsset.forEach((asset) => {
        lines.push(
          `${this.escapeCsvValue(asset.assetCode)},${this.escapeCsvValue(asset.assetType)},${asset.amount.toFixed(
            2,
          )},${asset.sessions}`,
        );
      });
      lines.push('');
    }

    // Sessions
    if (data.sessions && data.sessions.length > 0) {
      lines.push('SESSION DETAILS');
      lines.push('Date,Session Title,Duration (min),Amount,Asset Code,Status');
      data.sessions.forEach((session) => {
        lines.push(
          `${session.date},${this.escapeCsvValue(session.title)},${session.duration},${session.amount.toFixed(
            2,
          )},${this.escapeCsvValue(session.assetCode)},${this.escapeCsvValue(session.status)}`,
        );
      });
    }

    return lines.join('\n');
  }

  /**
   * Escape CSV values
   */
  private static escapeCsvValue(value: string | number): string {
    const stringValue = String(value);
    if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
      return `"${stringValue.replace(/"/g, '""')}"`;
    }
    return stringValue;
  }
}
