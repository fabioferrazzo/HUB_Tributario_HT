import { FileArchive, Link2 } from "lucide-react";
import type { FileResource, FileViewerNote } from "../types";
import type { PdfGlobalSearchMatch, PdfJsLike, PdfTextRawItem, PdfTextSpan, PdfViewportLike } from "../app/appTypes";
import { buildPdfSearchPlan, countPdfTextContentMatches, getPdfSearchOffset, getViewerManualHighlightTerms, isPdfRenderCancelled, isTextHighlightedByTerms, markHtmlWithTerms, renderManualPdfTextLayer } from "../lib/viewerUtils";
import { getErrorMessage, normalizeForSearch } from "../lib/formatters";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { useEffect, useMemo, useRef, useState } from "react";

export function InternalPdfViewer({
  highlightNotes,
  onPageCount,
  onRequestPage,
  onSearchStats,
  onSelectText,
  page,
  resource,
  searchIndex,
  searchTerm,
  zoom
}: {
  highlightNotes: FileViewerNote[];
  onPageCount: (total: number) => void;
  onRequestPage: (page: number) => void;
  onSearchStats: (total: number) => void;
  onSelectText: (text: string) => void;
  page: number;
  resource: FileResource;
  searchIndex: number;
  searchTerm: string;
  zoom: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const renderTaskRef = useRef<{ cancel: () => void; promise: Promise<unknown> } | null>(null);
  const textLayerRef = useRef<HTMLDivElement | null>(null);
  const [spans, setSpans] = useState<PdfTextSpan[]>([]);
  const [pageSize, setPageSize] = useState({ width: 0, height: 0 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [globalSearchMatches, setGlobalSearchMatches] = useState<PdfGlobalSearchMatch[]>([]);
  const [globalSearchTerm, setGlobalSearchTerm] = useState("");
  const highlightTerms = useMemo(() => getViewerManualHighlightTerms(highlightNotes), [highlightNotes]);
  const normalizedSearchTerm = normalizeForSearch(searchTerm);
  const searchOffset = useMemo(() => getPdfSearchOffset(globalSearchMatches, page), [globalSearchMatches, page]);
  const searchPlan = useMemo(() => buildPdfSearchPlan(spans, normalizedSearchTerm, searchOffset), [normalizedSearchTerm, searchOffset, spans]);

  useEffect(() => {
    if (!normalizedSearchTerm) {
      setGlobalSearchMatches([]);
      setGlobalSearchTerm("");
      setSearchError("");
      setSearchLoading(false);
      onSearchStats(0);
      return;
    }

    let active = true;
    setSearchLoading(true);
    setSearchError("");
    setGlobalSearchTerm(normalizedSearchTerm);
    setGlobalSearchMatches([]);

    async function collectPdfMatches() {
      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
        const response = await fetch(resource.url);
        if (!response.ok) throw new Error("Não foi possível carregar o PDF para pesquisar todas as páginas.");
        const bytes = await response.arrayBuffer();
        const document = await pdfjs.getDocument({ data: new Uint8Array(bytes) }).promise;
        if (active) onPageCount(document.numPages);

        const matches: PdfGlobalSearchMatch[] = [];
        for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
          if (!active) return;
          const pdfPage = await document.getPage(pageNumber);
          const textContent = await pdfPage.getTextContent();
          const matchCount = countPdfTextContentMatches(textContent.items as PdfTextRawItem[], normalizedSearchTerm);

          for (let matchNumber = 0; matchNumber < matchCount; matchNumber += 1) {
            matches.push({ page: pageNumber, globalIndex: matches.length });
          }
        }

        if (!active) return;
        setGlobalSearchMatches(matches);
        onSearchStats(matches.length);
        if (matches.length) onRequestPage(matches[0].page);
      } catch (searchErrorValue) {
        if (!active) return;
        setSearchError(getErrorMessage(searchErrorValue));
        setGlobalSearchMatches([]);
        onSearchStats(0);
      } finally {
        if (active) setSearchLoading(false);
      }
    }

    collectPdfMatches();

    return () => {
      active = false;
    };
  }, [normalizedSearchTerm, onPageCount, onRequestPage, onSearchStats, resource.url]);

  useEffect(() => {
    if (!normalizedSearchTerm) return;
    const activeMatch = globalSearchMatches[searchIndex];
    if (activeMatch && activeMatch.page !== page) {
      onRequestPage(activeMatch.page);
      return;
    }

    const target = containerRef.current?.querySelector(`[data-search-index="${searchIndex}"]`);
    target?.scrollIntoView({ block: "center", inline: "center", behavior: "smooth" });
  }, [globalSearchMatches, normalizedSearchTerm, onRequestPage, page, searchIndex]);

  useEffect(() => {
    let active = true;
    let cancelled = false;

    async function renderPdf() {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const previousRenderTask = renderTaskRef.current;
      if (previousRenderTask) {
        previousRenderTask.cancel();
        renderTaskRef.current = null;
        try {
          await previousRenderTask.promise;
        } catch {
          // Expected when PDF.js cancels an in-flight render before redrawing zoom/page.
        }
        if (!active) return;
      }
      setLoading(true);
      setError("");
      setSpans([]);
      setPageSize({ width: 0, height: 0 });

      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
        const response = await fetch(resource.url);
        if (!response.ok) throw new Error("Não foi possível carregar o PDF para estudo interno.");
        const bytes = await response.arrayBuffer();
        const document = await pdfjs.getDocument({ data: new Uint8Array(bytes) }).promise;
        if (!active || cancelled) return;
        if (active) onPageCount(document.numPages);
        const safePage = Math.min(Math.max(1, page), document.numPages);
        const pdfPage = await document.getPage(safePage);
        if (!active || cancelled) return;
        const scale = Math.max(0.6, Math.min(2.4, zoom / 100)) * 1.35;
        const viewport = pdfPage.getViewport({ scale });
        const context = canvas.getContext("2d");
        const textLayerElement = textLayerRef.current;
        if (!context) throw new Error("Canvas indisponível para renderizar PDF.");
        if (!active || cancelled) return;

        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;
        if (active) setPageSize({ width: Math.floor(viewport.width), height: Math.floor(viewport.height) });

        const renderTask = pdfPage.render({ canvasContext: context, viewport });
        renderTaskRef.current = renderTask;
        await renderTask.promise;
        if (renderTaskRef.current === renderTask) renderTaskRef.current = null;
        if (!active || cancelled) return;
        const textContent = await pdfPage.getTextContent();
        if (textLayerElement) {
          textLayerElement.innerHTML = "";
          textLayerElement.style.width = `${Math.floor(viewport.width)}px`;
          textLayerElement.style.height = `${Math.floor(viewport.height)}px`;
          textLayerElement.style.setProperty("--scale-factor", String(scale));
          let nextSpans: PdfTextSpan[] = [];
          try {
            const textLayer = new pdfjs.TextLayer({
              container: textLayerElement,
              textContentSource: textContent,
              viewport
            });
            await textLayer.render();

            nextSpans = textLayer.textDivs
              .map((element: HTMLElement, index: number) => {
                const text = textLayer.textContentItemsStr[index] || element.textContent || "";
                const id = `${safePage}-${index}`;
                element.dataset.pdfTextIndex = id;
                return { id, text };
              })
              .filter((span: PdfTextSpan) => span.text.trim());
          } catch {
            nextSpans = [];
          }

          if (!nextSpans.length) {
            nextSpans = renderManualPdfTextLayer(
              pdfjs as PdfJsLike,
              textLayerElement,
              textContent.items as PdfTextRawItem[],
              viewport as PdfViewportLike,
              safePage
            );
          }

          if (active) setSpans(nextSpans);
        }
      } catch (renderError) {
        if (active && !isPdfRenderCancelled(renderError)) setError(getErrorMessage(renderError));
      } finally {
        renderTaskRef.current = null;
        if (active) setLoading(false);
      }
    }

    renderPdf();

    return () => {
      active = false;
      cancelled = true;
      renderTaskRef.current?.cancel();
      renderTaskRef.current = null;
    };
  }, [onPageCount, page, resource.url, zoom]);

  useEffect(() => {
    const layer = textLayerRef.current;
    if (!layer) return;

    for (const element of Array.from(layer.querySelectorAll<HTMLElement>("[data-pdf-text-index]"))) {
      element.classList.remove("pdf-text-span--highlighted", "pdf-text-span--search", "pdf-text-span--search-active");
    }

    for (const span of spans) {
      const element = layer.querySelector<HTMLElement>(`[data-pdf-text-index="${span.id}"]`);
      if (!element) continue;

      const matchIndex = searchPlan.indexesBySpanId.get(span.id);
      if (isTextHighlightedByTerms(span.text, highlightTerms)) element.classList.add("pdf-text-span--highlighted");
      if (matchIndex !== undefined) {
        element.classList.add("pdf-text-span--search");
        element.dataset.searchIndex = String(matchIndex);
      } else {
        delete element.dataset.searchIndex;
      }
      if (matchIndex === searchIndex) element.classList.add("pdf-text-span--search-active");
    }
  }, [highlightTerms, searchIndex, searchPlan, spans]);

  function handleSelection() {
    const selection = window.getSelection();
    const selectedText = selection?.toString().trim() || "";
    const anchorNode = selection?.anchorNode;
    if (selectedText && anchorNode && containerRef.current?.contains(anchorNode)) {
      onSelectText(selectedText);
    }
  }

  return (
    <div className="internal-doc-viewer" onMouseUp={handleSelection} ref={containerRef}>
      {loading ? <div className="document-preview-banner">Renderizando PDF para estudo interno...</div> : null}
      {searchLoading ? <div className="document-preview-banner">Pesquisando em todas as páginas do PDF...</div> : null}
      {searchError && globalSearchTerm === normalizedSearchTerm ? (
        <div className="document-preview-banner document-preview-banner--error">{searchError}</div>
      ) : null}
      {error ? (
        <div className="document-preview-fallback">
          <FileArchive size={38} />
          <h3>PDF não renderizado internamente</h3>
          <p>{error}</p>
          <a href={resource.url} rel="noreferrer" target="_blank">
            <Link2 size={15} />
            Abrir em nova aba
          </a>
        </div>
      ) : (
        <div className="pdf-page-shell">
          <div className="pdf-page-content" style={{ width: pageSize.width || undefined, height: pageSize.height || undefined }}>
            <canvas ref={canvasRef} />
            <div className="pdf-text-layer textLayer" ref={textLayerRef} />
          </div>
          {!loading && !spans.length ? (
            <div className="document-preview-banner document-preview-banner--floating">
              Não foi encontrada camada de texto neste PDF. Para grifar trechos, use OCR ou uma versão pesquisável do arquivo.
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

export function InternalDocxViewer({
  highlightNotes,
  onSearchStats,
  onSelectText,
  resource,
  searchIndex,
  searchTerm
}: {
  highlightNotes: FileViewerNote[];
  onSearchStats: (total: number) => void;
  onSelectText: (text: string) => void;
  resource: FileResource;
  searchIndex: number;
  searchTerm: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [html, setHtml] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const highlightTerms = useMemo(() => getViewerManualHighlightTerms(highlightNotes), [highlightNotes]);
  const markedContent = useMemo(() => markHtmlWithTerms(html, highlightTerms, searchTerm), [highlightTerms, html, searchTerm]);

  useEffect(() => {
    onSearchStats(markedContent.searchCount);
  }, [markedContent.searchCount, onSearchStats]);

  useEffect(() => {
    const root = containerRef.current;
    if (!root || !markedContent.searchCount) return;

    root.querySelectorAll(".doc-search-highlight--active").forEach((element) => element.classList.remove("doc-search-highlight--active"));
    const target = root.querySelector(`[data-search-index="${searchIndex}"]`);
    target?.classList.add("doc-search-highlight--active");
    target?.scrollIntoView({ block: "center", inline: "center", behavior: "smooth" });
  }, [markedContent.html, markedContent.searchCount, searchIndex]);

  useEffect(() => {
    let active = true;

    async function renderDocx() {
      setLoading(true);
      setError("");
      setHtml("");

      try {
        const mammothModule = await import("mammoth");
        const mammothLib = mammothModule.default;
        const response = await fetch(resource.url);
        if (!response.ok) throw new Error("Não foi possível carregar o DOCX para estudo interno.");
        const arrayBuffer = await response.arrayBuffer();
        const result = await mammothLib.convertToHtml(
          { arrayBuffer },
          {
            convertImage: mammothLib.images.dataUri,
            ignoreEmptyParagraphs: false
          }
        );
        if (active) setHtml(result.value || "<p>Documento sem texto convertido.</p>");
      } catch (renderError) {
        if (active) setError(getErrorMessage(renderError));
      } finally {
        if (active) setLoading(false);
      }
    }

    renderDocx();

    return () => {
      active = false;
    };
  }, [resource.url]);

  function handleSelection() {
    const selection = window.getSelection();
    const selectedText = selection?.toString().trim() || "";
    const anchorNode = selection?.anchorNode;
    if (selectedText && anchorNode && containerRef.current?.contains(anchorNode)) {
      onSelectText(selectedText);
    }
  }

  if (error) {
    return (
      <div className="document-preview-fallback">
        <FileArchive size={38} />
        <h3>DOCX não convertido internamente</h3>
        <p>{error}</p>
        <a href={resource.url} rel="noreferrer" target="_blank">
          <Link2 size={15} />
          Abrir em nova aba
        </a>
      </div>
    );
  }

  return (
    <div className="internal-doc-viewer internal-doc-viewer--docx" onMouseUp={handleSelection} ref={containerRef}>
      {loading ? <div className="document-preview-banner">Convertendo DOCX para estudo interno...</div> : null}
      <article className="docx-rendered" dangerouslySetInnerHTML={{ __html: markedContent.html }} />
    </div>
  );
}
