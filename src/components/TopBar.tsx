import { Bell, CalendarDays, CheckCircle2, Clock3, ExternalLink, Maximize2, Menu, MessagesSquare, Minimize2, RotateCw, X } from "lucide-react";
import type { HubNotification, HubRoute, HubUser } from "../types";
import { downloadDocxReport } from "../lib/reportExport";
import { getErrorMessage, getInitials } from "../lib/formatters";
import { notificationToReportRow, sendNotificationsByEmail } from "../lib/reportRows";
import { routes } from "../app/appConfig";
import { useEffect, useState } from "react";

// Relógio do cabeçalho: atualiza na virada de cada minuto (e a data, à meia-noite).
function useAgora() {
  const [agora, setAgora] = useState(() => new Date());
  useEffect(() => {
    let intervalo: number | undefined;
    const tique = () => setAgora(new Date());
    const espera = window.setTimeout(() => {
      tique();
      intervalo = window.setInterval(tique, 60_000);
    }, 60_000 - (Date.now() % 60_000) + 50);
    const aoVoltar = () => { if (document.visibilityState === "visible") tique(); };
    document.addEventListener("visibilitychange", aoVoltar);
    return () => {
      window.clearTimeout(espera);
      if (intervalo) window.clearInterval(intervalo);
      document.removeEventListener("visibilitychange", aoVoltar);
    };
  }, []);
  return agora;
}

