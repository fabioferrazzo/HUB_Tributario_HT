import type { Pauta } from "../types";
import { escapeHtmlText } from "./reportExport";

export const pautaTextSizeClassMap: Record<NonNullable<Pauta["textSize"]>, string> = {
  pequena: "pauta-text-small",
  normal: "pauta-text-normal",
  grande: "pauta-text-large"
};

export type PautaInlineSize = "pequena" | "normal" | "grande" | "muito-grande" | "titulo";

export const pautaInlineSizes: Array<{ value: PautaInlineSize; label: string; exec: string; className: string }> = [
  { value: "pequena", label: "Pequena", exec: "2", className: "pauta-text-small" },
  { value: "normal", label: "Normal", exec: "3", className: "pauta-text-normal" },
  { value: "grande", label: "Grande", exec: "4", className: "pauta-text-large" },
  { value: "muito-grande", label: "Muito grande", exec: "5", className: "pauta-text-xlarge" },
  { value: "titulo", label: "Título", exec: "6", className: "pauta-text-title" }
];

export const pautaAllowedTextSizeClasses = new Set(pautaInlineSizes.map((size) => size.className));

export const PAUTA_HIGHLIGHT_COLOR = "#fff3a3";

export function isHighlightElement(element: Element) {
  if (element.tagName === "MARK") return true;
  if (!(element instanceof HTMLElement)) return false;
  const background = (element.style.backgroundColor || "").replace(/\s/g, "").toLowerCase();
  return Boolean(background) && !["transparent", "rgba(0,0,0,0)", "initial", "inherit", "unset"].includes(background);
}

export function isRichFormattingElement(element: Element) {
  if (["FONT", "MARK", "STRONG", "B", "EM", "I", "U"].includes(element.tagName)) return true;
  return element.tagName === "SPAN" && Array.from(element.classList).some((item) => pautaAllowedTextSizeClasses.has(item));
}

export function unwrapElement(element: Element) {
  const parent = element.parentNode;
  if (!parent) return;
  while (element.firstChild) parent.insertBefore(element.firstChild, element);
  parent.removeChild(element);
}

export function removeHighlightFromElements(elements: Element[]) {
  elements.forEach((element) => {
    if (!element.isConnected) return;
    if (element.tagName === "MARK") {
      unwrapElement(element);
      return;
    }
    if (!(element instanceof HTMLElement)) return;
    element.style.removeProperty("background-color");
    element.style.removeProperty("background");
    if (element.tagName === "SPAN" && !(element.getAttribute("style") || "").trim() && !element.className) {
      unwrapElement(element);
    }
  });
}

export function getRichSelectionRange(root: HTMLElement) {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  return root.contains(range.commonAncestorContainer) ? range : null;
}

export function findRichElementsInRange(root: HTMLElement, range: Range, matcher: (element: Element) => boolean) {
  const found = new Set<Element>();
  [range.startContainer, range.endContainer].forEach((node) => {
    let current: Node | null = node instanceof Element ? node : node.parentNode;
    while (current && current !== root) {
      if (current instanceof Element && matcher(current)) found.add(current);
      current = current.parentNode;
    }
  });

  if (!range.collapsed) {
    root.querySelectorAll("*").forEach((element) => {
      if (!matcher(element)) return;
      const elementRange = document.createRange();
      elementRange.selectNodeContents(element);
      const endsAfterStart = range.compareBoundaryPoints(Range.START_TO_END, elementRange) === 1;
      const startsBeforeEnd = range.compareBoundaryPoints(Range.END_TO_START, elementRange) === -1;
      if (endsAfterStart && startsBeforeEnd) found.add(element);
    });
  }

  return Array.from(found);
}

export function detectPautaInlineSize(root: HTMLElement, node: Node): PautaInlineSize {
  let current: Node | null = node instanceof Element ? node : node.parentNode;
  while (current && current !== root) {
    if (current instanceof HTMLElement) {
      const element = current;
      if (element.tagName === "FONT" && element.getAttribute("size")) {
        const className = getPautaFontClassFromLegacySize(element.getAttribute("size"));
        return pautaInlineSizes.find((size) => size.className === className)?.value || "normal";
      }
      const match = pautaInlineSizes.find((size) => element.classList.contains(size.className));
      if (match) return match.value;
    }
    current = current.parentNode;
  }
  return "normal";
}

// Pautas antigas guardavam negrito, italico e tamanho para o texto inteiro.
// Ao editar, essa formatacao vira formatacao do proprio texto, que pode ser desfeita.
export function convertLegacyPautaFormatting(pauta: Pauta) {
  let html = sanitizePautaRichHtml(pauta.acoes || pauta.pendenciasObs || "");
  if (!html) return "";
  if (pauta.textSize && pauta.textSize !== "normal") html = `<span class="${pautaTextSizeClassMap[pauta.textSize]}">${html}</span>`;
  if (pauta.textItalic) html = `<em>${html}</em>`;
  if (pauta.textBold) html = `<strong>${html}</strong>`;
  return html;
}

