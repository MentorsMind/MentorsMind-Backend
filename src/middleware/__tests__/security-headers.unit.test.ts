import request from "supertest";
import express, { Application } from "express";
import { securityMiddleware } from "../security.middleware";

describe("Security Headers Unit Tests", () => {
  let app: Application;

  beforeEach(() => {
    app = express();

    // Disable X-Powered-By header before adding security middleware
    app.disable("x-powered-by");

    // Apply security middleware
    app.use(securityMiddleware);

    // Simple test route
    app.get("/test", (req, res) => {
      res.json({ status: "ok" });
    });

    app.get("/api/health", (req, res) => {
      res.json({ health: "good" });
    });
  });

  describe("X-Powered-By header", () => {
    it("should not include X-Powered-By header in response", async () => {
      const res = await request(app).get("/test");

      expect(res.status).toBe(200);
      expect(res.header["x-powered-by"]).toBeUndefined();
    });

    it("should not include X-Powered-By on multiple requests", async () => {
      const res1 = await request(app).get("/test");
      const res2 = await request(app).get("/api/health");

      expect(res1.header["x-powered-by"]).toBeUndefined();
      expect(res2.header["x-powered-by"]).toBeUndefined();
    });

    it("should not include X-Powered-By on error responses", async () => {
      const res = await request(app).get("/non-existent");

      // Will return 404 or similar
      expect(res.header["x-powered-by"]).toBeUndefined();
    });
  });

  describe("Helmet security headers", () => {
    it("should include Content-Security-Policy header", async () => {
      const res = await request(app).get("/test");

      expect(res.header["content-security-policy"]).toBeDefined();
      expect(res.header["content-security-policy"]).toContain("default-src");
    });

    it("should include Strict-Transport-Security header", async () => {
      const res = await request(app).get("/test");

      expect(res.header["strict-transport-security"]).toBeDefined();
      // HSTS should have max-age set to 1 year (31536000 seconds)
      expect(res.header["strict-transport-security"]).toContain("31536000");
      expect(res.header["strict-transport-security"]).toContain("includeSubDomains");
    });

    it("should include X-Frame-Options deny", async () => {
      const res = await request(app).get("/test");

      expect(res.header["x-frame-options"]).toBe("DENY");
    });

    it("should include X-Content-Type-Options nosniff", async () => {
      const res = await request(app).get("/test");

      expect(res.header["x-content-type-options"]).toBe("nosniff");
    });

    it("should include X-XSS-Protection header", async () => {
      const res = await request(app).get("/test");

      expect(res.header["x-xss-protection"]).toBeDefined();
      // Should block or mode=block
      expect(res.header["x-xss-protection"]).toMatch(/block|1/);
    });

    it("should include Referrer-Policy header", async () => {
      const res = await request(app).get("/test");

      expect(res.header["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    });

    it("should include Permissions-Policy header", async () => {
      const res = await request(app).get("/test");

      // Helmet sets Permissions-Policy (formerly Feature-Policy)
      expect(
        res.header["permissions-policy"] || res.header["feature-policy"]
      ).toBeDefined();
    });
  });

  describe("Server header", () => {
    it("should not expose Express in Server header", async () => {
      const res = await request(app).get("/test");

      const serverHeader = res.header["server"];

      // Should either be undefined or not contain "Express"
      if (serverHeader) {
        expect(serverHeader).not.toContain("Express");
      }
    });
  });

  describe("CSP directives", () => {
    it("should have restrictive default-src", async () => {
      const res = await request(app).get("/test");

      const csp = res.header["content-security-policy"];
      expect(csp).toContain("default-src 'self'");
    });

    it("should block framing", async () => {
      const res = await request(app).get("/test");

      const csp = res.header["content-security-policy"];
      expect(csp).toContain("frame-src 'none'");
    });

    it("should block object embeds", async () => {
      const res = await request(app).get("/test");

      const csp = res.header["content-security-policy"];
      expect(csp).toContain("object-src 'none'");
    });

    it("should allow required external domains in CSP", async () => {
      const res = await request(app).get("/test");

      const csp = res.header["content-security-policy"];

      // Should allow Stellar API
      expect(csp).toContain("api.stellar.org");

      // Should allow WebSockets
      expect(csp).toContain("wss://");
    });
  });

  describe("HSTS configuration", () => {
    it("should set HSTS with preload flag", async () => {
      const res = await request(app).get("/test");

      const hsts = res.header["strict-transport-security"];
      expect(hsts).toContain("preload");
    });

    it("should set HSTS with subdomain inclusion", async () => {
      const res = await request(app).get("/test");

      const hsts = res.header["strict-transport-security"];
      expect(hsts).toContain("includeSubDomains");
    });
  });

  describe("Response headers on different status codes", () => {
    let testApp: Application;

    beforeEach(() => {
      testApp = express();
      testApp.disable("x-powered-by");
      testApp.use(securityMiddleware);

      testApp.get("/ok", (req, res) => {
        res.status(200).json({ status: "ok" });
      });

      testApp.get("/created", (req, res) => {
        res.status(201).json({ created: true });
      });

      testApp.get("/bad-request", (req, res) => {
        res.status(400).json({ error: "bad request" });
      });

      testApp.get("/unauthorized", (req, res) => {
        res.status(401).json({ error: "unauthorized" });
      });

      testApp.get("/forbidden", (req, res) => {
        res.status(403).json({ error: "forbidden" });
      });

      testApp.get("/not-found", (req, res) => {
        res.status(404).json({ error: "not found" });
      });

      testApp.get("/server-error", (req, res) => {
        res.status(500).json({ error: "server error" });
      });
    });

    it("should not expose X-Powered-By on 2xx responses", async () => {
      const res200 = await request(testApp).get("/ok");
      const res201 = await request(testApp).get("/created");

      expect(res200.header["x-powered-by"]).toBeUndefined();
      expect(res201.header["x-powered-by"]).toBeUndefined();
    });

    it("should not expose X-Powered-By on 4xx responses", async () => {
      const res400 = await request(testApp).get("/bad-request");
      const res401 = await request(testApp).get("/unauthorized");
      const res403 = await request(testApp).get("/forbidden");
      const res404 = await request(testApp).get("/not-found");

      expect(res400.header["x-powered-by"]).toBeUndefined();
      expect(res401.header["x-powered-by"]).toBeUndefined();
      expect(res403.header["x-powered-by"]).toBeUndefined();
      expect(res404.header["x-powered-by"]).toBeUndefined();
    });

    it("should not expose X-Powered-By on 5xx responses", async () => {
      const res500 = await request(testApp).get("/server-error");

      expect(res500.header["x-powered-by"]).toBeUndefined();
    });

    it("should include security headers on all responses", async () => {
      const res400 = await request(testApp).get("/bad-request");
      const res500 = await request(testApp).get("/server-error");

      // All should have security headers even on errors
      expect(res400.header["content-security-policy"]).toBeDefined();
      expect(res400.header["x-frame-options"]).toBeDefined();

      expect(res500.header["content-security-policy"]).toBeDefined();
      expect(res500.header["x-frame-options"]).toBeDefined();
    });
  });

  describe("Content-Security-Policy variations", () => {
    it("should allow inline styles for Swagger UI", async () => {
      const res = await request(app).get("/test");

      const csp = res.header["content-security-policy"];
      // Should allow unsafe-inline for styles (for Swagger UI)
      expect(csp).toContain("style-src");
      expect(csp).toContain("unsafe-inline");
    });

    it("should allow Google Fonts in CSP", async () => {
      const res = await request(app).get("/test");

      const csp = res.header["content-security-policy"];
      expect(csp).toContain("fonts.googleapis.com");
      expect(csp).toContain("fonts.gstatic.com");
    });

    it("should restrict script execution", async () => {
      const res = await request(app).get("/test");

      const csp = res.header["content-security-policy"];
      // Should use strict-dynamic for scripts
      expect(csp).toContain("script-src");
      expect(csp).toContain("strict-dynamic");
    });
  });
});
