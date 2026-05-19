import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = process.cwd();
loadEnv(resolve(ROOT, ".env"));
loadEnv(resolve(ROOT, ".env.local"));

const host = process.env.ARQUIVOS_AGENT_HOST || "127.0.0.1";
const port = Number(process.env.ARQUIVOS_AGENT_PORT || 8787);
const allowedOrigins = new Set(
  [
    "https://hub-depto-tributario-ht.netlify.app",
    "https://hub-depto-tributario-hteix.netlify.app",
    "http://127.0.0.1:5173",
    "http://localhost:5173",
    ...(process.env.ARQUIVOS_AGENT_ALLOWED_ORIGINS || "")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean)
  ].filter(Boolean)
);

let running = false;
let lastRun = null;

const server = createServer(async (request, response) => {
  applyCors(request, response);

  if (request.method === "OPTIONS") {
    response.writeHead(204);
    response.end();
    return;
  }

  const url = new URL(request.url || "/", `http://${host}:${port}`);

  if (request.method === "GET" && url.pathname === "/health") {
    sendJson(response, 200, {
      ok: true,
      running,
      lastRun,
      cwd: ROOT,
      timestamp: new Date().toISOString()
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/process") {
    if (running) {
      sendJson(response, 409, {
        ok: false,
        error: "OCR ja esta em execucao neste computador."
      });
      return;
    }

    try {
      const body = await readJsonBody(request);
      const limit = normalizeLimit(body.limit);
      const result = await runProcessor(limit);
      lastRun = {
        at: new Date().toISOString(),
        code: result.code,
        ok: result.code === 0
      };

      sendJson(response, result.code === 0 ? 200 : 500, {
        ok: result.code === 0,
        code: result.code,
        stdout: result.stdout,
        stderr: result.stderr,
        error: result.code === 0 ? "" : summarizeOutput(result.stderr || result.stdout)
      });
    } catch (error) {
      lastRun = {
        at: new Date().toISOString(),
        code: 1,
        ok: false
      };
      sendJson(response, 500, {
        ok: false,
        error: getErrorMessage(error)
      });
    }
    return;
  }

  sendJson(response, 404, {
    ok: false,
    error: "Endpoint nao encontrado."
  });
});

server.listen(port, host, () => {
  console.log(`Agente OCR local em http://${host}:${port}`);
  console.log("Deixe esta janela aberta enquanto usar o botao Rodar OCR no HUB.");
});

function runProcessor(limit) {
  running = true;

  return new Promise((resolvePromise) => {
    const child = spawn(process.execPath, ["scripts/process-arquivos.mjs", "--limit", String(limit)], {
      cwd: ROOT,
      env: process.env,
      shell: false,
      windowsHide: true
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      running = false;
      resolvePromise({
        code: 1,
        stdout,
        stderr: `${stderr}\n${getErrorMessage(error)}`.trim()
      });
    });
    child.on("close", (code) => {
      running = false;
      resolvePromise({
        code: code ?? 1,
        stdout,
        stderr
      });
    });
  });
}

function normalizeLimit(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return 5;
  return Math.min(Math.floor(parsed), 25);
}

function applyCors(request, response) {
  const origin = request.headers.origin || "";
  const allowedOrigin = allowedOrigins.has(origin) ? origin : "http://127.0.0.1:5173";
  response.setHeader("Access-Control-Allow-Origin", allowedOrigin);
  response.setHeader("Vary", "Origin");
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "content-type");
  response.setHeader("Access-Control-Allow-Private-Network", "true");
}

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(payload));
}

function readJsonBody(request) {
  return new Promise((resolvePromise, rejectPromise) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk.toString();
      if (body.length > 4096) {
        rejectPromise(new Error("Payload muito grande."));
        request.destroy();
      }
    });
    request.on("end", () => {
      if (!body.trim()) {
        resolvePromise({});
        return;
      }
      try {
        resolvePromise(JSON.parse(body));
      } catch {
        rejectPromise(new Error("JSON invalido."));
      }
    });
    request.on("error", rejectPromise);
  });
}

function summarizeOutput(value) {
  return String(value || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-4)
    .join(" ");
}

function loadEnv(path) {
  if (!existsSync(path)) return;

  const content = readFileSync(path, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const index = trimmed.indexOf("=");
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    value = value.replace(/^['"]|['"]$/g, "");
    if (!(key in process.env)) process.env[key] = value;
  }
}

function getErrorMessage(error) {
  if (error instanceof Error) return error.message;
  return String(error || "Erro desconhecido.");
}
