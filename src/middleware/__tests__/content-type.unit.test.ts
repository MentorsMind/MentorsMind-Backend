import { Request, Response, NextFunction } from "express";
import { requireJsonContentType } from "../content-type.middleware";

function mockRes(): Response {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res as Response;
}

function mockReq(method: string, contentType?: string): Request {
  return {
    method,
    headers: contentType ? { "content-type": contentType } : {},
  } as unknown as Request;
}

describe("requireJsonContentType", () => {
  it("returns 415 when a POST request has no Content-Type header", () => {
    const req = mockReq("POST");
    const res = mockRes();
    const next = jest.fn();

    requireJsonContentType(req, res, next);

    expect(res.status).toHaveBeenCalledWith(415);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 415 when Content-Type is not application/json on PUT", () => {
    const req = mockReq("PUT", "text/plain");
    const res = mockRes();
    const next = jest.fn();

    requireJsonContentType(req, res, next);

    expect(res.status).toHaveBeenCalledWith(415);
    expect(next).not.toHaveBeenCalled();
  });

  it("calls next for POST requests with application/json", () => {
    const req = mockReq("POST", "application/json");
    const res = mockRes();
    const next = jest.fn();

    requireJsonContentType(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("calls next for application/json with a charset suffix", () => {
    const req = mockReq("PATCH", "application/json; charset=utf-8");
    const res = mockRes();
    const next = jest.fn();

    requireJsonContentType(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("excludes multipart/form-data file upload requests", () => {
    const req = mockReq("POST", "multipart/form-data; boundary=----abc");
    const res = mockRes();
    const next = jest.fn();

    requireJsonContentType(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("excludes application/csp-report requests", () => {
    const req = mockReq("POST", "application/csp-report");
    const res = mockRes();
    const next = jest.fn();

    requireJsonContentType(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("ignores GET requests regardless of Content-Type", () => {
    const req = mockReq("GET");
    const res = mockRes();
    const next = jest.fn();

    requireJsonContentType(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });
});
