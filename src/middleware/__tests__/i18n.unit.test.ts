jest.mock("../../config/i18n.config", () => ({
  getT: jest.fn().mockReturnValue((key: string) => key),
  detectLanguage: jest.fn().mockReturnValue("en"),
}));

import { Request, Response, NextFunction } from "express";
import { i18nMiddleware } from "../i18n.middleware";

function mockRes(): Response {
  const res: any = {};
  res.setHeader = jest.fn();
  return res as Response;
}

function mockReq(headers: Record<string, string> = {}): Request {
  return { headers, user: undefined } as unknown as Request;
}

describe("i18nMiddleware", () => {
  it("sets the Vary: Accept-Language header on the response", () => {
    const req = mockReq({ "accept-language": "fr" });
    const res = mockRes();
    const next = jest.fn();

    i18nMiddleware(req, res, next);

    expect(res.setHeader).toHaveBeenCalledWith("Vary", "Accept-Language");
    expect(next).toHaveBeenCalled();
  });

  it("still sets Content-Language alongside Vary", () => {
    const req = mockReq();
    const res = mockRes();
    const next = jest.fn();

    i18nMiddleware(req, res, next);

    expect(res.setHeader).toHaveBeenCalledWith("Content-Language", "en");
    expect(res.setHeader).toHaveBeenCalledWith("Vary", "Accept-Language");
  });

  it("sets Vary even when no Accept-Language header is present", () => {
    const req = mockReq();
    const res = mockRes();
    const next = jest.fn();

    i18nMiddleware(req, res, next);

    expect(res.setHeader).toHaveBeenCalledWith("Vary", "Accept-Language");
  });
});
