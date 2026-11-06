import { OCR_ENABLED } from "../app/appConfig";
import type { FileResource, FileViewerNote, FileViewerNoteKind } from "../types";
import type { PdfGlobalSearchMatch, PdfJsLike, PdfSearchPlan, PdfTextRawItem, PdfTextSpan, PdfViewportLike, ViewerPreview } from "../app/appTypes";
import { formatDateTime, formatFileCategory, normalizeForSearch } from "./formatters";

export function getPdfSearchOffset(matches: PdfGlobalSearchMatch[], page: number) {
  if (!matches.length) return 0;
  return matches.filter((match) => match.page < page).length;
}

export function countPdfTextContentMatches(items: PdfTextRawItem[], normalizedSearchTerm: string) {
  if (!normalizedSearchTerm) return 0;
  const normalizedItems = items.map((item) => normalizeForSearch(item.str || "")).filter(Boolean);
  if (!normalizedItems.length) return 0;

  const spacedText = normalizedItems.join(" ");
  const compactText = normalizedItems.join("");
  const compactTerm = normalizedSearchTerm.replace(/\s+/g, "");

  return Math.max(
    countNormalizedTermMatches(spacedText, normalizedSearchTerm),
    compactTerm ? countNormalizedTermMatches(compactText, compactTerm) : 0
  );
}

export function countNormalizedTermMatches(text: string, term: string) {
  if (!text || !term) return 0;
  let total = 0;
  let index = text.indexOf(term);
  while (index >= 0) {
    total += 1;
    index = text.indexOf(term, index + Math.max(1, term.length));
  }
  return total;
}

export function buildPdfSearchPlan(spans: PdfTextSpan[], normalizedSearchTerm: string, startIndex = 0): PdfSearchPlan {
  const indexesBySpanId = new Map<string, number>();
  if (!normalizedSearchTerm) return { total: 0, indexesBySpanId };

  let total = 0;
  for (const span of spans) {
    const normalizedText = normalizeForSearch(span.text);
    if (!normalizedText) continue;

    let index = normalizedText.indexOf(normalizedSearchTerm);
    while (index >= 0) {
      if (!indexesBySpanId.has(span.id)) indexesBySpanId.set(span.id, startIndex + total);
      total += 1;
      index = normalizedText.indexOf(normalizedSearchTerm, index + Math.max(1, normalizedSearchTerm.length));
    }
  }

  if (total) return { total, indexesBySpanId };

  return buildPdfCombinedSearchPlan(spans, normalizedSearchTerm, startIndex, " ");
}

export function buildPdfCombinedSearchPlan(spans: PdfTextSpan[], normalizedSearchTerm: string, startIndex = 0, separator = ""): PdfSearchPlan {
  const indexesBySpanId = new Map<string, number>();
  let text = "";
  const ranges: Array<{ end: number; id: string; start: number }> = [];

  for (const span of spans) {
    const normalizedText = normalizeForSearch(span.text);
    if (!normalizedText) continue;

    if (separator && text) text += separator;
    const start = text.length;
    text += normalizedText;
    ranges.push({ id: span.id, start, end: text.length });
  }

  let total = 0;
  let index = text.indexOf(normalizedSearchTerm);
  while (index >= 0) {
    const end = index + normalizedSearchTerm.length;
    for (const range of ranges) {
      if (range.end <= index || range.start >= end) continue;
      if (!indexesBySpanId.has(range.id)) indexesBySpanId.set(range.id, startIndex + total);
    }
    total += 1;
    index = text.indexOf(normalizedSearchTerm, index + Math.max(1, normalizedSearchTerm.length));
  }

  if (total || !separator) return { total, indexesBySpanId };

  return buildPdfCombinedSearchPlan(spans, normalizedSearchTerm.replace(/\s+/g, ""), startIndex);
}

