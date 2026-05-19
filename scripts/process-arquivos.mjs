import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const ROOT = process.cwd();
const BUCKET = "hub-arquivos";
const WORK_ROOT = resolve(ROOT, ".tmp", "arquivo-processamento");
const DEFAULT_LIMIT = 5;
const PDF_TEXT_MIN_CHARS = 25;

loadEnv(resolve(ROOT, ".env"));
loadEnv(resolve(ROOT, ".env.local"));

const options = parseArgs(process.argv.slice(2));
const dryRun = Boolean(options.dryRun);
const limit = Number(options.limit || process.env.ARQUIVOS_PROCESS_LIMIT || DEFAULT_LIMIT);
const language = String(options.lang || process.env.ARQUIVOS_PROCESS_LANGUAGE || "por+eng");
const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  fail(
    "Configure VITE_SUPABASE_URL/SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY em .env.local antes de processar documentos."
  );
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false
  }
});

const tools = detectTools();

main().catch((error) => {
  fail(getErrorMessage(error));
});

async function main() {
  mkdirSync(WORK_ROOT, { recursive: true });

  const query = supabase
    .from("arquivo_recursos")
    .select(
      "id,titulo,file_name,storage_path,mime_type,size_bytes,processing_status,processed_storage_path,updated_at"
    )
    .not("storage_path", "is", null)
    .order("updated_at", { ascending: true })
    .limit(Number.isFinite(limit) && limit > 0 ? limit : DEFAULT_LIMIT);

  if (options.id) {
    query.eq("id", String(options.id));
  } else if (options.force) {
    query.in("processing_status", ["pending", "processing", "error", "ready"]);
  } else {
    query.eq("processing_status", "pending");
  }

  const { data, error } = await query;
  if (error) throw error;

  const resources = data || [];
  print(`Arquivos encontrados: ${resources.length}`);
  print(`Ferramentas: LibreOffice=${tools.soffice || "nao encontrado"} | OCRmyPDF=${tools.ocrmypdf || "nao encontrado"} | Tesseract=${tools.tesseract || "nao encontrado"}`);

  if (!resources.length) return;

  for (const resource of resources) {
    await processResource(resource);
  }
}

async function processResource(resource) {
  const title = resource.titulo || resource.file_name || resource.id;
  print(`\n== ${title} ==`);

  const storagePath = String(resource.storage_path || "");
  if (!storagePath) {
    print("Ignorado: recurso sem storage_path.");
    return;
  }

  const workDir = resolve(WORK_ROOT, resource.id);
  rmSync(workDir, { recursive: true, force: true });
  mkdirSync(workDir, { recursive: true });

  if (dryRun) {
    const strategy = describeStrategy(resource);
    print(`[dry-run] ${strategy}`);
    return;
  }

  await updateResource(resource.id, {
    processing_status: "processing",
    processing_message: "Processando conversao/OCR da versao pesquisavel."
  });

  try {
    const originalPath = await downloadOriginal(resource, workDir);
    const processed = await buildProcessedVersion(resource, originalPath, workDir);

    const updatePayload = {
      processing_status: "ready",
      processing_message: processed.message,
      processed_file_name: processed.fileName,
      processed_storage_path: processed.storagePath,
      processed_mime_type: processed.mimeType,
      processed_size_bytes: processed.sizeBytes,
      processed_at: new Date().toISOString()
    };

    if (processed.localPath) {
      const uploadPath = `processed/${resource.id}/${Date.now()}-${toSafeStorageFileName(processed.fileName)}`;
      const buffer = readFileSync(processed.localPath);
      const { error: uploadError } = await supabase.storage.from(BUCKET).upload(uploadPath, buffer, {
        contentType: processed.mimeType,
        upsert: true
      });
      if (uploadError) throw uploadError;

      updatePayload.processed_storage_path = uploadPath;
      updatePayload.processed_size_bytes = buffer.length;
    }

    await updateResource(resource.id, updatePayload);
    print(`OK: ${updatePayload.processing_message}`);
  } catch (error) {
    const message = getErrorMessage(error);
    await updateResource(resource.id, {
      processing_status: "error",
      processing_message: limitText(message, 900)
    });
    print(`ERRO: ${message}`);
  } finally {
    if (!options.keepTemp) {
      rmSync(workDir, { recursive: true, force: true });
    }
  }
}

