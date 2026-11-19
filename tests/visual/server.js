const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const querystring = require("node:querystring");

const port = Number(process.env.VISUAL_PORT || 4173);
const root = path.resolve(__dirname, "fixtures");
const emailRoot = path.resolve(__dirname, "../../src/templates/emails");

const escapeHtml = (value) => String(value)
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#39;");

function page(title, body, className = "") {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title><link rel="stylesheet" href="/styles.css"></head><body class="${className}">${body}</body></html>`;
}

function emailTemplate(name) {
  const file = path.join(emailRoot, `${name}.html`);
  if (!fs.existsSync(file)) return null;
  const values = {
    userName: "Alex Morgan",
    mentorName: "Jordan Lee",
    sessionDate: "Thursday, September 10",
    sessionTime: "14:00 UTC",
    duration: "60 minutes",
    amount: "$85.00",
    platformUrl: "https://app.mentorminds.example",
    supportUrl: "https://support.mentorminds.example"
  };
  let html = fs.readFileSync(file, "utf8");
  for (const [key, value] of Object.entries(values)) html = html.replaceAll(`{{${key}}}`, escapeHtml(value));
  return page(`Email: ${name}`, html, "email-preview");
}

function dashboard() {
  return page("Health dashboard", `<main id="dashboard"><header><p class="eyebrow">MENTORMINDS / OPERATIONS</p><h1>System health</h1><span class="status">All systems operational</span></header><section class="grid"><article><span>API availability</span><strong>99.98%</strong><small>+0.04% this week</small></article><article><span>Request latency</span><strong>184 ms</strong><small>p95 response time</small></article><article><span>Active sessions</span><strong>1,284</strong><small>Across 12 regions</small></article><article><span>Queue depth</span><strong>42</strong><small>Within normal range</small></article></section><section class="chart"><h2>Availability, last 24 hours</h2><div class="bars">${Array.from({ length: 24 }, (_, index) => `<i style="height:${62 + (index % 5) * 6}%"></i>`).join("")}</div></section></main>`);
}

function apiDocs() {
  const spec = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../openapi.json"), "utf8"));
  const routes = Object.entries(spec.paths || {}).slice(0, 12);
  const rows = routes.map(([route, methods]) => `<tr><td><code>${route}</code></td><td>${Object.keys(methods).map((method) => `<b class="method ${method}">${method.toUpperCase()}</b>`).join(" ")}</td><td>${escapeHtml(methods[Object.keys(methods)[0]]?.summary || "API operation")}</td></tr>`).join("");
  return page("API documentation", `<main id="api-docs"><p class="eyebrow">MENTORMINDS API</p><h1>${escapeHtml(spec.info?.title || "API documentation")}</h1><p class="muted">${escapeHtml(spec.info?.description || "Versioned API reference")}</p><div class="doc-meta"><span>Version ${escapeHtml(spec.info?.version || "v1")}</span><span>OpenAPI 3.0</span></div><table><thead><tr><th>Endpoint</th><th>Method</th><th>Summary</th></tr></thead><tbody>${rows}</tbody></table></main>`);
}

const styles = fs.readFileSync(path.join(root, "styles.css"));
const server = http.createServer((request, response) => {
  const pathname = new URL(request.url, `http://${request.headers.host}`).pathname;
  let body;
  let type = "text/html; charset=utf-8";
  if (pathname === "/styles.css") { body = styles; type = "text/css; charset=utf-8"; }
  else if (pathname === "/dashboard") body = dashboard();
  else if (pathname === "/api-docs") body = apiDocs();
  else if (pathname.startsWith("/email/")) body = emailTemplate(pathname.slice(7));
  else body = page("Visual test fixtures", "<h1>Not found</h1>");
  response.writeHead(body ? 200 : 404, { "Content-Type": type });
  response.end(body || "Not found");
});

server.listen(port, "127.0.0.1", () => process.stdout.write(`Visual fixtures listening on http://127.0.0.1:${port}\n`));
process.once("SIGTERM", () => server.close(() => process.exit(0)));