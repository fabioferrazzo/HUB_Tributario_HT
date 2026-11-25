// Lembrete de avaliação (coord-data) com fetch simulado: e-mail + aviso particular na criação,
// aviso por 30 dias, conclusão (sino + aviso "concluído" por 5 dias), reabertura, exclusão e limpeza.
// Roda com: node tests/funcoes/coord-envio-automatico.mjs
process.env.VITE_SUPABASE_URL = "https://exemplo.supabase.co";
process.env.VITE_SUPABASE_ANON_KEY = "anon";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service";

const DIA = 24 * 60 * 60 * 1000;
const chamadas = [];
const banco = { itens: new Map(), avisos: new Map(), notificacoes: [] };
let seqAviso = 0;

const likeParaRegex = (padrao) => new RegExp("^" + padrao.split("*").map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[\\s\\S]*") + "$");

globalThis.fetch = async (url, opt = {}) => {
  const u = decodeURIComponent(String(url).replace("https://exemplo.supabase.co", ""));
  const m = opt.method || "GET";
  const body = opt.body ? JSON.parse(opt.body) : null;
  chamadas.push({ m, u, auth: opt.headers?.authorization, prefer: opt.headers?.prefer, body });
  const r = (d) => new Response(JSON.stringify(d), { status: 200 });

  if (u.endsWith("/auth/v1/user")) return r({ id: "u-coord", email: "Coord@Teste.com" });
  if (u.includes("/profiles?id=eq.")) return r([{ role: "admin", active: true }]);
  if (u.includes("/profiles?email=eq.")) return r([{ id: "u-colab", nome: "Colaborador Teste" }]);

  if (u.startsWith("/rest/v1/coord_itens")) {
    if (m === "POST" && /ignore-duplicates/.test(opt.headers?.prefer || "")) {
      const novos = body.filter((row) => !banco.itens.has(row.id));
      novos.forEach((row) => banco.itens.set(row.id, { ...row }));
      return r(novos.map((row) => ({ id: row.id })));
    }
    if (m === "POST") { body.forEach((row) => banco.itens.set(row.id, { ...banco.itens.get(row.id), ...row })); return r([]); }
    if (m === "PATCH") {
      const ids = (u.match(/id=in\.\(([^)]*)\)/) || [])[1]?.split(",") || [];
      const filtros = [...u.matchAll(/&(status|deleted_at)=(eq|is)\.([a-z]+)/g)];
      const mudaram = ids.filter((id) => {
        const row = banco.itens.get(id);
        if (!row) return false;
        return filtros.every(([, campo, op, valor]) => (op === "is" ? row[campo] == null : row[campo] === valor));
      });
      mudaram.forEach((id) => Object.assign(banco.itens.get(id), body));
      return r(mudaram.map((id) => ({ id })));
    }
    return r([]);
  }

  if (u.startsWith("/rest/v1/quadro_avisos")) {
    if (m === "POST") { const id = `aviso-${++seqAviso}`; banco.avisos.set(id, { id, ...body }); return r([{ id }]); }
    const idEq = (u.match(/id=eq\.([^&]+)/) || [])[1];
    if (m === "PATCH") { Object.assign(banco.avisos.get(idEq), body); return r([]); }
    if (m === "DELETE") { banco.avisos.delete(idEq); return r([]); }
    const like = (u.match(/content=like\.([^&]+)&select/) || [])[1];
    const re = like ? likeParaRegex(like) : null;
    return r([...banco.avisos.values()].filter((a) => !re || re.test(a.content)).map((a) => ({ id: a.id, content: a.content })));
  }
  if (u.startsWith("/rest/v1/notificacoes")) { banco.notificacoes.push(body); return r([]); }
  return r([]);
};

const { default: handler } = await import(new URL("../../netlify/functions/coord-data.mjs", import.meta.url).href);
let falhas = 0;
const ok = (n, c, d = "") => { if (!c) falhas += 1; console.log(`${c ? "OK   " : "FALHA"} ${n}${d ? " -> " + d : ""}`); };
const marca = (content) => Object.fromEntries((String(content).match(/<!--hub:coord-lembrete ([^>]*?)-->/)?.[1] || "").trim().split(/\s+/).map((p) => p.split("=")));

const agora = new Date().toISOString();
const state = {
  collaborators: [{ id: "c1", name: "Colaborador Teste", email: "colab@teste.com" }],
  reminders: [
    { id: "r1", title: "[TESTE] Avaliação trimestral", description: "Trazer <b>planilha</b>\nlinha 2", type: "colaborador", collaboratorId: "c1", due: "2026-11-28T09:30", priority: "alta", status: "aberto", calendarSync: true, createdAt: agora, updatedAt: agora },
    { id: "r2", title: "[TESTE] Item da coordenação", type: "coordenacao", due: "2026-11-28T09:30", createdAt: agora },
    { id: "r3", title: "[TESTE] Antigo", type: "colaborador", collaboratorId: "c1", due: "2026-10-01T09:30", createdAt: "2026-10-01T00:00:00Z" }
  ]
};
const salvar = async () => {
  chamadas.length = 0;
  const res = await handler(new Request("https://hub-depto-tributario-ht.netlify.app/.netlify/functions/coord-data", { method: "PUT", headers: { authorization: "Bearer tok-user", "content-type": "application/json" }, body: JSON.stringify({ state }) }));
  return { status: res.status, data: await res.json() };
};

