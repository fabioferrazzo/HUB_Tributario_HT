import type { HubNotification, HubProfile, HubUser, Lembrete, Noticia, Pauta, TaskItem } from "../types";
import type { ReportRow } from "../app/appTypes";
import { escapeHtmlText } from "./reportExport";
import { formatDate, formatDateTime, formatResponsaveis } from "./formatters";
import { getSupabaseAccessToken } from "./auth";
import { pautaRichTextToPlain, renderPautaRichHtmlForEmail } from "./richText";

export function pautaToReportRow(pauta: Pauta): ReportRow {
  return {
    Tema: pauta.tema,
    Acao: pautaRichTextToPlain(pauta.acoes || pauta.pendenciasObs || "Sem ação registrada"),
    Responsavel: pauta.responsavel || "Sem responsável definido",
    Email: pauta.email || "",
    Prazo: formatDate(pauta.prazo),
    Prioridade: pauta.prioridade || "",
    Status: pauta.status || "Sem status",
    Origem: pauta.origem || ""
  };
}

export function buildPautasEmailHtml(pautas: Pauta[], profiles: HubProfile[]) {
  const generatedAt = new Date().toLocaleString("pt-BR");
  const content = pautas.length
    ? pautas
        .map((pauta) => {
          const fontSize = getPautaEmailFontSize(pauta.textSize);
          const fontWeight = pauta.textBold ? "700" : "400";
          const fontStyle = pauta.textItalic ? "italic" : "normal";
          const description = pauta.acoes || pauta.pendenciasObs || "Sem ação registrada";
          const responsaveis = pauta.scope === "usuarios" ? formatResponsaveis(pauta.responsaveis || [], profiles) : "Todos os usuários";

          return `
            <article style="border:1px solid #d8cdb6;border-radius:8px;padding:14px 16px;margin:0 0 12px;background:#fffdf8;">
              <h2 style="font-family:Arial,sans-serif;font-size:${fontSize};line-height:1.35;margin:0 0 8px;color:#10233d;font-weight:700;font-style:${fontStyle};">
                ${escapeHtmlText(pauta.tema)}
              </h2>
              <div style="font-family:Arial,sans-serif;font-size:${fontSize};line-height:1.45;color:#243955;font-weight:${fontWeight};font-style:${fontStyle};white-space:pre-wrap;">
                ${renderPautaRichHtmlForEmail(description)}
              </div>
              <p style="font-family:Arial,sans-serif;font-size:12pt;line-height:1.45;margin:10px 0 0;color:#10233d;">
                <strong>Responsáveis:</strong> ${escapeHtmlText(responsaveis)}<br/>
                <strong>Prazo:</strong> ${escapeHtmlText(formatDate(pauta.prazo))}<br/>
                <strong>Status:</strong> ${escapeHtmlText(pauta.status || "Sem status")}<br/>
                <strong>Prioridade:</strong> ${escapeHtmlText(pauta.prioridade || "Normal")}
              </p>
            </article>
          `;
        })
        .join("")
    : `<p style="font-family:Arial,sans-serif;font-size:12pt;line-height:1.45;color:#243955;">Nenhuma pauta encontrada para o filtro atual.</p>`;

  return `
    <div style="font-family:Arial,sans-serif;font-size:12pt;line-height:1.45;color:#17211c;">
      <p style="margin:0 0 12px;">Segue a lista filtrada de pautas do HUB Depto Tributário.</p>
      <p style="margin:0 0 16px;color:#64716b;">Gerado em ${escapeHtmlText(generatedAt)}.</p>
      ${content}
    </div>
  `;
}

export function getPautaEmailFontSize(size: Pauta["textSize"]) {
  if (size === "pequena") return "12pt";
  if (size === "grande") return "16pt";
  return "14pt";
}

export function lembreteToReportRow(lembrete: Lembrete, profiles: HubProfile[]): ReportRow {
  return {
    Titulo: lembrete.titulo,
    Descricao: lembrete.descricao || "Sem descrição",
    Responsaveis: formatResponsaveis(lembrete.responsaveis, profiles),
    Prazo: formatDateTime(lembrete.prazo),
    Prioridade: lembrete.prioridade,
    Status: lembrete.status,
    Confidencial: lembrete.confidencial ? "Sim" : "Nao",
    Anexos: String(lembrete.anexos.length)
  };
}

export function taskToReportRow(task: TaskItem): ReportRow {
  return {
    Titulo: task.titulo,
    Descricao: task.descricao || "Sem descrição",
    Prazo: formatDateTime(task.prazo),
    Prioridade: task.prioridade,
    Status: task.status,
    Destaque: task.destaque ? "Sim" : "Nao",
    Origem: task.origem || "calendario",
    Responsaveis: task.responsaveis.join(", ") || "Sem responsável definido",
    Anexos: String(task.anexos.length)
  };
}

export function noticiaToReportRow(item: Noticia): ReportRow {
  return {
    Data: formatDate(item.data),
    Titulo: item.titulo,
    Fonte: item.fonte,
    URL: item.url,
    Tipo: item.tipo || ""
  };
}

export function notificationToReportRow(item: HubNotification): ReportRow {
  return {
    Titulo: item.title,
    Detalhe: item.detail,
    Meta: item.meta,
    Tom: item.tone,
    Tipo: item.tipo,
    Criada: formatDateTime(item.createdAt),
    Rota: item.route
  };
}

export async function sendNotificationsByEmail(user: HubUser, items: HubNotification[]) {
  const rows = items.length ? items.map(notificationToReportRow) : [{ Info: "Nenhuma notificação pendente." }];
  const body = rows
    .map((row) => Object.entries(row).map(([key, value]) => `${key}: ${value}`).join("\n"))
    .join("\n\n");
  const authToken = await getSupabaseAccessToken();
  const response = await fetch("/.netlify/functions/coord-email", {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json"
    },
    body: JSON.stringify({
      authToken,
      to: user.email,
      subject: "Notificações do HUB Depto Tributário",
      body,
      htmlBody: `<p>Segue o resumo das notificações do HUB Depto Tributário.</p><pre>${escapeHtmlText(body)}</pre>`
    })
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error || "Não foi possível enviar as notificações por e-mail.");
  return data;
}