export function TopBar({
  route,
  notificationItems,
  user,
  menuOpen,
  onMenu,
  onNavigate,
  onNotificationRead,
  onNotificationsReadAll,
  isFullscreen = false,
  onFullscreen,
  onOpenWindow,
  onReload,
  chatNaoLidas = 0,
  onChat
}: {
  route: HubRoute;
  notificationItems: HubNotification[];
  user: HubUser;
  menuOpen: boolean;
  onMenu: () => void;
  onNavigate: (route: HubRoute) => void;
  onNotificationRead: (notificationId: string) => void;
  onNotificationsReadAll: () => void;
  isFullscreen?: boolean;
  onFullscreen?: () => void;
  onOpenWindow?: () => void;
  onReload?: () => void;
  chatNaoLidas?: number;
  onChat?: () => void;
}) {
  const label = routes.find((item) => item.id === route)?.label || "Inicio";
  const agora = useAgora();
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notificationAction, setNotificationAction] = useState("");

  useEffect(() => {
    setNotificationsOpen(false);
  }, [route]);

  function exportNotificationsDocx() {
    const rows = notificationItems.length ? notificationItems.map(notificationToReportRow) : [{ Info: "Nenhuma notificação pendente." }];
    downloadDocxReport("Notificações - HUB Depto Tributário", rows);
  }

  async function emailNotifications() {
    setNotificationAction("Enviando...");
    try {
      await sendNotificationsByEmail(user, notificationItems);
      setNotificationAction("E-mail enviado.");
      window.setTimeout(() => setNotificationAction(""), 2500);
    } catch (error) {
      setNotificationAction(getErrorMessage(error));
    }
  }

  return (
    <header className="topbar">
      <div className="topbar-left">
        <button className="icon-button mobile-menu" type="button" onClick={onMenu} aria-label="Abrir menu">
          {menuOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
        <h1>
          <span />
          {label}
        </h1>
      </div>
      <div className="topbar-brand-strip">
        <img src="/assets/logo-h-teixeira.jpeg" alt="H. Teixeira" />
        <span>{"Depto Tribut\u00e1rio"}</span>
      </div>
      <div className="topbar-actions">
        {onFullscreen || onOpenWindow || onReload ? (
          <div className="top-page-actions">
            {onFullscreen ? (
              <button type="button" onClick={onFullscreen} title={isFullscreen ? "Sair da tela cheia (Esc)" : "Tela cheia"} aria-label={isFullscreen ? "Sair da tela cheia" : "Tela cheia"}>
                {isFullscreen ? <Minimize2 size={16} strokeWidth={1.6} /> : <Maximize2 size={16} strokeWidth={1.6} />}
              </button>
            ) : null}
            {onOpenWindow ? (
              <button type="button" onClick={onOpenWindow} title="Abrir em nova janela" aria-label="Abrir em nova janela">
                <ExternalLink size={16} strokeWidth={1.6} />
              </button>
            ) : null}
            {onReload ? (
              <button type="button" onClick={onReload} title="Recarregar o app" aria-label="Recarregar o app">
                <RotateCw size={16} strokeWidth={1.6} />
              </button>
            ) : null}
          </div>
        ) : null}
        <div className="top-chip">
          <CalendarDays size={14} />
          <span>{agora.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit" })}</span>
        </div>
        <div className="top-chip top-chip--relogio" title="Horário de Brasília">
          <Clock3 size={14} />
          <time dateTime={agora.toISOString()}>{agora.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</time>
        </div>
        {onChat ? (
          <button aria-label={chatNaoLidas ? `Chat: ${chatNaoLidas} mensagem(ns) não lida(s)` : "Chat"} className="notification-button" title="Chat" type="button" onClick={onChat}>
            <MessagesSquare size={18} strokeWidth={1.6} />
            {chatNaoLidas ? <span className="notification-badge">{chatNaoLidas}</span> : null}
          </button>
        ) : null}
        <div className="notification-wrap">
          <button
            aria-controls="hub-notifications"
            aria-expanded={notificationsOpen}
            aria-label="Notificações"
            className={`notification-button ${notificationsOpen ? "active" : ""}`}
            type="button"
            onClick={() => setNotificationsOpen((open) => !open)}
          >
            <Bell size={18} />
            {notificationItems.length ? <span className="notification-badge">{notificationItems.length}</span> : null}
          </button>
          {notificationsOpen ? (
            <section className="notification-popover" id="hub-notifications" role="dialog" aria-label="Avisos ativos">
              <header>
                <div>
                  <strong>Notificações</strong>
                  <small>{notificationItems.length ? `${notificationItems.length} aviso(s) não lido(s)` : "Sem avisos ativos"}</small>
                </div>
                <div className="notification-actions">
                  <button className="notification-read-all" type="button" onClick={exportNotificationsDocx}>
                    DOCX
                  </button>
                  <button className="notification-read-all" type="button" onClick={emailNotifications}>
                    E-mail
                  </button>
                  {notificationItems.length ? (
                    <button className="notification-read-all" type="button" onClick={onNotificationsReadAll}>
                      Marcar todas
                    </button>
                  ) : null}
                </div>
              </header>
              {notificationAction ? <p className="notification-action-status">{notificationAction}</p> : null}

              <div className="notification-list">
                {notificationItems.length ? (
                  notificationItems.map((item) => (
                    <div
                      className={`notification-item notification-item--${item.tone}`}
                      key={item.id}
                    >
                      <span className="notification-dot" />
                      <button
                        className="notification-link"
                        type="button"
                        onClick={() => {
                          onNotificationRead(item.id);
                          if (item.targetType === "quadro_aviso") abrirAbaPautas(/particular/i.test(`${item.title} ${item.meta}`) ? "particular" : "geral");
                          else if (item.targetType === "pauta") abrirAbaPautas("lista");
                          else if (item.targetType === "registro" && item.targetRef) abrirRegistro(item.targetRef);
                          onNavigate(item.route);
                          setNotificationsOpen(false);
                        }}
                      >
                        <strong>{item.title}</strong>
                        <em>{item.detail}</em>
                        <small>{item.meta}</small>
                      </button>
                      <button
                        className="notification-read"
                        type="button"
                        onClick={() => onNotificationRead(item.id)}
                        aria-label={`Marcar ${item.title} como lida`}
                      >
                        Lida
                      </button>
                    </div>
                  ))
                ) : (
                  <div className="notification-empty">
                    <CheckCircle2 size={18} />
                    <span>Nenhuma notificação pendente.</span>
                  </div>
                )}
              </div>
            </section>
          ) : null}
        </div>
        <div className="user-chip">
          <strong>{getInitials(user.nome)}</strong>
        </div>
      </div>
    </header>
  );
}

// Notificação de aviso abre Pautas já no "Quadro de Avisos"; de pauta, na lista de pautas.
// Aba Registros: abre direto o registro da notificação.
function abrirRegistro(id: string) {
  try {
    window.sessionStorage.setItem("hub_registros_abrir", id);
    window.dispatchEvent(new Event("hub:registros-abrir"));
  } catch {
    // sessionStorage indisponível: a aba abre sem seleção.
  }
}

function abrirAbaPautas(quadro: "geral" | "particular" | "lista") {
  try {
    window.sessionStorage.setItem("hub_pautas_aba", quadro);
  } catch {
    // sem armazenamento: o evento abaixo ainda troca a aba se Pautas já estiver aberto
  }
  window.dispatchEvent(new CustomEvent("hub:pautas-aba", { detail: quadro }));
}
