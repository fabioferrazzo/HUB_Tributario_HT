// Limpeza diária do chat: apaga mensagens (e os arquivos anexados) com mais de 30 dias.
// Função agendada da Netlify; usa a chave de serviço do Supabase e a função chat_limpar_antigas (patch_chat.sql).
const RETENCAO_DIAS = 30;
const BUCKET = "hub-anexos";

function getEnv(name) {
  return globalThis.Netlify?.env?.get?.(name) || process.env[name] || "";
}

function trimUrl(value) {
  return String(value || "").replace(/\/+$/, "");
}

async function supabaseFetch(url, options, serviceKey) {
  const response = await fetch(url, {
    ...options,
    headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}`, "content-type": "application/json", ...(options.headers || {}) }
  });
  const texto = await response.text();
  if (!response.ok) throw new Error(`Supabase ${response.status}: ${texto.slice(0, 300)}`);
  return texto ? JSON.parse(texto) : null;
}

export async function limparChat({ supabaseUrl, serviceKey, dias = RETENCAO_DIAS }) {
  const base = trimUrl(supabaseUrl);
  const resultado = await supabaseFetch(`${base}/rest/v1/rpc/chat_limpar_antigas`, { method: "POST", body: JSON.stringify({ p_dias: dias }) }, serviceKey);
  const paths = Array.isArray(resultado?.anexos) ? resultado.anexos.filter((p) => typeof p === "string" && p.startsWith("chat/")) : [];
  let arquivos = 0;
  // A API do Storage apaga em lotes.
  for (let i = 0; i < paths.length; i += 100) {
    const lote = paths.slice(i, i + 100);
    await supabaseFetch(`${base}/storage/v1/object/${BUCKET}`, { method: "DELETE", body: JSON.stringify({ prefixes: lote }) }, serviceKey);
    arquivos += lote.length;
  }
  return { mensagens: Number(resultado?.mensagens || 0), arquivos };
}

export default async function handler() {
  const supabaseUrl = getEnv("VITE_SUPABASE_URL") || getEnv("SUPABASE_URL");
  const serviceKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    return new Response(JSON.stringify({ error: "Variáveis do Supabase ausentes no servidor." }), { status: 500, headers: { "content-type": "application/json" } });
  }
  try {
    const r = await limparChat({ supabaseUrl, serviceKey });
    console.log("chat-limpeza", r);
    return new Response(JSON.stringify(r), { status: 200, headers: { "content-type": "application/json" } });
  } catch (error) {
    console.error("chat-limpeza falhou", error);
    return new Response(JSON.stringify({ error: String(error?.message || error) }), { status: 500, headers: { "content-type": "application/json" } });
  }
}

// Todos os dias às 06:30 UTC (03:30 em Brasília).
export const config = {
  schedule: "30 6 * * *"
};