export function renderManualPdfTextLayer(
  pdfjs: PdfJsLike,
  textLayerElement: HTMLDivElement,
  items: PdfTextRawItem[],
  viewport: PdfViewportLike,
  page: number
) {
  const spans: PdfTextSpan[] = [];
  const measureCanvas = document.createElement("canvas");
  const measureContext = measureCanvas.getContext("2d");

  textLayerElement.innerHTML = "";

  items.forEach((item, index) => {
    const text = item.str || "";
    if (!text.trim() || !Array.isArray(item.transform)) return;

    const transform = pdfjs.Util.transform(viewport.transform, item.transform);
    const angle = Math.atan2(transform[1], transform[0]);
    const fontHeight = Math.max(6, Math.hypot(transform[2], transform[3]));
    const left = transform[4];
    const top = transform[5] - fontHeight * 0.82;
    const span = document.createElement("span");
    const id = `${page}-${index}`;

    span.dataset.pdfTextIndex = id;
    span.setAttribute("role", "presentation");
    span.textContent = text;
    span.dir = item.dir || "ltr";
    span.style.left = `${left}px`;
    span.style.top = `${top}px`;
    span.style.fontSize = `${fontHeight}px`;
    span.style.fontFamily = "Arial, Helvetica, sans-serif";

    const expectedWidth = typeof item.width === "number" ? item.width * viewport.scale : 0;
    if (measureContext && expectedWidth > 0) {
      measureContext.font = `${fontHeight}px Arial, Helvetica, sans-serif`;
      const measuredWidth = measureContext.measureText(text).width;
      const scaleX = measuredWidth ? expectedWidth / measuredWidth : 1;
      span.style.transform = `${Math.abs(angle) > 0.001 ? `rotate(${angle}rad) ` : ""}scaleX(${Math.max(0.2, scaleX)})`;
    } else if (Math.abs(angle) > 0.001) {
      span.style.transform = `rotate(${angle}rad)`;
    }

    textLayerElement.append(span);
    spans.push({ id, text });

    if (item.hasEOL) {
      const lineBreak = document.createElement("br");
      lineBreak.setAttribute("role", "presentation");
      textLayerElement.append(lineBreak);
    }
  });

  return spans;
}

export function isImageResource(resource: FileResource) {
  return resource.mimeType.startsWith("image/") || /\.(png|jpe?g|gif|webp|bmp)$/i.test(resource.fileName || resource.url);
}

export function getStudyResource(resource: FileResource): FileResource {
  if (resource.processingStatus !== "ready" || !resource.processedUrl) return resource;

  return {
    ...resource,
    url: resource.processedUrl,
    fileName: resource.processedFileName || resource.fileName,
    storagePath: resource.processedStoragePath || resource.storagePath,
    mimeType: resource.processedMimeType || "application/pdf",
    sizeBytes: resource.processedSizeBytes || resource.sizeBytes
  };
}

