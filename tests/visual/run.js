const { spawn } = require("node:child_process");
const http = require("node:http");
const path = require("node:path");

const command = process.argv[2] || "test";
const port = Number(process.env.VISUAL_PORT || 4173);
const server = spawn(process.execPath, [path.join(__dirname, "server.js")], {
  stdio: "inherit",
  env: { ...process.env, VISUAL_PORT: String(port) },
});

function isReady() {
  return new Promise((resolve) => {
    const request = http.get(`http://127.0.0.1:${port}/dashboard`, (response) => {
      response.resume();
      resolve(response.statusCode === 200);
    });
    request.on("error", () => resolve(false));
  });
}

async function waitForServer() {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (await isReady()) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Visual fixture server did not become ready");
}

async function main() {
  try {
    await waitForServer();
    const backstop = spawn(process.platform === "win32" ? "backstop.cmd" : "backstop", [command, "--config=backstop.json"], {
      stdio: "inherit",
      shell: false,
    });
    backstop.on("exit", (code, signal) => {
      server.kill();
      process.exitCode = code ?? (signal ? 1 : 0);
    });
  } catch (error) {
    server.kill();
    throw error;
  }
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});