const mockGenerateExport = jest.fn();

jest.mock("../../services/tax-reporting.service", () => ({
  TaxReportingService: {
    generateExport: (...args: unknown[]) => mockGenerateExport(...args),
  },
}));

import { Request, Response } from "express";
import { TaxReportingController } from "../tax-reporting.controller";

const MENTOR_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

function mockRes(): Response {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  res.setHeader = jest.fn().mockReturnValue(res);
  res.send = jest.fn().mockReturnValue(res);
  return res as Response;
}

describe("TaxReportingController.exportReport", () => {
  it("sets Content-Type, Content-Disposition and X-Content-Type-Options on the download response", async () => {
    const taxYear = new Date().getFullYear();
    const fileName = `1099K-${taxYear}-${MENTOR_ID}.csv`;
    mockGenerateExport.mockResolvedValueOnce({
      format: "1099-K",
      fileName,
      data: "tax_year,net_earnings\n2026,100.00",
      mimeType: "text/csv",
    });
    const req = {
      user: { id: MENTOR_ID, userId: MENTOR_ID, role: "mentor" },
      params: { year: String(taxYear) },
    } as unknown as Request;
    const res = mockRes();

    TaxReportingController.exportReport(req, res, jest.fn());
    await new Promise((r) => setImmediate(r));

    expect(mockGenerateExport).toHaveBeenCalledWith(MENTOR_ID, taxYear);
    expect(res.setHeader).toHaveBeenCalledWith("Content-Type", "text/csv");
    expect(res.setHeader).toHaveBeenCalledWith(
      "Content-Disposition",
      expect.stringContaining(`attachment; filename="${fileName}"`),
    );
    expect(res.setHeader).toHaveBeenCalledWith("X-Content-Type-Options", "nosniff");
    expect(res.send).toHaveBeenCalledWith("tax_year,net_earnings\n2026,100.00");
  });
});
