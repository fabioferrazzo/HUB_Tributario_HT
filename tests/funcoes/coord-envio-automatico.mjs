// Envio automático do lembrete de avaliação (coord-data): e-mail ao colaborador + aviso particular. Fetch simulado; roda com: node tests/funcoes/coord-envio-automatico.mjs
process.env.VITE_SUPABASE_URL = "https://exemplo.supabase.co";
process.env.VITE_SUPABASE_ANON_KEY = "anon";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service";
const chamadas = [];
let jaExiste = false;
globalThis.fetch = async (url, opt = {}) => {
  const u = String(url); const m = opt.method || "GET";
  const body = opt.body ? JSON.parse(opt.body) : null;
  chamadas.push({ m, u: u.replace("https://exemplo.supabase.co", ""), auth: opt.headers?.authorization, prefer: opt.headers?.prefer, body });
  const r = (d) => new Response(JSON.stringify(d), { status: 200 });
  if (u.endsWith("/auth/v1/user")) return r({ id: "u-coord", email: "Coord@Teste.com" });
  if (u.includes("/profiles?id=eq.")) return r([{ role: "admin", active: true }]);
  if (u.includes("/coord_itens?on_conflict=id&select=id")) return r(jaExiste ? [] : body.map((x) => ({ id: x.id })));
  if (u.includes("/quadro_avisos?select=id")) return r([{ id: "aviso-1" }]);
  if (u.includes("/profiles?email=eq.")) return r([{ id: "u-colab", nome: "Colaborador Teste" }]);
  if (u.includes("email_outbox")) return r([]);
  return r([]);
};
const { default: handler } = await import(new URL("../../netlify/functions/coord-data.mjs", import.meta.url).href);
const agora = new Date().toISOString();
const state = {
  collaborators: [{ id: "c1", name: "Colaborador Teste", email: "colab@teste.com" }, { id: "c2", name: "Sem Email", email: "x@y.com" }],
  reminders: [
    { id: "r1", title: "[TESTE] Avaliação trimestral", description: "Trazer <b>planilha</b>\nlinha 2", type: "colaborador", collaboratorId: "c1", due: "2026-11-28T09:30", priority: "alta", status: "aberto", calendarSync: true, createdAt: agora, updatedAt: agora },
    { id: "r2", title: "[TESTE] Item da coordenação", type: "coordenacao", due: "2026-11-28T09:30", createdAt: agora },
    { id: "r3", title: "[TESTE] Antigo", type: "colaborador", collaboratorId: "c1", due: "2026-10-01T09:30", createdAt: "2026-10-01T00:00:00Z" }
  ]
};
const req = () => new Request("https://hub-depto-tributario-ht.netlify.app/.netlify/functions/coord-data", { method: "PUT", headers: { authorization: "Bearer tok-user", "content-type": "application/json" }, body: JSON.stringify({ state }) });
const res = await handler(req());
const data = await res.json();
let falhas = 0;
const ok = (n, c, d = "") => { if (!c) falhas += 1; console.log(`${c ? "OK   " : "FALHA"} ${n}${d ? " -> " + d : ""}`); };
ok("resposta 200", res.status === 200, String(res.status));
ok("um envio (só o lembrete de colaborador novo e recente)", data.envios?.length === 1, JSON.stringify(data.envios));
const reserva = chamadas.find((c) => c.u.includes("coord_itens?on_conflict=id&select=id"));
ok("reserva com ignore-duplicates", /ignore-duplicates/.test(reserva?.prefer || "") && reserva.body.length === 1, reserva?.prefer);
const fila = chamadas.find((c) => c.u.endsWith("/rpc/queue_email"));
ok("e-mail na fila para o colaborador", fila?.body.p_to_email === "colab@teste.com" && fila.body.p_dedupe_key === "coord_lembrete:r1:colab@teste.com", fila && fila.body.p_to_email);
ok("assunto do e-mail", fila?.body.p_subject === "Lembrete de avaliação: [TESTE] Avaliação trimestral", fila?.body.p_subject);
ok("prazo no horário digitado", /28\/11\/2026 09:30/.test(fila?.body.p_html_body || ""));
ok("descrição escapada no e-mail", /Trazer &lt;b&gt;planilha&lt;\/b&gt;<br>linha 2/.test(fila?.body.p_html_body || ""));
ok("e-mail cita calendário e link do HUB", /Calendário de Tarefas/.test(fila?.body.p_html_body) && /href="https:\/\/hub-depto-tributario-ht.netlify.app"/.test(fila?.body.p_html_body));
const aviso = chamadas.find((c) => c.u.includes("/quadro_avisos?select=id"));
ok("aviso particular gravado com a sessão do coordenador", aviso?.auth === "Bearer tok-user" && aviso.body.visibility === "particular" && aviso.body.created_by === "u-coord" && aviso.body.created_by_email === "coord@teste.com");
ok("aviso com título e conteúdo", aviso?.body.title === "Lembrete de avaliação: [TESTE] Avaliação trimestral" && /^<strong>\[TESTE\] Avaliação trimestral<\/strong><br><strong>Prazo:<\/strong> 28\/11\/2026 09:30/.test(aviso.body.content), aviso?.body.content);
const dest = chamadas.find((c) => c.u.endsWith("/quadro_aviso_usuarios"));
ok("destinatário do aviso = colaborador", dest?.body.email === "colab@teste.com" && dest.body.user_id === "u-colab" && dest.auth === "Bearer tok-user");
ok("notificação (sino) disparada", chamadas.some((c) => c.u.endsWith("/rpc/notify_quadro_aviso_particular") && c.auth === "Bearer tok-user"));
ok("envio marcado como feito", data.envios?.[0]?.emailEnviado && data.envios?.[0]?.avisoCriado && data.envios[0].erros.length === 0, JSON.stringify(data.envios?.[0]?.erros));
// Segundo salvamento: o lembrete já existe, nada é reenviado.
chamadas.length = 0; jaExiste = true;
const res2 = await handler(req());
const data2 = await res2.json();
ok("ao salvar de novo, nada é reenviado", data2.envios?.length === 0 && !chamadas.some((c) => c.u.endsWith("/rpc/queue_email") || c.u.includes("/quadro_avisos")));
process.exit(falhas ? 1 : 0);
