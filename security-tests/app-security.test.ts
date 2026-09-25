import request from "supertest";
import { createSecurityTestApp } from "./app";

const app = createSecurityTestApp();

describe("OWASP baseline controls", () => {
  it("sets security headers and does not disclose the framework", async () => {
    const response = await request(app).get("/health");

    expect(response.status).toBe(200);
    expect(response.headers["content-security-policy"]).toBeDefined();
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["x-frame-options"]).toBe("DENY");
    expect(response.headers["x-powered-by"]).toBeUndefined();
  });

  it("removes executable markup from reflected request data", async () => {
    const response = await request(app)
      .post("/echo")
      .send({ displayName: '<script>alert("xss")</script>' });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe("MALICIOUS_INPUT_DETECTED");
  });

  it("rejects requests containing multiple injection classes", async () => {
    const response = await request(app)
      .post("/echo")
      .send({ payload: "<script>alert(1)</script> UNION SELECT password FROM users" });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe("MALICIOUS_INPUT_DETECTED");
  });

  it("limits oversized query parameters", async () => {
    const response = await request(app)
      .get("/health")
      .query({ search: "a".repeat(501) });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe("QUERY_PARAM_TOO_LARGE");
  });
});
