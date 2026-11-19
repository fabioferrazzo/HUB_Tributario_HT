import type { HubUser } from "../types";
import { readStorage, writeStorage } from "./storage";
import { isSupabaseConfigured, supabase } from "./supabase";

// Comentários em avisos do quadro e em pautas.
// No Supabase, gravar/excluir/bloquear passa por funções do banco (patch_comentarios.sql),
// que conferem acesso ao item, bloqueio e autoria. No modo local (demonstração) as mesmas regras
// são aplicadas aqui.

export type ComentarioAlvo = "aviso" | "pauta";

export type Comentario = {
  id: string;
  alvo: ComentarioAlvo;
  alvoId: string;
  autorId: string;
  autorNome: string;
  texto: string;
  createdAt: string;
};

export const COMENTARIO_LIMITE = 2000;

type ComentarioRow = {
  id: string;
  pauta_id: string | null;
  aviso_id: string | null;
  autor_id: string | null;
  autor_nome: string | null;
  texto: string;
  created_at: string;
};

type BloqueioRow = { pauta_id: string | null; aviso_id: string | null };

const LOCAL_COMENTARIOS = "hub_comentarios_local";
const LOCAL_BLOQUEIOS = "hub_comentarios_bloqueios_local";
const EVENTO = "hub:comentarios";

function usaSupabase(user?: HubUser | null) {
  return Boolean(user && isSupabaseConfigured && supabase);
}

function coluna(alvo: ComentarioAlvo) {
  return alvo === "pauta" ? "pauta_id" : "aviso_id";
}

function mapRow(row: ComentarioRow): Comentario {
  return {
    id: row.id,
    alvo: row.pauta_id ? "pauta" : "aviso",
    alvoId: (row.pauta_id || row.aviso_id || "") as string,
    autorId: row.autor_id || "",
    autorNome: row.autor_nome || "Usuário removido",
    texto: row.texto,
    createdAt: row.created_at
  };
}

function avisarMudanca(alvo: ComentarioAlvo, alvoId: string) {
  window.dispatchEvent(new CustomEvent(EVENTO, { detail: { alvo, alvoId } }));
}

export function aoMudarComentarios(callback: (alvo: ComentarioAlvo, alvoId: string) => void) {
  const handler = (event: Event) => {
    const detail = (event as CustomEvent<{ alvo: ComentarioAlvo; alvoId: string }>).detail;
    if (detail) callback(detail.alvo, detail.alvoId);
  };
  window.addEventListener(EVENTO, handler);
  return () => window.removeEventListener(EVENTO, handler);
}

export function isAdmin(user?: HubUser | null) {
  return user?.role === "admin";
}

export function podeExcluirComentario(comentario: Comentario, user?: HubUser | null) {
  if (!user) return false;
  return isAdmin(user) || comentario.autorId === user.id || comentario.autorId === user.email;
}

function mensagemErro(error: unknown) {
  const texto = error && typeof error === "object" && "message" in error ? String((error as { message: string }).message) : String(error || "");
  if (/hub_comentar|hub_comentarios|schema cache|Could not find/i.test(texto)) {
    return "Comentários ainda não ativados no banco. Rode o SQL patch_comentarios.sql no Supabase.";
  }
  return texto || "Não foi possível concluir a ação.";
}

export async function listarComentarios(alvo: ComentarioAlvo, alvoId: string, user?: HubUser | null) {
  if (usaSupabase(user) && supabase) {
    const [{ data, error }, bloqueio] = await Promise.all([
      supabase
        .from("hub_comentarios")
        .select("id,pauta_id,aviso_id,autor_id,autor_nome,texto,created_at")
        .eq(coluna(alvo), alvoId)
        .order("created_at", { ascending: true }),
      supabase.from("hub_comentarios_bloqueios").select("pauta_id,aviso_id").eq(coluna(alvo), alvoId).maybeSingle()
    ]);
    if (error) throw new Error(mensagemErro(error));
    return { comentarios: ((data || []) as ComentarioRow[]).map(mapRow), bloqueado: Boolean(bloqueio.data) };
  }

  const todos = readStorage<Comentario[]>(LOCAL_COMENTARIOS, []);
  const bloqueios = readStorage<string[]>(LOCAL_BLOQUEIOS, []);
  return {
    comentarios: todos.filter((c) => c.alvo === alvo && c.alvoId === alvoId).sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    bloqueado: bloqueios.includes(`${alvo}:${alvoId}`)
  };
}

