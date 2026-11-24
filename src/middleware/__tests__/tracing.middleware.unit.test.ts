import { Request, Response } from "express";
import { tracingMiddleware } from "../tracing.middleware";

describe("tracingMiddleware response headers", () => {
  const makeResponse = () => {
    const response: Partial<Response> = {
      locals: {},
      setHeader: jest.fn(),
      on: jest.fn(),
    };
    return response as Response;
  };

  it("generates non-empty request and trace IDs when inbound headers are absent", () => {
    const request = { headers: {} } as Request;
    const response = makeResponse();

    tracingMiddleware(request, response, jest.fn());

    expect(response.setHeader).toHaveBeenCalledWith(
      "X-Request-ID",
      expect.stringMatching(/\S+/),
    );
    expect(response.setHeader).toHaveBeenCalledWith(
      "X-Trace-ID",
      expect.stringMatching(/\S+/),
    );
  });

  it("preserves inbound request and trace IDs", () => {
    const request = {
      headers: {
        "x-request-id": "upstream-request",
        "x-trace-id": "upstream-trace",
      },
    } as Request;
    const response = makeResponse();

    tracingMiddleware(request, response, jest.fn());

    expect(response.setHeader).toHaveBeenCalledWith("X-Request-ID", "upstream-request");
    expect(response.setHeader).toHaveBeenCalledWith("X-Trace-ID", "upstream-trace");
  });
});