export function getInitialFileProcessingStatus(fileName: string, mimeType: string): FileResource["processingStatus"] {
  const target = `${mimeType} ${fileName}`.toLowerCase();
  const needsStudyVersion =
    target.includes("pdf") ||
    target.includes("presentation") ||
    target.includes("powerpoint") ||
    target.includes("wordprocessingml.document") ||
    target.includes("spreadsheetml.sheet") ||
    target.includes("image/") ||
    /\.(pdf|pptx?|docx?|xlsx?|png|jpe?g|webp|tiff?|bmp)(\?|#|$)?$/i.test(fileName);

  return needsStudyVersion ? "pending" : "none";
}

export function getProcessingBadge(resource: FileResource) {
  const status = resource.processingStatus || "none";
  if (status === "none") return null;

  const labels: Record<FileResource["processingStatus"], string> = {
    none: "",
    pending: "OCR/conversao pendente",
    processing: "Processando OCR",
    ready: "Versão pesquisável pronta",
    error: "Falha no OCR"
  };

  return {
    label: labels[status],
    tone: status
  };
}

export function buildViewerPreview(resource: FileResource, page: number, zoom: number, query: string): ViewerPreview {
  if (!resource.url) {
    return {
      mode: "unsupported",
      src: "",
      title: resource.titulo,
      detail: "O registro não possui URL ou arquivo anexado disponível para visualização."
    };
  }

  if (isImageResource(resource)) {
    return {
      mode: "image",
      src: resource.url,
      title: resource.titulo
    };
  }

  if (isPdfResource(resource)) {
    return {
      mode: "iframe",
      src: buildPdfViewerUrl(resource, page, zoom, query),
      title: resource.titulo,
      notice:
        resource.processingStatus === "ready"
          ? "Abrindo a versão processada para estudo, com PDF pesquisável quando o OCR/conversao estiver completo."
          : query
            ? "Pesquisa aplicada a camada de texto do PDF. Se o arquivo for escaneado ou imagem, use OCR para permitir busca/grifo."
            : "PDF renderizado internamente com PDF.js para permitir seleção de texto e grifo visual quando houver camada de texto."
    };
  }

  if (isDocxResource(resource)) {
    return {
      mode: "iframe",
      src: "",
      title: resource.titulo,
      notice: query
        ? "Pesquisa aplicada ao DOCX convertido internamente. Selecione um trecho do texto para salvar como grifo."
        : "DOCX convertido internamente para permitir seleção de texto e grifo visual no conteúdo renderizado."
    };
  }

  const googleDrivePreview = buildGoogleDrivePreviewUrl(resource.url);
  if (googleDrivePreview) {
    return {
      mode: "iframe",
      src: googleDrivePreview,
      title: resource.titulo,
      notice: "Google Drive pode exigir permissão de acesso. Busca e seleção de texto dependem do preview do Google."
    };
  }

  if (isGoogleDriveFolderUrl(resource.url)) {
    return {
      mode: "unsupported",
      src: "",
      title: resource.titulo,
      detail: "Pastas do Google Drive normalmente bloqueiam visualização embutida. Abra em nova aba para acessar com sua conta Google."
    };
  }

  if (isOfficeResource(resource)) {
    return {
      mode: "iframe",
      src: `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(resource.url)}`,
      title: resource.titulo,
      notice:
        OCR_ENABLED && (resource.processingStatus === "pending" || resource.processingStatus === "processing")
          ? "Arquivo aguardando conversão/OCR para PDF pesquisável. Enquanto isso, o preview usa Office externo e não permite busca/grifo interno."
          : "Arquivos Word, Excel e PowerPoint usam o visualizador do Office. Busca, seleção e grifo direto dependem desse preview externo."
    };
  }

  if (isTextLikeResource(resource) || isEmbeddableWebUrl(resource.url)) {
    return {
      mode: "iframe",
      src: resource.url,
      title: resource.titulo,
      notice: "Alguns sites bloqueiam visualização embutida por seguranca. Busca e seleção podem não funcionar dentro do painel."
    };
  }

  return {
    mode: "unsupported",
    src: "",
    title: resource.titulo,
    detail: "Tipo de arquivo sem pre-visualizacao interna. Use Abrir em nova aba para consultar o documento."
  };
}

export function buildPdfViewerUrl(resource: FileResource, page: number, zoom: number, query: string) {
  if (!resource.url) return "";

  const cleanUrl = resource.url.split("#")[0];
  const hash = new URLSearchParams();
  hash.set("page", String(Math.max(1, page)));
  hash.set("zoom", String(Math.max(50, Math.min(200, zoom))));
  if (query.trim()) hash.set("search", query.trim());
  return `${cleanUrl}#${hash.toString()}`;
}

export function isPdfResource(resource: FileResource) {
  return resource.mimeType === "application/pdf" || /\.pdf(\?|#|$)/i.test(resource.fileName || resource.url);
}

export function isDocxResource(resource: FileResource) {
  const target = `${resource.mimeType} ${resource.fileName} ${resource.url}`.toLowerCase();
  return target.includes("wordprocessingml.document") || /\.docx(\?|#|$)/i.test(target);
}

export function isOfficeResource(resource: FileResource) {
  const target = `${resource.mimeType} ${resource.fileName} ${resource.url}`.toLowerCase();
  return (
    target.includes("officedocument") ||
    target.includes("msword") ||
    target.includes("ms-excel") ||
    target.includes("ms-powerpoint") ||
    /\.(docx?|xlsx?|pptx?)(\?|#|$)/i.test(resource.fileName || resource.url)
  );
}

export function isTextLikeResource(resource: FileResource) {
  const target = `${resource.mimeType} ${resource.fileName} ${resource.url}`.toLowerCase();
  return target.includes("text/") || /\.(txt|csv|md|html?|json|xml)(\?|#|$)/i.test(target);
}

export function isEmbeddableWebUrl(value: string) {
  return /^https?:\/\//i.test(value) && !isGoogleDriveFolderUrl(value);
}

export function isGoogleDriveFolderUrl(value: string) {
  return /drive\.google\.com\/drive\/folders\//i.test(value) || /drive\.google\.com\/folders\//i.test(value);
}

export function buildGoogleDrivePreviewUrl(value: string) {
  if (!/drive\.google\.com|docs\.google\.com/i.test(value)) return "";
  if (isGoogleDriveFolderUrl(value)) return "";

  if (/docs\.google\.com/i.test(value)) {
    return value
      .replace(/\/edit(\?.*)?$/i, "/preview")
      .replace(/\/view(\?.*)?$/i, "/preview")
      .replace(/\/pub(\?.*)?$/i, "/preview");
  }

  const fileId = extractGoogleFileId(value);
  if (fileId) return `https://drive.google.com/file/d/${fileId}/preview`;

  return value
    .replace(/\/edit(\?.*)?$/i, "/preview")
    .replace(/\/view(\?.*)?$/i, "/preview");
}

export function extractGoogleFileId(value: string) {
  const patterns = [
    /\/file\/d\/([^/]+)/i,
    /[?&]id=([^&]+)/i,
    /\/document\/d\/([^/]+)/i,
    /\/spreadsheets\/d\/([^/]+)/i,
    /\/presentation\/d\/([^/]+)/i
  ];

  for (const pattern of patterns) {
    const match = value.match(pattern);
    if (match?.[1]) return decodeURIComponent(match[1]);
  }

  return "";
}

export function getViewerManualHighlightTerms(notes: FileViewerNote[]) {
  const terms = notes
    .map((note) => note.text)
    .map((term) => term.trim())
    .filter((term) => term.length > 1);
  return Array.from(new Set(terms));
}

export function isTextHighlightedByTerms(text: string, terms: string[]) {
  const normalizedText = normalizeForSearch(text);
  if (!normalizedText) return false;

  return terms.some((term) => {
    const normalizedTerm = normalizeForSearch(term);
    if (!normalizedTerm) return false;
    return normalizedTerm.includes(normalizedText) || normalizedText.includes(normalizedTerm);
  });
}

export function markHtmlWithTerms(html: string, highlightTerms: string[], searchTerm: string) {
  if (!html || typeof DOMParser === "undefined") return { html, searchCount: 0 };

  const document = new DOMParser().parseFromString(`<main>${html}</main>`, "text/html");
  const root = document.body.firstElementChild;
  if (!root) return { html, searchCount: 0 };

  let searchCount = 0;
  const normalizedSearchTerm = searchTerm.trim();
  if (normalizedSearchTerm.length > 1) {
    searchCount = markTermsInHtml(document, root, [normalizedSearchTerm], (mark, index) => {
      mark.className = "doc-search-highlight";
      mark.dataset.searchIndex = String(index);
    });
  }

  markTermsInHtml(document, root, highlightTerms, (mark) => {
    mark.className = "doc-highlight";
  });

  return { html: root.innerHTML, searchCount };
}

export function markTermsInHtml(
  document: Document,
  root: Element,
  terms: string[],
  decorate: (mark: HTMLElement, index: number, text: string) => void
) {
  const escapedTerms = terms.map((term) => term.trim()).filter(Boolean).sort((left, right) => right.length - left.length).map(escapeRegExp);
  if (!escapedTerms.length) return 0;

  const matcher = new RegExp(`(${escapedTerms.join("|")})`, "gi");
  let markCount = 0;

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent || parent.closest("mark")) return NodeFilter.FILTER_REJECT;
      return node.textContent?.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    }
  });

  const textNodes: Text[] = [];
  let current = walker.nextNode();
  while (current) {
    textNodes.push(current as Text);
    current = walker.nextNode();
  }

  for (const textNode of textNodes) {
    const value = textNode.textContent || "";
    matcher.lastIndex = 0;
    if (!matcher.test(value)) continue;
    matcher.lastIndex = 0;

    const fragment = document.createDocumentFragment();
    let lastIndex = 0;
    for (const match of value.matchAll(matcher)) {
      const index = match.index || 0;
      if (index > lastIndex) fragment.append(document.createTextNode(value.slice(lastIndex, index)));
      const mark = document.createElement("mark");
      decorate(mark, markCount, match[0]);
      mark.textContent = match[0];
      fragment.append(mark);
      markCount += 1;
      lastIndex = index + match[0].length;
    }
    if (lastIndex < value.length) fragment.append(document.createTextNode(value.slice(lastIndex)));
    textNode.replaceWith(fragment);
  }

  return markCount;
}

export function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function buildViewerNotesMarkdown(resource: FileResource, notes: FileViewerNote[]) {
  const sortedNotes = [...notes].sort((a, b) => {
    const pageDiff = a.page - b.page;
    if (pageDiff !== 0) return pageDiff;
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  });

  const lines = [
    `# Anotações - ${resource.titulo}`,
    "",
    `- Arquivo: ${resource.fileName || resource.titulo}`,
    `- Categoria: ${formatFileCategory(resource.categoria)}`,
    `- URL: ${resource.url || "Sem URL"}`,
    `- Exportado em: ${formatDateTime(new Date().toISOString())}`,
    "",
    "## Registros",
    ""
  ];

  if (!sortedNotes.length) {
    lines.push("Nenhuma anotação registrada.");
  }

  sortedNotes.forEach((note) => {
    lines.push(`### ${formatViewerNoteKind(note.kind)} - página ${note.page}`);
    lines.push("");
    lines.push(`- Autor: ${note.userEmail || note.createdBy}`);
    lines.push(`- Criado em: ${formatDateTime(note.createdAt)}`);
    lines.push("");
    lines.push(note.text);
    lines.push("");
  });

  return `${lines.join("\n")}\n`;
}

export function formatViewerNoteKind(kind: FileViewerNoteKind) {
  return kind === "highlight" ? "Grifo" : "Comentario";
}

export function toSafeDownloadFileName(value: string) {
  return (
    value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^[-.]+|[-.]+$/g, "")
      .toLowerCase() || "arquivo"
  );
}

