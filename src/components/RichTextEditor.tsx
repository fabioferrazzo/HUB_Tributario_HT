import { Bold as BoldIcon, Highlighter, Italic as ItalicIcon, List as ListIcon, ListOrdered, RemoveFormatting, Underline as UnderlineIcon } from "lucide-react";
import { CSSProperties, useEffect, useRef, useState } from "react";
import { PAUTA_HIGHLIGHT_COLOR, type PautaInlineSize, detectPautaInlineSize, findRichElementsInRange, getRichSelectionRange, isHighlightElement, isRichFormattingElement, pautaInlineSizes, removeHighlightFromElements, sanitizePautaRichHtml, unwrapElement } from "../lib/richText";

export type RichTextEditorProps = {
  value: string;
  onChange: (html: string) => void;
  resetKey: string | number;
  ariaLabel: string;
  label?: string;
  placeholder?: string;
  editorStyle?: CSSProperties;
};

// Editor de texto com formatacao por trecho (Pautas e Quadro de Avisos).
export function RichTextEditor({ value, onChange, resetKey, ariaLabel, label, placeholder, editorStyle }: RichTextEditorProps) {
  const editorRef = useRef<HTMLDivElement | null>(null);
  const selectionRef = useRef<Range | null>(null);
  const valueRef = useRef(value);
  valueRef.current = value;
  const [textSize, setTextSize] = useState<PautaInlineSize>("normal");
  const [isBold, setIsBold] = useState(false);
  const [isItalic, setIsItalic] = useState(false);
  const [isUnderline, setIsUnderline] = useState(false);
  const [isHighlight, setIsHighlight] = useState(false);
  const [listState, setListState] = useState<"" | "ul" | "ol">("");
  const [hint, setHint] = useState("");

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.innerHTML = sanitizePautaRichHtml(valueRef.current);
    selectionRef.current = null;
    setTextSize("normal");
    setIsBold(false);
    setIsItalic(false);
    setIsUnderline(false);
    setIsHighlight(false);
    setListState("");
    setHint("");
  }, [resetKey]);

  function rememberSelection() {
    const editor = editorRef.current;
    const selection = window.getSelection();
    if (!editor || !selection || selection.rangeCount === 0) return;
    const anchor = selection.anchorNode;
    const focus = selection.focusNode;
    if ((anchor && editor.contains(anchor)) || (focus && editor.contains(focus))) {
      selectionRef.current = selection.getRangeAt(0).cloneRange();
    }
  }

  function restoreSelection() {
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();
    const selection = window.getSelection();
    if (!selection) return;
    selection.removeAllRanges();
    if (selectionRef.current && editor.contains(selectionRef.current.commonAncestorContainer)) {
      selection.addRange(selectionRef.current);
      return;
    }
    const range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
    selection.addRange(range);
    selectionRef.current = range.cloneRange();
  }

  function emitChange() {
    const editor = editorRef.current;
    if (!editor) return;
    onChange(sanitizePautaRichHtml(editor.innerHTML));
    rememberSelection();
  }

  function updateFormatState() {
    const editor = editorRef.current;
    if (!editor) return;
    const range = getRichSelectionRange(editor);
    if (!range) return;
    setIsBold(document.queryCommandState("bold"));
    setIsItalic(document.queryCommandState("italic"));
    setIsUnderline(document.queryCommandState("underline"));
    setIsHighlight(findRichElementsInRange(editor, range, isHighlightElement).length > 0);
    setTextSize(detectPautaInlineSize(editor, range.startContainer));
    setListState(
      document.queryCommandState("insertOrderedList") ? "ol" : document.queryCommandState("insertUnorderedList") ? "ul" : ""
    );
  }

  function handleSelection() {
    rememberSelection();
    updateFormatState();
  }

  function handleInput() {
    emitChange();
    setHint("");
  }

  function applyTextSize(nextSize: PautaInlineSize) {
    const size = pautaInlineSizes.find((item) => item.value === nextSize);
    if (!size) return;
    setTextSize(nextSize);
    restoreSelection();
    document.execCommand("styleWithCSS", false, "false");
    document.execCommand("fontSize", false, size.exec);
    emitChange();
    setHint(window.getSelection()?.isCollapsed ? "O novo tamanho vale para o texto digitado a partir do cursor." : "");
  }

  function applyCommand(command: "bold" | "italic" | "underline" | "insertUnorderedList" | "insertOrderedList") {
    restoreSelection();
    document.execCommand(command);
    emitChange();
    updateFormatState();
    setHint("");
  }

  function toggleHighlight() {
    const editor = editorRef.current;
    if (!editor) return;
    restoreSelection();
    const range = getRichSelectionRange(editor);
    if (!range) return;

    const highlighted = findRichElementsInRange(editor, range, isHighlightElement);
    if (highlighted.length) {
      removeHighlightFromElements(highlighted);
    } else if (range.collapsed) {
      setHint("Selecione o trecho que deseja grifar.");
      return;
    } else {
      const applied = document.execCommand("hiliteColor", false, PAUTA_HIGHLIGHT_COLOR);
      if (!applied) document.execCommand("backColor", false, PAUTA_HIGHLIGHT_COLOR);
    }

    setHint("");
    emitChange();
    updateFormatState();
  }

  function clearFormatting() {
    const editor = editorRef.current;
    if (!editor) return;
    restoreSelection();
    const range = getRichSelectionRange(editor);
    if (!range || range.collapsed) {
      setHint("Selecione o trecho cuja formatação deseja remover.");
      return;
    }

    document.execCommand("removeFormat");
    const after = getRichSelectionRange(editor);
    if (after) {
      removeHighlightFromElements(findRichElementsInRange(editor, after, isHighlightElement));
      findRichElementsInRange(editor, after, isRichFormattingElement).forEach(unwrapElement);
    }

    setHint("");
    emitChange();
    updateFormatState();
  }

  // Botoes agem no mousedown para nao tirar a selecao do texto; o clique por teclado (detail 0) tambem funciona.
  const toolbarButtonHandlers = (action: () => void) => ({
    onClick: (event: React.MouseEvent<HTMLButtonElement>) => {
      if (event.detail === 0) action();
    },
    onMouseDown: (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      action();
    }
  });

  return (
    <div className="rich-editor-field">
      {label ? <span>{label}</span> : null}
      <div className="pauta-format-toolbar" role="toolbar" aria-label={`Formatação: ${ariaLabel}`}>
        <label className="pauta-format-size">
          <span className="sr-only">Tamanho da fonte</span>
          <select
            aria-label="Tamanho da fonte"
            title="Tamanho da fonte do trecho selecionado"
            value={textSize}
            onMouseDown={rememberSelection}
            onChange={(event) => applyTextSize(event.target.value as PautaInlineSize)}
          >
            {pautaInlineSizes.map((size) => (
              <option key={size.value} value={size.value}>
                {size.label}
              </option>
            ))}
          </select>
        </label>
        <span aria-hidden="true" className="pauta-format-divider" />
        {(
          [
            { command: "bold", title: "Negrito (Ctrl+B)", Icon: BoldIcon, active: isBold },
            { command: "italic", title: "Itálico (Ctrl+I)", Icon: ItalicIcon, active: isItalic },
            { command: "underline", title: "Sublinhado (Ctrl+U)", Icon: UnderlineIcon, active: isUnderline }
          ] as const
        ).map(({ command, title, Icon, active }) => (
          <button
            aria-label={title}
            aria-pressed={active}
            className={active ? "active" : ""}
            key={command}
            title={title}
            type="button"
            {...toolbarButtonHandlers(() => applyCommand(command))}
          >
            <Icon size={15} strokeWidth={1.8} />
          </button>
        ))}
        <button
          aria-label={isHighlight ? "Remover grifo" : "Grifo amarelo"}
          aria-pressed={isHighlight}
          className={isHighlight ? "highlight-active" : ""}
          title={isHighlight ? "Remover grifo do trecho" : "Grifo amarelo no trecho selecionado"}
          type="button"
          {...toolbarButtonHandlers(toggleHighlight)}
        >
          <Highlighter size={15} strokeWidth={1.8} />
        </button>
        <span aria-hidden="true" className="pauta-format-divider" />
        {(
          [
            { command: "insertUnorderedList", title: "Lista com marcadores", Icon: ListIcon, active: listState === "ul" },
            { command: "insertOrderedList", title: "Lista numerada", Icon: ListOrdered, active: listState === "ol" }
          ] as const
        ).map(({ command, title, Icon, active }) => (
          <button
            aria-label={title}
            aria-pressed={active}
            className={active ? "active" : ""}
            key={command}
            title={title}
            type="button"
            {...toolbarButtonHandlers(() => applyCommand(command))}
          >
            <Icon size={15} strokeWidth={1.8} />
          </button>
        ))}
        <span aria-hidden="true" className="pauta-format-divider" />
        <button
          aria-label="Limpar formatação"
          title="Limpar formatação do trecho selecionado"
          type="button"
          {...toolbarButtonHandlers(clearFormatting)}
        >
          <RemoveFormatting size={15} strokeWidth={1.8} />
        </button>
      </div>
      <div
        aria-label={ariaLabel}
        className="pauta-description-input pauta-rich-text"
        contentEditable
        data-placeholder={placeholder}
        onBlur={rememberSelection}
        onInput={handleInput}
        onKeyUp={handleSelection}
        onMouseUp={handleSelection}
        ref={editorRef}
        role="textbox"
        aria-multiline="true"
        style={editorStyle}
        suppressContentEditableWarning
      />
      {hint ? <small className="pauta-format-hint">{hint}</small> : null}
    </div>
  );
}