// 1. Criação
let { status, data } = await salvar();
ok("criação: resposta 200", status === 200, String(status));
ok("criação: um envio (só o lembrete de colaborador novo e recente)", data.envios?.length === 1, JSON.stringify(data.envios));
const fila = chamadas.find((c) => c.u.endsWith("/rpc/queue_email"));
ok("e-mail na fila para o colaborador, com chave contra reenvio", fila?.body.p_to_email === "colab@teste.com" && fila.body.p_dedupe_key === "coord_lembrete:r1:colab@teste.com");
ok("assunto do e-mail", fila?.body.p_subject === "Lembrete de avaliação: [TESTE] Avaliação trimestral", fila?.body.p_subject);
ok("prazo no horário digitado", /28\/11\/2026 09:30/.test(fila?.body.p_html_body || ""));
ok("descrição escapada no e-mail", /Trazer &lt;b&gt;planilha&lt;\/b&gt;<br>linha 2/.test(fila?.body.p_html_body || ""));
const postAviso = chamadas.find((c) => c.m === "POST" && c.u.startsWith("/rest/v1/quadro_avisos"));
ok("aviso particular gravado com a sessão do coordenador", postAviso?.auth === "Bearer tok-user" && postAviso.body.visibility === "particular" && postAviso.body.created_by === "u-coord");
ok("aviso começa pelo título do lembrete", /^<strong>\[TESTE\] Avaliação trimestral<\/strong><br><strong>Prazo:<\/strong> 28\/11\/2026 09:30/.test(postAviso?.body.content || ""));
const m1 = marca(banco.avisos.get("aviso-1")?.content);
const dias = (Date.parse(m1.expira) - Date.parse(m1.criado)) / DIA;
ok("aviso vale por 30 dias", m1.id === "r1" && Math.round(dias) === 30 && !m1.concluido, JSON.stringify(m1));
ok("destinatário do aviso e sino", chamadas.some((c) => c.u.endsWith("/quadro_aviso_usuarios") && c.body.email === "colab@teste.com") && chamadas.some((c) => c.u.endsWith("/rpc/notify_quadro_aviso_particular")));

// 2. Salvar de novo: nada é reenviado
({ data } = await salvar());
ok("salvar de novo não reenvia nada", data.envios?.length === 0 && data.conclusoes?.length === 0 && !chamadas.some((c) => c.u.endsWith("/rpc/queue_email")));

// 3. Conclusão pela coordenação
state.reminders[0].status = "concluido";
state.reminders[0].completedAt = new Date().toISOString();
({ data } = await salvar());
ok("conclusão informada", data.conclusoes?.length === 1 && data.conclusoes[0].avisoAtualizado && data.conclusoes[0].notificado && !data.conclusoes[0].erros.length, JSON.stringify(data.conclusoes));
const m2 = marca(banco.avisos.get("aviso-1")?.content);
ok("aviso marcado como concluído, some em 5 dias", Boolean(m2.concluido) && Math.round((Date.parse(m2.expira) - Date.parse(m2.concluido)) / DIA) === 5 && m2.criado === m1.criado, JSON.stringify(m2));
const notif = banco.notificacoes.at(-1);
ok("sino do colaborador avisado da conclusão", notif?.user_id === "u-colab" && notif.titulo === "Lembrete concluído pela coordenação" && /particular/.test(notif.meta) && notif.target_id === "aviso-1");
({ data } = await salvar());
ok("conclusão não é notificada duas vezes", data.conclusoes?.length === 0 && banco.notificacoes.length === 1);

// 4. Reabertura: volta ao normal, com o prazo de 30 dias da criação
state.reminders[0].status = "aberto";
state.reminders[0].completedAt = "";
await salvar();
const m3 = marca(banco.avisos.get("aviso-1")?.content);
ok("reaberto: aviso volta ao normal (30 dias da criação)", !m3.concluido && m3.expira === m1.expira, JSON.stringify(m3));

// 5. Vencimento: aviso vencido sai do quadro
const aviso = banco.avisos.get("aviso-1");
aviso.content = aviso.content.replace(`expira=${m3.expira}`, `expira=${new Date(Date.now() - 1000).toISOString()}`);
await salvar();
ok("aviso vencido é retirado do quadro", !banco.avisos.has("aviso-1"));

// 6. Exclusão do lembrete retira o aviso
state.reminders.push({ id: "r4", title: "[TESTE] Outro lembrete", type: "colaborador", collaboratorId: "c1", due: "2026-12-01T09:00", priority: "media", status: "aberto", createdAt: new Date().toISOString() });
await salvar();
ok("novo lembrete cria novo aviso", [...banco.avisos.values()].some((a) => marca(a.content).id === "r4"));
Object.assign(state.reminders[3], { deletedAt: new Date().toISOString(), status: "concluido" });
({ data } = await salvar());
ok("excluir o lembrete retira o aviso, sem notificar conclusão", ![...banco.avisos.values()].some((a) => marca(a.content).id === "r4") && data.conclusoes?.length === 0);

process.exit(falhas ? 1 : 0);
