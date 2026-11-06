import { Bell, CalendarDays, CheckCircle2, Link2, Menu, X } from "lucide-react";
import type { HubNotification, HubRoute, HubUser } from "../types";
import { downloadDocxReport } from "../lib/reportExport";
import { getErrorMessage, getInitials } from "../lib/formatters";
import { notificationToReportRow, sendNotificationsByEmail } from "../lib/reportRows";
import { routes } from "../app/appConfig";
import { useEffect, useState } from "react";

export function TopBar({
  route,
  notificationItems,
  user,
  menuOpen,
  onMenu,
  onNavigate,
  onNotificationRead,
  onNotificationsReadAll
}: {
  route: HubRoute;
  notificationItems: HubNotification[];
  user: HubUser;
  menuOpen: boolean;
  onMenu: () => void;
  onNavigate: (route: HubRoute) => void;
  onNotificationRead: (notificationId: string) => void;
  onNotificationsReadAll: () => void;
}) {
  const label = routes.find((item) => item.id === route)?.label || "Inicio";
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notificationAction, setNotificationAction] = useState("");

  useEffect(() => {
    setNotificationsOpen(false);
  }, [route]);

  function exportNotificationsDocx() {
    const rows = notificationItems.length ? notificationItems.map(notificationToReportRow) : [{ Info: "Nenhuma notificacao pendente." }];
    downloadDocxReport("Notificacoes - HUB Depto Tributario", rows);
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
        <div className="top-chip">
          <CalendarDays size={14} />
          <span>{new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit" })}</span>
        </div>
        <div className="top-chip">
          <Link2 size={14} />
          <span>
            Pautas HUB <strong>app</strong>
          </span>
        </div>
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
                  <small>{notificationItems.length ? `${notificationItems.length} aviso(s) nao lido(s)` : "Sem avisos ativos"}</small>
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