async function downloadOriginal(resource, workDir) {
  const { data, error } = await supabase.storage.from(BUCKET).download(resource.storage_path);
  if (error) throw error;
  if (!data) throw new Error("Storage retornou arquivo vazio.");

  const buffer = Buffer.from(await data.arrayBuffer());
  const safeName = toSafeStorageFileName(resource.file_name || basename(resource.storage_path));
  const filePath = resolve(workDir, safeName || `arquivo-${resource.id}`);
  writeFileSync(filePath, buffer);
  return filePath;
}

async function buildProcessedVersion(resource, originalPath, workDir) {
  if (isPdf(resource, originalPath)) {
    return processPdf(resource, originalPath, workDir);
  }

  if (isImage(resource, originalPath)) {
    return processImage(resource, originalPath, workDir);
  }

  if (isOffice(resource, originalPath)) {
    return processOffice(resource, originalPath, workDir);
  }

  return useOriginalAsStudyVersion(resource, "Arquivo ja esta em formato que dispensa conversao/OCR.");
}

async function processPdf(resource, originalPath, workDir) {
  if (await pdfHasText(originalPath)) {
    return useOriginalAsStudyVersion(resource, "PDF ja possui camada de texto pesquisavel.");
  }

  if (!tools.ocrmypdf) {
    throw new Error(
      "PDF sem camada de texto. Instale OCRmyPDF neste computador/servidor para gerar PDF pesquisavel."
    );
  }

  const outputPath = resolve(workDir, `${baseNameWithoutExtension(originalPath)}-ocr.pdf`);
  runCommand(toCommand(tools.ocrmypdf), [
    "--skip-text",
    "--rotate-pages",
    "--deskew",
    "-l",
    language,
    originalPath,
    outputPath
  ]);

  return {
    localPath: outputPath,
    fileName: `${baseNameWithoutExtension(resource.file_name || originalPath)}-pesquisavel.pdf`,
    mimeType: "application/pdf",
    sizeBytes: statSync(outputPath).size,
    storagePath: "",
    message: "PDF processado com OCR e pronto para pesquisa/grifo."
  };
}

async function processImage(resource, originalPath, workDir) {
  if (!tools.tesseract) {
    throw new Error("Imagem depende de OCR. Instale Tesseract OCR para gerar PDF pesquisavel.");
  }

  const outputBase = resolve(workDir, `${baseNameWithoutExtension(originalPath)}-ocr`);
  const outputPath = `${outputBase}.pdf`;
  runCommand(toCommand(tools.tesseract), [originalPath, outputBase, "-l", language, "pdf"]);

  return {
    localPath: outputPath,
    fileName: `${baseNameWithoutExtension(resource.file_name || originalPath)}-pesquisavel.pdf`,
    mimeType: "application/pdf",
    sizeBytes: statSync(outputPath).size,
    storagePath: "",
    message: "Imagem processada com OCR e convertida para PDF pesquisavel."
  };
}

