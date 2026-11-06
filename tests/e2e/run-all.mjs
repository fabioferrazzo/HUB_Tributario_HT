// Executa todos os testes em navegador contra o HUB em modo demonstração (dados locais, sem Supabase).
// Uso: npm run test:e2e            -> todos
//      npm run test:e2e -- funcional quadro-avisos   -> só os indicados
import { spawn, spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const port = Number(process.env.HUB_TEST_PORT || 5199);
const base = `http://127.0.0.1:${port}`;
const isWin = process.platform === "win32";

// Testes de verificação (falham com "FALHA") e relatórios (só informam).
const reports = new Set(["contraste"]);
const wanted = process.argv.slice(2);
const all = readdirSync(here).filter((f) => f.endsWith(".cjs") && !f.startsWith("_")).map((f) => f.replace(/\.cjs$/, ""));
const tests = wanted.length ? all.filter((t) => wanted.includes(t)) : all;

async function isUp() {
  try { return (await fetch(base, { signal: AbortSignal.timeout(1500) })).ok; } catch { return false; }
}

if (await isUp()) {
  console.error(`A porta ${port} já está em uso. Feche o servidor anterior ou use HUB_TEST_PORT.`);
  process.exit(1);
}

// Servidor de testes em modo demonstração: Supabase propositalmente vazio.
const server = spawn(isWin ? "npm.cmd" : "npm", ["run", "dev", "--", "--port", String(port), "--strictPort"], {
  cwd: root,
  env: { ...process.env, VITE_SUPABASE_URL: " ", VITE_SUPABASE_ANON_KEY: " " },
  shell: isWin,
  stdio: "ignore"
});

function stopServer() {
  if (server.exitCode !== null) return;
  if (isWin) spawnSync("taskkill", ["/pid", String(server.pid), "/T", "/F"], { stdio: "ignore" });
  else server.kill("SIGTERM");
}
process.on("exit", stopServer);
process.on("SIGINT", () => { stopServer(); process.exit(130); });

let up = false;
for (let i = 0; i < 60 && !up; i++) { await new Promise((r) => setTimeout(r, 500)); up = await isUp(); }
if (!up) { console.error("O servidor de testes não respondeu em 30 segundos."); process.exit(1); }

const summary = [];
let failed = 0;
for (const t of tests) {
  const started = Date.now();
  const r = spawnSync(process.execPath, [join(here, `${t}.cjs`)], {
    cwd: root,
    env: { ...process.env, HUB_TEST_URL: base },
    encoding: "utf8",
    timeout: 5 * 60 * 1000
  });
  const out = `${r.stdout || ""}${r.stderr || ""}`;
  const ok = (out.match(/^OK\b/gm) || []).length;
  const fails = out.split(/\r?\n/).filter((l) => /^FALHA|^ERRO|ERROS:/.test(l) && !/api\/agenda-tributaria/.test(l));
  const crashed = r.status !== 0;
  const secs = ((Date.now() - started) / 1000).toFixed(0);
  if (reports.has(t)) {
    summary.push(`RELATÓRIO ${t} (${secs}s)`);
    console.log(`\n== ${t} (relatório)\n${out.trim()}`);
    continue;
  }
  const bad = crashed || fails.length > 0;
  if (bad) failed++;
  summary.push(`${bad ? "FALHOU   " : "PASSOU   "} ${t}: ${ok} verificações OK${fails.length ? `, ${fails.length} falha(s)` : ""}${crashed ? " (interrompido)" : ""} (${secs}s)`);
  if (bad) console.log(`\n== ${t}\n${out.trim()}`);
}

stopServer();
console.log(`\n==== Resumo\n${summary.join("\n")}\n`);
console.log(failed ? `${failed} teste(s) com falha.` : "Todos os testes passaram.");
process.exit(failed ? 1 : 0);
