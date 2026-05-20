import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const root = process.cwd();
const includeBuild = process.argv.includes("--build");

const requiredFiles = [
  "src/App.tsx",
  "src/styles.css",
  "src/types.ts",
  "netlify/functions/admin-users.mjs",
  "netlify/functions/email-outbox.mjs",
  "netlify/functions/coord-email.mjs",
  "netlify/functions/refresh-updates.mjs",
  "netlify/functions/sheets-pautas.mjs",
  "scripts/diagnose-arquivos-processador.mjs",
  "scripts/ocr-local-agent.mjs",
  "scripts/process-arquivos.mjs",
  "scripts/registrar-agente-ocr-login.ps1",
  "scripts/registrar-protocolo-ocr.ps1",
  "INICIAR_OCR_HUB.cmd",
  "INICIAR_OCR_HUB_PROCESSAR.cmd",
  "GUIA_OCR_LOCAL.md",
  "GUIA_DEPLOY_MARCO.md",
  "GUIA_PREFLIGHT_LOCAL.md",
  "GUIA_PROCESSAMENTO_DOCUMENTOS.md",
  "supabase/patch_arquivo_anotacoes.sql",
  "supabase/patch_arquivo_processamento.sql",
  "supabase/patch_arquivos_biblioteca.sql",
  "supabase/patch_email_outbox.sql",
  "supabase/patch_tarefas.sql",
  "supabase/check_hub_status.sql"
];

const forbiddenFiles = [
  "App.tsx",
  "main.tsx",
  "styles.css",
  "types.ts",
  "src/lib/App.tsx",
  "src/lib/main.tsx",
  "src/lib/styles.css",
  "src/lib/types.ts",
  "src/App/App.tsx"
];

const commandChecks = [
  npmCheck("TypeScript", ["run", "typecheck"]),
  {
    label: "Function admin-users",
    command: process.execPath,
    args: ["--check", "netlify/functions/admin-users.mjs"]
  },
  {
    label: "Function email-outbox",
    command: process.execPath,
    args: ["--check", "netlify/functions/email-outbox.mjs"]
  },
  {
    label: "Function coord-email",
    command: process.execPath,
    args: ["--check", "netlify/functions/coord-email.mjs"]
  },
  {
    label: "Function refresh-updates",
    command: process.execPath,
    args: ["--check", "netlify/functions/refresh-updates.mjs"]
  },
  {
    label: "Function sheets-pautas",
    command: process.execPath,
    args: ["--check", "netlify/functions/sheets-pautas.mjs"]
  },
  {
    label: "Processador de arquivos",
    command: process.execPath,
    args: ["--check", "scripts/process-arquivos.mjs"]
  },
  {
    label: "Agente local OCR",
    command: process.execPath,
    args: ["--check", "scripts/ocr-local-agent.mjs"]
  },
  {
    label: "Script agendamento OCR",
    command: "powershell.exe",
    args: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "scripts/registrar-agente-ocr-login.ps1", "-ValidateOnly"]
  },
  {
    label: "Script protocolo OCR",
    command: "powershell.exe",
    args: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "scripts/registrar-protocolo-ocr.ps1", "-ValidateOnly"]
  },
  {
    label: "Diagnostico do processador de arquivos",
    command: process.execPath,
    args: ["--check", "scripts/diagnose-arquivos-processador.mjs"]
  }
];

if (includeBuild) {
  commandChecks.push(npmCheck("Build local Vite", ["run", "build"]));
}

const failures = [];

printHeader("Arquivos obrigatorios");
for (const file of requiredFiles) {
  const found = existsSync(resolve(root, file));
  printResult(found, file);
  if (!found) failures.push(`Arquivo ausente: ${file}`);
}

printHeader("Arquivos que nao devem existir");
for (const file of forbiddenFiles) {
  const found = existsSync(resolve(root, file));
  printResult(!found, file);
  if (found) failures.push(`Arquivo em local incorreto: ${file}`);
}

printHeader("Checagens locais");
for (const check of commandChecks) {
  const result = spawnSync(check.command, check.args, {
    cwd: root,
    encoding: "utf8",
    stdio: "pipe",
    shell: false
  });

  const ok = result.status === 0;
  printResult(ok, check.label);

  if (!ok) {
    failures.push(`${check.label} falhou.`);
    if (result.error) {
      console.log(indent(`Erro ao executar comando: ${result.error.message}`));
    }
    const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    if (output) {
      console.log(indent(output));
    }
  }
}

printHeader("Resultado");
if (failures.length) {
  console.log(`Falhou: ${failures.length} pendencia(s). Nao libere deploy de marco ainda.`);
  for (const failure of failures) {
    console.log(`- ${failure}`);
  }
  process.exit(1);
}

console.log("OK. Preflight local aprovado. Deploy de marco pode ser considerado quando o checklist manual tambem estiver validado.");

function printHeader(label) {
  console.log(`\n== ${label} ==`);
}

function printResult(ok, label) {
  console.log(`${ok ? "[OK]" : "[ERRO]"} ${label}`);
}

function indent(value) {
  return value
    .split(/\r?\n/)
    .map((line) => `  ${line}`)
    .join("\n");
}

function npmCheck(label, args) {
  if (process.platform === "win32") {
    return {
      label,
      command: process.env.ComSpec || "cmd.exe",
      args: ["/d", "/s", "/c", "npm.cmd", ...args]
    };
  }

  return {
    label,
    command: "npm",
    args
  };
}