async function processOffice(resource, originalPath, workDir) {
  if (isDocx(resource, originalPath) && !tools.soffice) {
    return useOriginalAsStudyVersion(resource, "DOCX mantido para estudo interno do HUB; LibreOffice nao encontrado para converter em PDF.");
  }

  if (!tools.soffice) {
    throw new Error("Arquivo Office depende de conversao. Instale LibreOffice para converter PPTX/DOCX/XLSX em PDF pesquisavel.");
  }

  runCommand(toCommand(tools.soffice), [
    "--headless",
    "--convert-to",
    "pdf",
    "--outdir",
    workDir,
    originalPath
  ]);

  const convertedPath = resolve(workDir, `${baseNameWithoutExtension(originalPath)}.pdf`);
  if (!existsSync(convertedPath)) {
    throw new Error("LibreOffice nao gerou o PDF esperado.");
  }

  if (await pdfHasText(convertedPath)) {
    return {
      localPath: convertedPath,
      fileName: `${baseNameWithoutExtension(resource.file_name || originalPath)}-convertido.pdf`,
      mimeType: "application/pdf",
      sizeBytes: statSync(convertedPath).size,
      storagePath: "",
      message: "Arquivo convertido para PDF com camada de texto pesquisavel."
    };
  }

  if (!tools.ocrmypdf) {
    throw new Error("Arquivo convertido para PDF, mas sem texto pesquisavel. Instale OCRmyPDF para aplicar OCR.");
  }

  const ocrPath = resolve(workDir, `${baseNameWithoutExtension(originalPath)}-ocr.pdf`);
  runCommand(toCommand(tools.ocrmypdf), [
    "--skip-text",
    "--rotate-pages",
    "--deskew",
    "-l",
    language,
    convertedPath,
    ocrPath
  ]);

  return {
    localPath: ocrPath,
    fileName: `${baseNameWithoutExtension(resource.file_name || originalPath)}-pesquisavel.pdf`,
    mimeType: "application/pdf",
    sizeBytes: statSync(ocrPath).size,
    storagePath: "",
    message: "Arquivo convertido para PDF e processado com OCR."
  };
}

function useOriginalAsStudyVersion(resource, message) {
  return {
    localPath: "",
    fileName: resource.file_name || "arquivo",
    mimeType: resource.mime_type || guessMimeType(resource.file_name || resource.storage_path),
    sizeBytes: Number(resource.size_bytes || 0),
    storagePath: resource.storage_path,
    message
  };
}

async function pdfHasText(filePath) {
  try {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const data = new Uint8Array(readFileSync(filePath));
    const document = await pdfjs.getDocument({
      data,
      disableFontFace: true,
      isEvalSupported: false,
      useWorkerFetch: false
    }).promise;

    let textLength = 0;
    const pagesToInspect = Math.min(document.numPages || 0, 8);
    for (let pageNumber = 1; pageNumber <= pagesToInspect; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const textContent = await page.getTextContent();
      textLength += (textContent.items || [])
        .map((item) => ("str" in item ? item.str : ""))
        .join(" ")
        .trim().length;
      if (textLength >= PDF_TEXT_MIN_CHARS) return true;
    }
  } catch (error) {
    print(`Aviso: nao foi possivel conferir camada de texto do PDF (${getErrorMessage(error)}).`);
  }

  return false;
}

async function updateResource(id, payload) {
  const { error } = await supabase.from("arquivo_recursos").update(payload).eq("id", id);
  if (error) throw error;
}

function detectTools() {
  return {
    soffice: firstExistingCommand([
      process.env.LIBREOFFICE_BIN,
      "soffice",
      "libreoffice",
      "C:\\Program Files\\LibreOffice\\program\\soffice.exe",
      "C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe"
    ]),
    ocrmypdf: firstExistingCommand([process.env.OCRMYPDF_BIN, "ocrmypdf"]),
    tesseract: firstExistingCommand([
      process.env.TESSERACT_BIN,
      "tesseract",
      "C:\\Program Files\\Tesseract-OCR\\tesseract.exe",
      "C:\\Program Files (x86)\\Tesseract-OCR\\tesseract.exe"
    ])
  };
}

function firstExistingCommand(candidates) {
  for (const candidate of candidates.filter(Boolean)) {
    if (candidate.includes("\\") || candidate.includes("/")) {
      if (existsSync(candidate)) return candidate;
      continue;
    }

    const command = process.platform === "win32" ? "where.exe" : "command";
    const args = process.platform === "win32" ? [candidate] : ["-v", candidate];
    const result = spawnSync(command, args, { encoding: "utf8", stdio: "pipe", shell: process.platform !== "win32" });
    if (result.status === 0) return candidate;
  }

  return "";
}

