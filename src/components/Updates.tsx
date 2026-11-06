import { CSSProperties, useEffect, useState } from "react";
import { Newspaper, ShieldCheck, X } from "lucide-react";
import type { Noticia } from "../types";
import type { ReportFormat } from "../app/appTypes";
import { exportReport } from "../lib/reportExport";
import { formatDate } from "../lib/formatters";
import { listAppUpdates } from "../lib/updatesRepository";
import { noticiaToReportRow } from "../lib/reportRows";

export function FooterUpdates() {
  const [noticias, setNoticias] = useState<Noticia[]>([]);
  const [legislacoes, setLegislacoes] = useState<Noticia[]>([]);
  const [openDrawer, setOpenDrawer] = useState<"noticia" | "legislacao" | null>(null);

  useEffect(() => {
    let active = true;

    Promise.all([listAppUpdates("noticia"), listAppUpdates("legislacao")])
      .then(([loadedNoticias, loadedLegislacoes]) => {
        if (!active) return;
        setNoticias(loadedNoticias);
        setLegislacoes(loadedLegislacoes);
      })
      .catch(() => {
        if (!active) return;
        setNoticias([]);
        setLegislacoes([]);
      });

    return () => {
      active = false;
    };
  }, []);

  const drawerItems = openDrawer === "legislacao" ? legislacoes : noticias;

  return (
    <footer className="footer-updates">
      <UpdateTicker
        icon={<Newspaper size={18} />}
        items={noticias}
        onOpen={() => setOpenDrawer("noticia")}
        title="Notícias Tributárias"
      />
      <UpdateTicker
        icon={<ShieldCheck size={18} />}
        items={legislacoes}
        onOpen={() => setOpenDrawer("legislacao")}
        title="Legislações Reforma Tributária"
      />
      {openDrawer ? (
        <UpdatesDrawer
          items={drawerItems}
          kind={openDrawer}
          onClose={() => setOpenDrawer(null)}
          title={openDrawer === "legislacao" ? "Legislações recentes" : "Notícias da semana"}
        />
      ) : null}
    </footer>
  );
}

export function UpdateTicker({ icon, items, onOpen, title }: { icon: React.ReactNode; items: Noticia[]; onOpen: () => void; title: string }) {
  const tickerItems = items.length ? items : [{ id: `${title}-empty`, titulo: "Aguardando atualizações automáticas", fonte: "HUB", url: "#", data: "" }];
  const repeatCount = Math.max(2, Math.ceil(6 / tickerItems.length));
  const loopItems = Array.from({ length: repeatCount }, () => tickerItems).flat();
  const textSize = tickerItems.reduce((total, item) => total + item.fonte.length + item.titulo.length, 0);
  const tickerDuration = Math.max(52, Math.min(132, textSize * 0.62));
  const tickerStyle = { "--ticker-duration": `${tickerDuration}s` } as CSSProperties;

  return (
    <section
      className="news-band"
      aria-label={title}
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") onOpen();
      }}
    >
      <div className="news-label">
        {icon}
        <strong>{title}</strong>
      </div>
      <div className="ticker-window">
        <div className="ticker-track" style={tickerStyle}>
          {loopItems.map((item, index) => (
            <span className="ticker-item" key={`${item.id}-${index}`}>
              <strong>{item.fonte}</strong>
              <span>{item.titulo}</span>
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

export function UpdatesDrawer({ items, kind, onClose, title }: { items: Noticia[]; kind: "noticia" | "legislacao"; onClose: () => void; title: string }) {
  function exportUpdates(format: ReportFormat) {
    exportReport(format, title, items.map(noticiaToReportRow));
  }

  return (
    <div className="updates-sidebar-backdrop" role="presentation" onClick={onClose}>
      <aside className="updates-sidebar" aria-label={title} role="dialog" onClick={(event) => event.stopPropagation()}>
        <header>
          <div>
            <strong>{title}</strong>
            <small>{kind === "legislacao" ? "Normas oficiais monitoradas" : "Últimos 7 dias"} - {items.length} item(ns)</small>
          </div>
          <div className="updates-sidebar-actions">
            <button type="button" onClick={() => exportUpdates("pdf")}>PDF</button>
            <button type="button" onClick={() => exportUpdates("excel")}>XLSX</button>
            <button aria-label="Fechar atualizações" type="button" onClick={onClose}>
              <X size={18} />
            </button>
          </div>
        </header>

        <div className="updates-list">
          {items.map((item) => (
            <a href={item.url} key={item.id} rel="noreferrer" target="_blank">
              <span>{formatDate(item.data)}</span>
              <strong>{item.titulo}</strong>
              <em>{item.fonte}</em>
              <small>{item.url}</small>
            </a>
          ))}
          {!items.length ? <div className="empty-state">Nenhuma atualização registrada para a última semana.</div> : null}
        </div>
      </aside>
    </div>
  );
}
