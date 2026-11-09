import { ExternalLink, Maximize2, Minimize2, Plus, RotateCw } from "lucide-react";
import { getDueTone } from "../lib/formatters";
import { getSupabaseAccessToken } from "../lib/auth";
import { supabasePublicConfig } from "../lib/supabase";
import { useCallback, useEffect, useRef, useState } from "react";
import type { HubApp } from "../app/appsRegistry";

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

// Moldura padrão dos apps incorporados: tela cheia, nova janela e recarregar.
// Canal reservado HUB <-> app: mensagens "hub:*" (hoje, pedido de login e de tela cheia;
// as integrações entre apps entram aqui quando forem especificadas).
export function ModuleFrame({ app }: { app: HubApp }) {
  const pageRef = useRef<HTMLElement | null>(null);
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const popupRef = useRef<Window | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const Icon = app.icon;
  const embedded = app.mode === "embutido";
  const lanOnly = /^http:\/\/(192\.168\.|10\.)/.test(app.src);
  const localOnly = /^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(app.src);

  const sendAuthToken = useCallback(async (target?: Window | null) => {
    const token = await getSupabaseAccessToken();
    const destination = target || frameRef.current?.contentWindow;
    if (!token || !destination) return;
    destination.postMessage(
      { type: "hub-auth-token", token, supabaseUrl: supabasePublicConfig.url, supabaseAnonKey: supabasePublicConfig.anonKey },
      window.location.origin
    );
  }, []);

  const toggleFullscreen = useCallback(async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await pageRef.current?.requestFullscreen();
    } catch {
      // O navegador pode recusar (ex.: sem gesto do usuário); nada a fazer.
    }
  }, []);

  useEffect(() => {
    const onChange = () => setIsFullscreen(Boolean(pageRef.current) && document.fullscreenElement === pageRef.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin) return;
      const fromFrame = event.source === frameRef.current?.contentWindow;
      const fromPopup = Boolean(popupRef.current) && event.source === popupRef.current;
      if (!fromFrame && !fromPopup) return;
      const type = typeof event.data?.type === "string" ? event.data.type : "";
      if (type === "hub:auth-request") void sendAuthToken(event.source as Window);
      if (type === "hub:fullscreen" && fromFrame) void toggleFullscreen();
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [sendAuthToken, toggleFullscreen]);

  function openWindow() {
    const width = Math.min(1440, window.screen.availWidth || 1440);
    const height = Math.min(960, window.screen.availHeight || 960);
    popupRef.current = window.open(app.src, `hub-app-${app.id}`, `popup=yes,width=${width},height=${height}`);
  }

  return (
    <section className={`frame-page ${isFullscreen ? "frame-page--fullscreen" : ""}`} ref={pageRef}>
      <header>
        <div className="frame-title">
          <Icon size={18} strokeWidth={1.6} />
          <h2>{app.title}</h2>
        </div>
        <div className="frame-actions">
          {embedded ? (
            <button type="button" onClick={() => void toggleFullscreen()} title={isFullscreen ? "Sair da tela cheia (Esc)" : "Tela cheia"}>
              {isFullscreen ? <Minimize2 size={15} strokeWidth={1.6} /> : <Maximize2 size={15} strokeWidth={1.6} />}
              <span>{isFullscreen ? "Sair da tela cheia" : "Tela cheia"}</span>
            </button>
          ) : null}
          <button type="button" onClick={openWindow} title="Abrir em nova janela">
            <ExternalLink size={15} strokeWidth={1.6} />
            <span>Nova janela</span>
          </button>
          {embedded ? (
            <button type="button" onClick={() => setReloadKey((key) => key + 1)} title="Recarregar o app">
              <RotateCw size={15} strokeWidth={1.6} />
              <span>Recarregar</span>
            </button>
          ) : null}
        </div>
      </header>
      {embedded ? (
        <iframe
          allow="fullscreen; clipboard-read; clipboard-write"
          allowFullScreen
          key={reloadKey}
          onLoad={() => void sendAuthToken()}
          ref={frameRef}
          src={app.src}
          title={app.title}
        />
      ) : (
        <div className="frame-external">
          <Icon size={30} strokeWidth={1.4} />
          <h3>{app.title}</h3>
          <p>{app.description || "Este app abre em janela própria."}</p>
          <button className="primary-action" type="button" onClick={openWindow}>
            <ExternalLink size={15} strokeWidth={1.6} />
            Abrir {app.label}
          </button>
          {lanOnly ? <small>Disponível apenas na rede do escritório.</small> : null}
          {localOnly ? <small>Disponível apenas no computador onde o programa está instalado.</small> : null}
        </div>
      )}
    </section>
  );
}