function runCommand(command, args) {
  print(`Executando: ${command.label} ${args.map(quoteArg).join(" ")}`);
  const result = spawnSync(command.value, args, {
    encoding: "utf8",
    stdio: "pipe",
    shell: false
  });

  if (result.status !== 0) {
    const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    throw new Error(output || `Comando falhou: ${command.label}`);
  }
}

function toCommand(value) {
  return {
    value,
    label: value.includes("\\") || value.includes("/") ? `"${value}"` : value
  };
}

function describeStrategy(resource) {
  const target = `${resource.mime_type || ""} ${resource.file_name || ""} ${resource.storage_path || ""}`.toLowerCase();
  if (target.includes("pdf") || /\.pdf$/i.test(target)) return "PDF: confere camada de texto; se faltar, usa OCRmyPDF.";
  if (target.includes("image/") || /\.(png|jpe?g|webp|tiff?|bmp)$/i.test(target)) return "Imagem: usa Tesseract para gerar PDF pesquisavel.";
  if (isOffice(resource, resource.file_name || "")) return "Office/PPTX/DOCX/XLSX: usa LibreOffice para PDF; se faltar texto, usa OCRmyPDF.";
  return "Formato simples: marca como dispensado de conversao.";
}

function isPdf(resource, filePath) {
  const target = targetText(resource, filePath);
  return target.includes("application/pdf") || /\.pdf$/i.test(target);
}

function isImage(resource, filePath) {
  const target = targetText(resource, filePath);
  return target.includes("image/") || /\.(png|jpe?g|gif|webp|tiff?|bmp)$/i.test(target);
}

function isDocx(resource, filePath) {
  const target = targetText(resource, filePath);
  return target.includes("wordprocessingml.document") || /\.docx$/i.test(target);
}

function isOffice(resource, filePath) {
  const target = targetText(resource, filePath);
  return (
    target.includes("officedocument") ||
    target.includes("msword") ||
    target.includes("ms-excel") ||
    target.includes("ms-powerpoint") ||
    /\.(docx?|xlsx?|pptx?)$/i.test(target)
  );
}

function targetText(resource, filePath) {
  return `${resource.mime_type || ""} ${resource.file_name || ""} ${resource.storage_path || ""} ${filePath || ""}`.toLowerCase();
}

function guessMimeType(fileName) {
  const extension = extname(fileName || "").toLowerCase();
  if (extension === ".pdf") return "application/pdf";
  if (extension === ".html" || extension === ".htm") return "text/html";
  if (extension === ".docx") return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (extension === ".pptx") return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  if (extension === ".xlsx") return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if ([".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tif", ".tiff"].includes(extension)) return "image/*";
  return "application/octet-stream";
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

function parseArgs(args) {
  const parsed = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--dry-run") parsed.dryRun = true;
    else if (arg === "--force") parsed.force = true;
    else if (arg === "--keep-temp") parsed.keepTemp = true;
    else if (arg === "--limit") parsed.limit = args[index + 1];
    else if (arg.startsWith("--limit=")) parsed.limit = arg.split("=").slice(1).join("=");
    else if (arg === "--id") parsed.id = args[index + 1];
    else if (arg.startsWith("--id=")) parsed.id = arg.split("=").slice(1).join("=");
    else if (arg === "--lang") parsed.lang = args[index + 1];
    else if (arg.startsWith("--lang=")) parsed.lang = arg.split("=").slice(1).join("=");
  }
  return parsed;
}

function toSafeStorageFileName(fileName) {
  const normalized = String(fileName || "arquivo")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");

  return normalized || "arquivo";
}

function baseNameWithoutExtension(value) {
  const name = basename(value || "arquivo");
  const extension = extname(name);
  return extension ? name.slice(0, -extension.length) : name;
}

function limitText(value, maxLength) {
  return String(value || "").slice(0, maxLength);
}

function quoteArg(value) {
  return /\s/.test(value) ? `"${value}"` : value;
}

function print(message) {
  console.log(message);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function getErrorMessage(error) {
  if (error instanceof Error) return error.message;
  return String(error || "Erro desconhecido");
}
