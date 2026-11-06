import type { PomodoroArchivedNote } from "../app/appTypes";
import { findRichElementsInRange, getRichSelectionRange, isHighlightElement, removeHighlightFromElements } from "../lib/richText";
import { formatPomodoroArchiveDate, savePomodoroNotes } from "../lib/pomodoroNotes";
import { useEffect, useRef, useState } from "react";

export function PomodoroFloatingNotes({
  archivedNotes,
  notes,
  open,
  status,
  onArchive,
  onChange,
  onClose,
  onDeleteArchived,
  onOpenArchived,
  onSave,
  onSaveArchived
}: {
  archivedNotes: PomodoroArchivedNote[];
  notes: string;
  open: boolean;
  status: string;
  onArchive: (notes?: string) => void;
  onChange: (notes: string) => void;
  onClose: (notes?: string) => void;
  onDeleteArchived: (noteId: string) => void;
  onOpenArchived: (note: PomodoroArchivedNote) => void;
  onSave: (notes?: string) => void;
  onSaveArchived: (noteId: string, notes?: string) => void;
}) {
  const editorRef = useRef<HTMLDivElement | null>(null);
  const dragStartRef = useRef<{ pointerId: number; x: number; y: number; left: number; top: number } | null>(null);
  const draftRef = useRef(notes);
  const [minimized, setMinimized] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [activeArchiveId, setActiveArchiveId] = useState<string | null>(null);
  const [position, setPosition] = useState(() => ({ left: Math.max(16, window.innerWidth - 460), top: Math.max(16, window.innerHeight - 560) }));

  useEffect(() => {
    if (!open || !editorRef.current) return;
    if (notes !== draftRef.current && editorRef.current.innerHTML !== notes) {
      draftRef.current = notes;
      editorRef.current.innerHTML = notes;
    }
  }, [notes, open]);

  if (!open) return null;

  function startDrag(event: React.PointerEvent<HTMLElement>) {
    const target = event.target as HTMLElement;
    if (target.closest("button,input,select,textarea,[contenteditable='true']")) return;
    dragStartRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      left: position.left,
      top: position.top
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveDrag(event: React.PointerEvent<HTMLElement>) {
    const drag = dragStartRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    const width = minimized ? 280 : Math.min(420, window.innerWidth - 32);
    const height = minimized ? 58 : Math.min(520, window.innerHeight - 48);
    const nextLeft = Math.min(Math.max(8, drag.left + event.clientX - drag.x), Math.max(8, window.innerWidth - width - 8));
    const nextTop = Math.min(Math.max(8, drag.top + event.clientY - drag.y), Math.max(8, window.innerHeight - height - 8));
    setPosition({ left: nextLeft, top: nextTop });
  }

  function stopDrag(event: React.PointerEvent<HTMLElement>) {
    const drag = dragStartRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragStartRef.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function commitEditorDraft() {
    const nextNotes = editorRef.current ? editorRef.current.innerHTML : notes;
    draftRef.current = nextNotes;
    onChange(nextNotes);
    savePomodoroNotes(nextNotes);
    return nextNotes;
  }

  function runEditorCommand(command: string, value?: string) {
    editorRef.current?.focus();
    document.execCommand(command, false, value);
    commitEditorDraft();
  }

  function togglePomodoroHighlight() {
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();
    const range = getRichSelectionRange(editor);
    if (!range) return;
    const highlighted = findRichElementsInRange(editor, range, isHighlightElement);
    if (highlighted.length) {
      removeHighlightFromElements(highlighted);
    } else if (!range.collapsed) {
      document.execCommand("backColor", false, "#fff4a8");
    }
    commitEditorDraft();
  }

  function handleArchivedOpen(note: PomodoroArchivedNote) {
    setActiveArchiveId(note.id);
    setArchiveOpen(false);
    onOpenArchived(note);
  }

  return (
    <section
      className={`pomodoro-floating-notes ${minimized ? "pomodoro-floating-notes--minimized" : ""}`}
      style={{ left: position.left, top: position.top }}
      aria-label="Anotacoes flutuantes do Pomodoro"
    >
      <header
        className="pomodoro-floating-notes__header"
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onPointerUp={stopDrag}
        onPointerCancel={stopDrag}
      >
        <div>
          <strong>Anotacoes</strong>
          <span>Pomodoro</span>
        </div>
        <div className="pomodoro-floating-notes__actions">
          {!minimized ? (
            <button type="button" onClick={() => setArchiveOpen((current) => !current)}>
              Arquivo
            </button>
          ) : null}
          {!minimized ? (
            <button
              type="button"
              onClick={() => {
                const nextNotes = commitEditorDraft();
                onSave(nextNotes);
              }}
            >
              Salvar
            </button>
          ) : null}
          {!minimized ? (
            <button
              type="button"
              onClick={() => {
                const nextNotes = commitEditorDraft();
                onArchive(nextNotes);
              }}
            >
              Arquivar
            </button>
          ) : null}
          {!minimized && activeArchiveId ? (
            <button
              type="button"
              onClick={() => {
                const nextNotes = commitEditorDraft();
                onSaveArchived(activeArchiveId, nextNotes);
              }}
            >
              Salvar edicao
            </button>
          ) : null}
          <button
              type="button"
              className="pomodoro-floating-notes__icon-action"
              aria-label={minimized ? "Restaurar anotacoes" : "Minimizar anotacoes"}
              title={minimized ? "Restaurar" : "Minimizar"}
              onClick={() => {
                const nextNotes = commitEditorDraft();
                onSave(nextNotes);
                setMinimized((current) => !current);
            }}
          >
            {minimized ? "+" : "_"}
          </button>
          <button
              type="button"
              className="pomodoro-floating-notes__icon-action"
              aria-label="Fechar anotacoes"
              title="Fechar"
              onClick={() => {
                const nextNotes = commitEditorDraft();
                onClose(nextNotes);
              }}
            >
            <span aria-hidden="true">x</span>
          </button>
        </div>
      </header>
      <div className="pomodoro-floating-notes__body" aria-hidden={minimized}>
        <div className="pomodoro-floating-notes__toolbar" aria-label="Formatacao das anotacoes">
            <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => runEditorCommand("bold")}>
              B
            </button>
            <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => runEditorCommand("italic")}>
              I
            </button>
            <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => runEditorCommand("strikeThrough")}>
              S
            </button>
            <button
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={togglePomodoroHighlight}
            >
              Grifo
            </button>
            <label>
              Cor
              <input
                aria-label="Cor do texto"
                type="color"
                defaultValue="#000000"
                onChange={(event) => runEditorCommand("foreColor", event.target.value)}
              />
            </label>
            <select aria-label="Tamanho da fonte" defaultValue="3" onChange={(event) => runEditorCommand("fontSize", event.target.value)}>
              <option value="2">Pequeno</option>
              <option value="3">Normal</option>
              <option value="4">Grande</option>
              <option value="5">Muito grande</option>
              <option value="6">Título</option>
            </select>
        </div>
        {archiveOpen ? (
          <div className="pomodoro-floating-notes__archive">
            <strong>Arquivo de notas</strong>
            {archivedNotes.length ? (
              <div className="pomodoro-floating-notes__archive-list">
                {archivedNotes.map((note) => (
                  <article key={note.id}>
                    <div>
                      <strong>{note.title}</strong>
                      <span>{formatPomodoroArchiveDate(note.updatedAt)}</span>
                    </div>
                    <div>
                      <button type="button" onClick={() => handleArchivedOpen(note)}>
                        Abrir
                      </button>
                      <button type="button" onClick={() => onDeleteArchived(note.id)}>
                        Excluir
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <p>Nenhuma anotacao arquivada.</p>
            )}
          </div>
        ) : null}
        <div
          className="pomodoro-floating-notes__editor"
          contentEditable
          ref={editorRef}
          suppressContentEditableWarning
          onInput={(event) => {
            const nextNotes = event.currentTarget.innerHTML;
            draftRef.current = nextNotes;
            onChange(nextNotes);
            savePomodoroNotes(nextNotes);
          }}
          onBlur={(event) => {
            const nextNotes = event.currentTarget.innerHTML;
            draftRef.current = nextNotes;
            onChange(nextNotes);
            savePomodoroNotes(nextNotes);
          }}
        />
        {status ? <div className="pomodoro-floating-notes__status">{status}</div> : null}
      </div>
    </section>
  );
}
