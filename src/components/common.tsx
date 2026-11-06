import { Plus } from "lucide-react";
import { getDueTone } from "../lib/formatters";
import { getSupabaseAccessToken } from "../lib/auth";
import { useCallback, useRef } from "react";

export function DashboardPanelHeader({
  actionLabel,
  actionTitle,
  icon,
  onAction,
  onSecondaryAction,
  secondaryIcon,
  secondaryLabel,
  status,
  title
}: {
  actionLabel?: string;
  actionTitle?: string;
  icon: React.ReactNode;
  onAction?: () => void;
  onSecondaryAction?: () => void;
  secondaryIcon: React.ReactNode;
  secondaryLabel: string;
  status: string;
  title: string;
}) {
  return (
    <header className="panel-head">
      <div className="panel-title">
        <span className="panel-accent" />
        {icon}
        <h2>{title}</h2>
      </div>
      <div className="panel-actions">
        <span className="panel-status">{status}</span>
        <button className="btn-mini" type="button" onClick={onSecondaryAction}>
          {secondaryIcon}
          {secondaryLabel}
        </button>
        {actionLabel ? (
          <button className="btn-mini primary" type="button" onClick={onAction} title={actionTitle || actionLabel}>
            <Plus size={14} />
            {actionLabel}
          </button>
        ) : null}
      </div>
    </header>
  );
}

export function PanelHeader({ title, icon, action }: { title: string; icon: React.ReactNode; action: string }) {
  return (
    <header className="panel-header">
      <div>
        {icon}
        <h2>{title}</h2>
      </div>
      <span>{action}</span>
    </header>
  );
}

export function StatusPill({ label }: { label: string }) {
  const normalized = label.toLowerCase();
  const tone =
    normalized.includes("atrasado") || normalized.includes("alta") || normalized.includes("urgente")
      ? "danger"
      : normalized.includes("conclu")
        ? "ok"
        : normalized.includes("andamento")
          ? "warning"
          : "neutral";
  return <span className={`status-pill status-pill--${tone}`}>{label}</span>;
}

export function DueSignal({ prazo }: { prazo: string }) {
  const tone = getDueTone(prazo);

  return <span className={`due-signal due-signal--${tone}`} aria-label={`Prazo ${tone}`} />;
}

export function ModuleFrame({ title, src }: { title: string; src: string }) {
  const frameRef = useRef<HTMLIFrameElement | null>(null);

  const postAuthToken = useCallback(async () => {
    const token = await getSupabaseAccessToken();
    if (!token || !frameRef.current?.contentWindow) return;
    frameRef.current.contentWindow.postMessage({ type: "hub-auth-token", token }, window.location.origin);
  }, []);

  return (
    <section className="frame-page">
      <header>
        <h2>{title}</h2>
        <a href={src} rel="noreferrer" target="_blank">
          Abrir em nova aba
        </a>
      </header>
      <iframe ref={frameRef} src={src} title={title} onLoad={postAuthToken} />
    </section>
  );
}