export function sanitizePautaRichHtml(value: string) {
  const source = String(value || "");
  if (!source.trim()) return "";
  if (typeof document === "undefined") {
    return escapeHtmlText(stripHtmlTagsForPauta(source)).replace(/\n/g, "<br>");
  }

  const template = document.createElement("template");
  const hasHtml = /<\/?[a-z][\s\S]*>/i.test(source);
  template.innerHTML = hasHtml ? source : escapeHtmlText(source).replace(/\n/g, "<br>");
  const output = document.createElement("div");

  const appendCleanChildren = (node: Node, parent: Node) => {
    Array.from(node.childNodes).forEach((child) => appendCleanNode(child, parent));
  };

  const appendCleanNode = (node: Node, parent: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      parent.appendChild(document.createTextNode(node.textContent || ""));
      return;
    }

    if (!(node instanceof HTMLElement)) return;

    const tagName = node.tagName.toLowerCase();

    if (tagName === "br") {
      parent.appendChild(document.createElement("br"));
      return;
    }

    if (tagName === "b" || tagName === "strong") {
      const strong = document.createElement("strong");
      appendCleanChildren(node, strong);
      parent.appendChild(strong);
      return;
    }

    if (tagName === "i" || tagName === "em") {
      const emphasis = document.createElement("em");
      appendCleanChildren(node, emphasis);
      parent.appendChild(emphasis);
      return;
    }

    if (tagName === "mark" || hasYellowBackground(node)) {
      const mark = document.createElement("mark");
      appendCleanChildren(node, mark);
      parent.appendChild(mark);
      return;
    }

    if (tagName === "font") {
      const span = document.createElement("span");
      span.className = getPautaFontClassFromLegacySize(node.getAttribute("size"));
      appendCleanChildren(node, span);
      parent.appendChild(span);
      return;
    }

    if (tagName === "span") {
      const className = Array.from(node.classList).find((item) => pautaAllowedTextSizeClasses.has(item));
      if (className) {
        const span = document.createElement("span");
        span.className = className;
        appendCleanChildren(node, span);
        parent.appendChild(span);
        return;
      }
    }

    if (tagName === "u") {
      const underline = document.createElement("u");
      appendCleanChildren(node, underline);
      parent.appendChild(underline);
      return;
    }

    if (tagName === "ul" || tagName === "ol") {
      const list = document.createElement(tagName);
      Array.from(node.childNodes).forEach((child) => {
        if (child instanceof HTMLElement && child.tagName.toLowerCase() === "li") {
          const item = document.createElement("li");
          appendCleanChildren(child, item);
          list.appendChild(item);
        } else if ((child.textContent || "").trim()) {
          const item = document.createElement("li");
          appendCleanNode(child, item);
          list.appendChild(item);
        }
      });
      if (list.childNodes.length) parent.appendChild(list);
      return;
    }

    if (tagName === "li") {
      appendCleanChildren(node, parent);
      parent.appendChild(document.createElement("br"));
      return;
    }

    if (tagName === "div" || tagName === "p") {
      appendCleanChildren(node, parent);
      parent.appendChild(document.createElement("br"));
      return;
    }

    appendCleanChildren(node, parent);
  };

  appendCleanChildren(template.content, output);
  return output.innerHTML.replace(/(<br>\s*){3,}/g, "<br><br>").replace(/(<br>\s*)+$/g, "").trim();
}

export function hasYellowBackground(element: HTMLElement) {
  const background = `${element.style.backgroundColor} ${element.style.background}`.toLowerCase();
  return background.includes("255, 243, 163") || background.includes("255, 248") || background.includes("yellow") || background.includes("#fff3a3");
}

export function getPautaFontClassFromLegacySize(size: string | null) {
  if (size === "1" || size === "2") return "pauta-text-small";
  if (size === "4") return "pauta-text-large";
  if (size === "5") return "pauta-text-xlarge";
  if (size === "6" || size === "7") return "pauta-text-title";
  return "pauta-text-normal";
}

export function pautaRichTextToPlain(value: string) {
  const source = String(value || "");
  if (!source.trim()) return "";
  if (typeof document === "undefined") return stripHtmlTagsForPauta(source);

  const container = document.createElement("div");
  container.innerHTML = sanitizePautaRichHtml(source);
  container.querySelectorAll("ol").forEach((list) => Array.from(list.children).forEach((item, index) => item.prepend(`${index + 1}. `)));
  container.querySelectorAll("ul > li").forEach((item) => item.prepend("• "));
  container.querySelectorAll("li").forEach((item) => item.append("\n"));
  container.querySelectorAll("br").forEach((br) => br.replaceWith("\n"));
  return (container.textContent || "").replace(/\n{3,}/g, "\n\n").trim();
}

export function stripHtmlTagsForPauta(value: string) {
  return String(value || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .trim();
}

export function hasPautaRichContent(value: string) {
  return pautaRichTextToPlain(value).trim().length > 0;
}

export function renderPautaRichHtmlForEmail(value: string) {
  return sanitizePautaRichHtml(value || "Sem ação registrada")
    .replace(/<span class="pauta-text-small">/g, '<span style="font-size:12pt;">')
    .replace(/<span class="pauta-text-normal">/g, '<span style="font-size:14pt;">')
    .replace(/<span class="pauta-text-large">/g, '<span style="font-size:16pt;">')
    .replace(/<span class="pauta-text-xlarge">/g, '<span style="font-size:20pt;">')
    .replace(/<span class="pauta-text-title">/g, '<span style="font-size:24pt;">')
    .replace(/<mark>/g, '<mark style="background:#fff3a3;padding:0 2px;border-radius:3px;">');
}