// Quantidade de comentários por item, numa consulta só (para os botões "Comentários (n)").
export async function contarComentarios(alvo: ComentarioAlvo, ids: string[], user?: HubUser | null) {
  const contagem: Record<string, number> = {};
  if (!ids.length) return contagem;

  if (usaSupabase(user) && supabase) {
    const { data, error } = await supabase.from("hub_comentarios").select(coluna(alvo)).in(coluna(alvo), ids);
    if (error) return contagem;
    for (const row of (data || []) as unknown as BloqueioRow[]) {
      const id = (alvo === "pauta" ? row.pauta_id : row.aviso_id) || "";
      if (id) contagem[id] = (contagem[id] || 0) + 1;
    }
    return contagem;
  }

  for (const c of readStorage<Comentario[]>(LOCAL_COMENTARIOS, [])) {
    if (c.alvo === alvo && ids.includes(c.alvoId)) contagem[c.alvoId] = (contagem[c.alvoId] || 0) + 1;
  }
  return contagem;
}

export async function comentar(alvo: ComentarioAlvo, alvoId: string, texto: string, user: HubUser) {
  const limpo = texto.trim();
  if (!limpo) throw new Error("Escreva o comentário.");
  if (limpo.length > COMENTARIO_LIMITE) throw new Error("O comentário pode ter até 2.000 caracteres.");

  if (usaSupabase(user) && supabase) {
    const { error } = await supabase.rpc("hub_comentar", { p_tipo: alvo, p_alvo: alvoId, p_texto: limpo });
    if (error) throw new Error(mensagemErro(error));
    avisarMudanca(alvo, alvoId);
    return;
  }

  const bloqueios = readStorage<string[]>(LOCAL_BLOQUEIOS, []);
  if (bloqueios.includes(`${alvo}:${alvoId}`) && !isAdmin(user)) {
    throw new Error(alvo === "pauta" ? "Os comentários desta pauta foram bloqueados pela coordenação." : "Os comentários deste aviso foram bloqueados pela coordenação.");
  }
  const todos = readStorage<Comentario[]>(LOCAL_COMENTARIOS, []);
  todos.push({
    id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    alvo,
    alvoId,
    autorId: user.id || user.email,
    autorNome: user.nome || user.email,
    texto: limpo,
    createdAt: new Date().toISOString()
  });
  writeStorage(LOCAL_COMENTARIOS, todos);
  avisarMudanca(alvo, alvoId);
}

export async function excluirComentario(comentario: Comentario, user: HubUser) {
  if (!podeExcluirComentario(comentario, user)) throw new Error("Só o autor ou um administrador pode excluir este comentário.");

  if (usaSupabase(user) && supabase) {
    const { error } = await supabase.rpc("hub_comentario_excluir", { p_id: comentario.id });
    if (error) throw new Error(mensagemErro(error));
  } else {
    writeStorage(
      LOCAL_COMENTARIOS,
      readStorage<Comentario[]>(LOCAL_COMENTARIOS, []).filter((c) => c.id !== comentario.id)
    );
  }
  avisarMudanca(comentario.alvo, comentario.alvoId);
}

export async function bloquearComentarios(alvo: ComentarioAlvo, alvoId: string, bloquear: boolean, user: HubUser) {
  if (!isAdmin(user)) throw new Error("Só administradores podem bloquear comentários.");

  if (usaSupabase(user) && supabase) {
    const { error } = await supabase.rpc("hub_comentarios_bloquear", { p_tipo: alvo, p_alvo: alvoId, p_bloquear: bloquear });
    if (error) throw new Error(mensagemErro(error));
  } else {
    const chave = `${alvo}:${alvoId}`;
    const atuais = readStorage<string[]>(LOCAL_BLOQUEIOS, []).filter((item) => item !== chave);
    writeStorage(LOCAL_BLOQUEIOS, bloquear ? [...atuais, chave] : atuais);
  }
  avisarMudanca(alvo, alvoId);
}
