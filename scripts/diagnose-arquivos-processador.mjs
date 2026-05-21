import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = process.cwd();
const env = readLocalEnv();
const checks = [
  checkEnv("VITE_SUPABASE_URL", env.VITE_SUPABASE_URL || env.SUPABASE_URL),
  checkEnv("SUPABASE_SERVICE_ROLE_KEY", env.SUPABASE_SERVICE_ROLE_KEY, true),
  checkTool("LibreOffice", env.LIBREOFFICE_BIN, [
    "soffice",
    "libreoffice",
    "C:\\Program Files\\LibreOffice\\program\\soffice.exe",
    "C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe"
  ]),
  checkTool("OCRmyPDF", env.OCRMYPDF_BIN, ["ocrmypdf"], "ocrmypdf"),
  checkTool("Tesseract", env.TESSERACT_BIN, [
    "tesseract",
    "C:\\Program Files\\Tesseract-OCR\\tesseract.exe",
    "C:\\Program Files (x86)\\Tesseract-OCR\\tesseract.exe"
  ])
];

console.log("\n== Diagnostico do processador de Arquivos ==\n");
for (const check of checks) {
  console.log(`${check.ok ? "[OK]" : "[PENDENTE]"} ${check.label}`);
  if (check.detail) console.log(`  ${check.detail}`);
}

console.log("\n== Leitura do resultado ==\n");
console.log("- Supabase URL e Service Role sao obrigatorios para consultar/processar a fila.");
console.log("- LibreOffice e necessario para converter PPTX/DOCX/XLSX em PDF.");
console.log("- OCRmyPDF e necessario para PDF escaneado virar pesquisavel.");
console.log("- Tesseract e necessario para OCR de imagens.");
console.log("- Sem essas ferramentas, o app continua funcionando, mas arquivos ficam como pendentes/erro de processamento.");

function readLocalEnv() {
  const values = {};
  for (const file of [".env.local", ".env"]) {
    const path = resolve(ROOT, file);
    if (!existsSync(path)) continue;
    const content = readFileSync(path, "utf8");
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
      const index = trimmed.indexOf("=");
      const key = trimmed.slice(0, index).trim();
      const value = trimmed.slice(index + 1).trim().replace(/^['"]|['"]$/g, "");
      values[key] = value;
    }
  }
  return values;
}

function checkEnv(label, value, secret = false) {
  if (!value) {
    return {
      ok: false,
      label,
      detail: "Nao encontrado em .env.local."
    };
  }

  return {
    ok: true,
    label,
    detail: secret ? `Configurado (${String(value).length} caracteres).` : String(value)
  };
}

function checkTool(label, explicitPath, candidates, pythonModule = "") {
  const found = firstExistingCommand([explicitPath, ...candidates].filter(Boolean));
  if (!found) {
    const moduleCommand = pythonModule ? detectPythonModuleCommand(pythonModule) : "";
    if (moduleCommand) {
      return {
        ok: true,
        label,
        detail: moduleCommand
      };
    }

    return {
      ok: false,
      label,
      detail: "Nao encontrado. Instale a ferramenta ou configure o caminho no .env.local."
    };
  }

  return {
    ok: true,
    label,
    detail: found
  };
}

function detectPythonModuleCommand(moduleName) {
  for (const command of ["py", "python", "python3"]) {
    const result = spawnSync(command, ["-m", moduleName, "--version"], {
      encoding: "utf8",
    stdio: "pipe",
      shell: false
    });
    if (result.status === 0) return `${command} -m ${moduleName}`;
  }

  return "";
}

function firstExistingCommand(candidates) {
  for (const candidate of candidates) {
    if (candidate.includes("\\") || candidate.includes("/")) {
      if (existsSync(candidate)) return candidate;
      continue;
    }

    const command = process.platform === "win32" ? "where.exe" : "command";
    const args = process.platform === "win32" ? [candidate] : ["-v", candidate];
    const result = spawnSync(command, args, {
      encoding: "utf8",
      stdio: "pipe",
      shell: process.platform !== "win32"
    });

    if (result.status === 0) {
      return String(result.stdout || candidate).split(/\r?\n/)[0].trim() || candidate;
    }
  }

  return "";
}







      