export function isPdfRenderCancelled(error: unknown) {
  const message = error instanceof Error ? error.message : String((error as { message?: string } | null)?.message || error || "");
  const name = error && typeof error === "object" && "name" in error ? String((error as { name?: unknown }).name || "") : "";
  return name === "RenderingCancelledException" || /cancel/i.test(message);
}

export function triggerOcrProtocol() {
  if (typeof window === "undefined") return false;

  try {
    window.location.href = "hubocr://rodar";
    return true;
  } catch {
    return false;
  }
}

export function summarizeLocalOcrOutput(output: string) {
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const foundLine = [...lines].reverse().find((line) => /^Arquivos encontrados:/i.test(line));
  const statusLines = lines.filter((line) => /^OK:|^ERRO:/i.test(line)).slice(-3);

  if (!lines.length) return "OCR executado. Lista de arquivos atualizada.";
  if (statusLines.length) return [foundLine, ...statusLines].filter(Boolean).join(" ");
  return lines.slice(-2).join(" ");
}

// Link assinado do Supabase com download direto (parametro download=nome do arquivo).
export function buildFileDownloadUrl(resource: FileResource) {
  try {
    const url = new URL(resource.url);
    // Parametro de download so em links http(s) (Supabase); data:/blob: seguem como estao.
    if (url.protocol !== "https:" && url.protocol !== "http:") return resource.url;
    url.searchParams.set("download", resource.fileName || resource.titulo || "arquivo");
    return url.toString();
  } catch {
    return resource.url;
  }
}
