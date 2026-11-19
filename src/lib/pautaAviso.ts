import type { HubUser, Pauta } from "../types";
import { publishAvisoCoordenacao } from "./avisoCoordenacaoRepository";
import { parseBrazilianDate } from "./formatters";
import { hasPautaRichContent, sanitizePautaRichHtml } from "./richText";

// "Postar como Aviso da Coordenação": a pauta passa a aparecer no alto do Quadro geral
// (substitui o aviso atual e notifica a equipe no sino).

function escapeHtml(valor: string) {
  return valor.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
}

function lerPrazo(prazo: string) {
  if (!prazo) return null;
  const br = parseBrazilianDate(prazo);
  if (br) return br;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(prazo);
  if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  const data = new Date(prazo);
  return Number.isNaN(data.getTime()) ? null : data;
}

function isoDia(data: Date) {
  return `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, "0")}-${String(data.getDate()).padStart(2, "0")}`;
}

export function conteudoAvisoDaPauta(pauta: Pauta) {
  const partes = [`<p><strong>${escapeHtml(pauta.tema.trim())}</strong></p>`];
  if (hasPautaRichContent(pauta.acoes)) partes.push(sanitizePautaRichHtml(pauta.acoes));
  const prazo = lerPrazo(pauta.prazo);
  if (prazo) partes.push(`<p>Prazo: ${prazo.toLocaleDateString("pt-BR")}</p>`);
  return partes.join("");
}

export async function postarPautaComoAviso(pauta: Pauta, user: HubUser) {
  const prazo = lerPrazo(pauta.prazo);
  const hoje = isoDia(new Date());
  // O aviso vale até o prazo da pauta (se ainda não passou); sem prazo, fica até ser trocado ou retirado.
  const validade = prazo && isoDia(prazo) >= hoje ? isoDia(prazo) : "";
  return publishAvisoCoordenacao(user, {
    conteudo: conteudoAvisoDaPauta(pauta),
    nivel: pauta.destaque || /alta|urgente/i.test(pauta.prioridade || "") ? "importante" : "normal",
    cor: "padrao",
    fonte: "normal",
    validade
  });
}
