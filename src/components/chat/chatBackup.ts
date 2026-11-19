import type { HubUser } from "../../types";
import { sanitizePautaRichHtml } from "../../lib/richText";
import { CHAT_RETENCAO_DIAS, carregarBackup, nomeDaConversa, uid } from "../../lib/chatRepository";

function esc(v: string) {
  return v.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
}

function quando(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

// Gera um arquivo HTML (abre no Chrome) com todas as conversas dos últimos 30 dias do usuário.
export async function baixarBackupChat(user: HubUser) {
  const dados = await carregarBackup(user);
  const meuId = uid(user);
  const hoje = new Date();
  const secoes = dados
    .map(({ conversa, mensagens }) => {
      const nome = nomeDaConversa(conversa, user);
      const participantes = conversa.participantes.map((p) => p.nome).join(", ");
      const linhas = mensagens
        .map((m) => {
          if (m.tipo !== "texto") return `<p class="sis">${esc(m.conteudo)} <time>${quando(m.createdAt)}</time></p>`;
          const anexos = m.anexos.length ? `<p class="anx">Anexos: ${m.anexos.map((a) => esc(a.nome)).join(", ")}</p>` : "";
          return `<div class="msg${m.autorId === meuId ? " eu" : ""}"><header><strong>${esc(m.autorNome || "—")}</strong><time>${quando(m.createdAt)}</time></header>${m.conteudo ? `<div>${sanitizePautaRichHtml(m.conteudo)}</div>` : ""}${anexos}</div>`;
        })
        .join("\n");
      return `<section><h2>${esc(nome)}</h2><p class="part">${conversa.tipo === "grupo" ? "Grupo" : "Conversa individual"} · ${esc(participantes)} · ${mensagens.length} mensagem(ns)</p>${linhas || '<p class="sis">Sem mensagens no período.</p>'}</section>`;
    })
    .join("\n");

  const html = `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Backup do chat — HUB Depto Tributário — ${esc(user.nome)} — ${hoje.toLocaleDateString("pt-BR")}</title>
<style>
body{font-family:Segoe UI,Arial,sans-serif;margin:0;background:#f4f6f8;color:#1f2d3d}
main{max-width:860px;margin:0 auto;padding:28px 20px}
h1{font-size:20px;margin:0 0 4px}h2{font-size:16px;margin:0 0 2px}
.top{color:#5b6b7d;font-size:13px;margin-bottom:22px}
section{background:#fff;border:1px solid #dfe5ec;border-radius:12px;padding:16px 18px;margin-bottom:18px}
.part{color:#6b7a8c;font-size:12px;margin:0 0 12px}
.msg{border:1px solid #e6ebf1;border-radius:10px;padding:8px 12px;margin:6px 0;max-width:80%}
.msg.eu{margin-left:auto;background:#eef3fb}
.msg header{display:flex;gap:10px;align-items:baseline;font-size:12px;color:#5b6b7d}
.msg header strong{color:#1f3556}
.msg div{font-size:14px;line-height:1.45}
.sis{text-align:center;color:#7a8696;font-size:12px;margin:8px 0}
.anx{font-size:12px;color:#5b6b7d;margin:4px 0 0}
time{font-size:11px;color:#8a96a6}
mark{background:#fff3a3}
</style></head><body><main>
<h1>Backup do chat — HUB Depto Tributário</h1>
<p class="top">${esc(user.nome)} (${esc(user.email)}) · gerado em ${quando(hoje.toISOString())} · conversas dos últimos ${CHAT_RETENCAO_DIAS} dias. Os arquivos anexados não fazem parte deste backup; baixe-os pelo chat enquanto estiverem disponíveis.</p>
${secoes || '<p class="sis">Nenhuma conversa no período.</p>'}
</main></body></html>`;

  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `backup-chat-hub-${hoje.toISOString().slice(0, 10)}.html`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 5000);
}
