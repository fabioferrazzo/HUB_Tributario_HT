import type { HubUser } from "../types";
import { readStorage, writeStorage } from "./storage";
import { isSupabaseConfigured, supabase } from "./supabase";

// Chat entre usuários do HUB (conversas individuais e grupos).
// Supabase: tabelas chat_* e funções chat_* (supabase/patch_chat.sql), tempo real pelo canal do Supabase.
// Demonstração (sem Supabase): guardado neste navegador, com as mesmas regras.

export type ChatTipo = "direta" | "grupo";

export type ChatParticipante = { id: string; nome: string; email: string; papel: "membro" | "dono" };

export type ChatAnexo = { path: string; nome: string; tamanho: number; tipo: string };

export type ChatMensagem = {
  id: string;
  conversaId: string;
  autorId: string;
  autorNome: string;
  conteudo: string;
  anexos: ChatAnexo[];
  tipo: "texto" | "sistema" | "atencao";
  createdAt: string;
};

export type ChatConversa = {
  id: string;
  tipo: ChatTipo;
  nome: string;
  criadoPor: string;
  ultimaMensagemEm: string;
  papel: "membro" | "dono";
  lidoAte: string;
  participantes: ChatParticipante[];
  naoLidas: number;
  ultima?: { autor: string; conteudo: string; tipo: string; anexos: number; em: string } | null;
};

export type ChamadoResultado = { ok: boolean; restantes: number; liberadoEm?: string };

export const CHAT_RETENCAO_DIAS = 30;
export const CHAT_ANEXO_MAX = 10 * 1024 * 1024;
const BUCKET = "hub-anexos";
const LOCAL_KEY = "hub_chat_local";
const EVENTO = "hub:chat";

export function chatUsaSupabase(user?: HubUser | null) {
  return Boolean(user && isSupabaseConfigured && supabase);
}

function erroLegivel(error: unknown) {
  const texto = error && typeof error === "object" && "message" in error ? String((error as { message: string }).message) : String(error || "");
  if (/chat_|schema cache|Could not find the function/i.test(texto) && /function|relation|schema/i.test(texto)) {
    return new Error("O chat ainda não foi ativado no banco. Rode o SQL patch_chat.sql no Supabase.");
  }
  return new Error(texto || "Não foi possível concluir a ação no chat.");
}

export function uid(user: HubUser) {
  return user.id || user.email;
}

function avisarMudanca() {
  window.dispatchEvent(new CustomEvent(EVENTO));
}

export function nomeDaConversa(conversa: ChatConversa, user: HubUser) {
  if (conversa.tipo === "grupo") return conversa.nome || "Grupo";
  const outro = conversa.participantes.find((p) => p.id !== uid(user));
  return outro?.nome || "Conversa";
}

function mapMensagem(row: Record<string, unknown>): ChatMensagem {
  return {
    id: String(row.id),
    conversaId: String(row.conversa_id),
    autorId: String(row.autor_id || ""),
    autorNome: String(row.autor_nome || ""),
    conteudo: String(row.conteudo || ""),
    anexos: Array.isArray(row.anexos) ? (row.anexos as ChatAnexo[]) : [],
    tipo: (row.tipo as ChatMensagem["tipo"]) || "texto",
    createdAt: String(row.created_at)
  };
}

function nomeArquivoSeguro(nome: string) {
  const base = nome.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-");
  return base.slice(-80) || "arquivo";
}

// ---------------------------------------------------------------------------------- modo local
type LocalDados = {
  conversas: Array<Omit<ChatConversa, "papel" | "lidoAte" | "participantes" | "naoLidas" | "ultima"> & { chave?: string }>;
  participantes: Array<{ conversaId: string; userId: string; nome: string; email: string; papel: "membro" | "dono"; lidoAte: string; entrouEm: string }>;
  mensagens: ChatMensagem[];
  chamados: Array<{ id: string; conversaId: string; remetenteId: string; remetenteNome: string; createdAt: string }>;
};

export type ChatPessoa = { id: string; nome: string; email: string };

function lerLocal(): LocalDados {
  const dados = readStorage<LocalDados>(LOCAL_KEY, { conversas: [], participantes: [], mensagens: [], chamados: [] });
  const corte = Date.now() - CHAT_RETENCAO_DIAS * 864e5;
  dados.mensagens = dados.mensagens.filter((m) => Date.parse(m.createdAt) >= corte);
  return dados;
}

function gravarLocal(dados: LocalDados) {
  writeStorage(LOCAL_KEY, dados);
  avisarMudanca();
}

function novoId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function localParticipa(dados: LocalDados, conversaId: string, userId: string) {
  return dados.participantes.some((p) => p.conversaId === conversaId && p.userId === userId);
}

function exigirLocal(dados: LocalDados, conversaId: string, user: HubUser) {
  if (!localParticipa(dados, conversaId, uid(user))) throw new Error("Você não participa desta conversa.");
}

function sistemaLocal(dados: LocalDados, conversaId: string, texto: string) {
  dados.mensagens.push({ id: novoId(), conversaId, autorId: "", autorNome: "", conteudo: texto, anexos: [], tipo: "sistema", createdAt: new Date().toISOString() });
}

// ------------------------------------------------------------------------------------- leitura
export async function listarConversas(user: HubUser): Promise<ChatConversa[]> {
  if (chatUsaSupabase(user) && supabase) {
    const { data, error } = await supabase.rpc("chat_minhas_conversas");
    if (error) throw erroLegivel(error);
    return (Array.isArray(data) ? data : []) as ChatConversa[];
  }
  const dados = lerLocal();
  return dados.conversas
    .filter((c) => localParticipa(dados, c.id, uid(user)))
    .map((c) => {
      const eu = dados.participantes.find((p) => p.conversaId === c.id && p.userId === uid(user))!;
      const msgs = dados.mensagens.filter((m) => m.conversaId === c.id);
      const ultima = msgs[msgs.length - 1];
      return {
        ...c,
        papel: eu.papel,
        lidoAte: eu.lidoAte,
        participantes: dados.participantes
          .filter((p) => p.conversaId === c.id)
          .map((p) => ({ id: p.userId, nome: p.nome, email: p.email, papel: p.papel })),
        naoLidas: msgs.filter((m) => m.createdAt > eu.lidoAte && m.autorId !== uid(user) && m.tipo !== "sistema").length,
        ultima: ultima
          ? { autor: ultima.autorNome, conteudo: ultima.conteudo.replace(/<[^>]*>/g, " ").slice(0, 140), tipo: ultima.tipo, anexos: ultima.anexos.length, em: ultima.createdAt }
          : null
      };
    })
    .sort((a, b) => b.ultimaMensagemEm.localeCompare(a.ultimaMensagemEm));
}

export async function listarMensagens(conversaId: string, user: HubUser): Promise<ChatMensagem[]> {
  if (chatUsaSupabase(user) && supabase) {
    const { data, error } = await supabase
      .from("chat_mensagens")
      .select("id,conversa_id,autor_id,autor_nome,conteudo,anexos,tipo,created_at")
      .eq("conversa_id", conversaId)
      .order("created_at", { ascending: true })
      .limit(1000);
    if (error) throw erroLegivel(error);
    return (data || []).map((row) => mapMensagem(row as Record<string, unknown>));
  }
  const dados = lerLocal();
  exigirLocal(dados, conversaId, user);
  return dados.mensagens.filter((m) => m.conversaId === conversaId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

// ------------------------------------------------------------------------------------ conversas
export async function abrirDireta(outro: ChatPessoa, user: HubUser): Promise<string> {
  if (chatUsaSupabase(user) && supabase) {
    const { data, error } = await supabase.rpc("chat_abrir_direta", { p_outro: outro.id });
    if (error) throw erroLegivel(error);
    return String(data);
  }
  if (!outro.id || outro.id === uid(user)) throw new Error("Escolha outra pessoa para conversar.");
  const dados = lerLocal();
  const chave = [uid(user), outro.id].sort().join(":");
  const existente = dados.conversas.find((c) => c.chave === chave);
  const conversa = existente || { id: novoId(), tipo: "direta" as const, nome: "", chave, criadoPor: uid(user), ultimaMensagemEm: new Date().toISOString() };
  if (!existente) dados.conversas.push(conversa);
  for (const pessoa of [{ id: uid(user), nome: user.nome, email: user.email }, outro]) {
    if (!localParticipa(dados, conversa.id, pessoa.id)) {
      dados.participantes.push({ conversaId: conversa.id, userId: pessoa.id, nome: pessoa.nome, email: pessoa.email, papel: "membro", lidoAte: new Date().toISOString(), entrouEm: new Date().toISOString() });
    }
  }
  gravarLocal(dados);
  return conversa.id;
}

export async function criarGrupo(nome: string, membros: ChatPessoa[], user: HubUser): Promise<string> {
  const limpo = nome.trim();
  if (!limpo) throw new Error("Dê um nome ao grupo.");
  if (limpo.length > 80) throw new Error("O nome do grupo pode ter até 80 caracteres.");
  if (chatUsaSupabase(user) && supabase) {
    const { data, error } = await supabase.rpc("chat_criar_grupo", { p_nome: limpo, p_membros: membros.map((m) => m.id) });
    if (error) throw erroLegivel(error);
    avisarMudanca();
    return String(data);
  }
  const dados = lerLocal();
  const agora = new Date().toISOString();
  const id = novoId();
  dados.conversas.push({ id, tipo: "grupo", nome: limpo, criadoPor: uid(user), ultimaMensagemEm: agora });
  dados.participantes.push({ conversaId: id, userId: uid(user), nome: user.nome, email: user.email, papel: "dono", lidoAte: agora, entrouEm: agora });
  for (const m of membros.filter((m) => m.id !== uid(user))) {
    dados.participantes.push({ conversaId: id, userId: m.id, nome: m.nome, email: m.email, papel: "membro", lidoAte: agora, entrouEm: agora });
  }
  sistemaLocal(dados, id, `${user.nome} criou o grupo "${limpo}".`);
  gravarLocal(dados);
  return id;
}

export async function alterarGrupo(conversa: ChatConversa, nome: string, adicionar: ChatPessoa[], remover: string[], user: HubUser) {
  if (chatUsaSupabase(user) && supabase) {
    const { error } = await supabase.rpc("chat_grupo_alterar", {
      p_conversa: conversa.id,
      p_nome: nome.trim(),
      p_adicionar: adicionar.map((p) => p.id),
      p_remover: remover
    });
    if (error) throw erroLegivel(error);
    avisarMudanca();
    return;
  }
  const dados = lerLocal();
  const eu = dados.participantes.find((p) => p.conversaId === conversa.id && p.userId === uid(user));
  if (!eu || eu.papel !== "dono") throw new Error("Só quem criou o grupo pode alterá-lo.");
  const c = dados.conversas.find((x) => x.id === conversa.id)!;
  if (nome.trim() && nome.trim() !== c.nome) {
    c.nome = nome.trim();
    sistemaLocal(dados, c.id, `${user.nome} renomeou o grupo para "${c.nome}".`);
  }
  const agora = new Date().toISOString();
  for (const p of adicionar) {
    if (!localParticipa(dados, c.id, p.id)) {
      dados.participantes.push({ conversaId: c.id, userId: p.id, nome: p.nome, email: p.email, papel: "membro", lidoAte: agora, entrouEm: agora });
      sistemaLocal(dados, c.id, `${user.nome} adicionou ${p.nome}.`);
    }
  }
  for (const id of remover.filter((id) => id !== uid(user))) {
    const alvo = dados.participantes.find((p) => p.conversaId === c.id && p.userId === id);
    if (alvo) {
      dados.participantes = dados.participantes.filter((p) => p !== alvo);
      sistemaLocal(dados, c.id, `${user.nome} removeu ${alvo.nome}.`);
    }
  }
  gravarLocal(dados);
}

export async function sairDoGrupo(conversa: ChatConversa, user: HubUser) {
  if (chatUsaSupabase(user) && supabase) {
    const { error } = await supabase.rpc("chat_sair_grupo", { p_conversa: conversa.id });
    if (error) throw erroLegivel(error);
    avisarMudanca();
    return;
  }
  const dados = lerLocal();
  const eu = dados.participantes.find((p) => p.conversaId === conversa.id && p.userId === uid(user));
  if (!eu) return;
  dados.participantes = dados.participantes.filter((p) => p !== eu);
  sistemaLocal(dados, conversa.id, `${user.nome} saiu do grupo.`);
  if (eu.papel === "dono") {
    const restante = dados.participantes.filter((p) => p.conversaId === conversa.id).sort((a, b) => a.entrouEm.localeCompare(b.entrouEm))[0];
    if (restante) restante.papel = "dono";
    else dados.conversas = dados.conversas.filter((c) => c.id !== conversa.id);
  }
  gravarLocal(dados);
}

// ------------------------------------------------------------------------------------ mensagens
async function arquivoParaDataUrl(arquivo: File) {
  return new Promise<string>((resolve, reject) => {
    const leitor = new FileReader();
    leitor.onload = () => resolve(String(leitor.result));
    leitor.onerror = () => reject(new Error("Não foi possível ler o arquivo."));
    leitor.readAsDataURL(arquivo);
  });
}

export async function enviarMensagem(conversaId: string, html: string, arquivos: File[], user: HubUser) {
  for (const arquivo of arquivos) {
    if (arquivo.size > CHAT_ANEXO_MAX) throw new Error(`"${arquivo.name}" passa de 10 MB.`);
  }
  if (arquivos.length > 10) throw new Error("Envie até 10 arquivos por mensagem.");

  if (chatUsaSupabase(user) && supabase) {
    const anexos: ChatAnexo[] = [];
    for (const arquivo of arquivos) {
      const path = `chat/${conversaId}/${novoId()}-${nomeArquivoSeguro(arquivo.name)}`;
      const { error } = await supabase.storage.from(BUCKET).upload(path, arquivo, { upsert: false, contentType: arquivo.type || undefined });
      if (error) {
        if (anexos.length) await supabase.storage.from(BUCKET).remove(anexos.map((a) => a.path));
        throw erroLegivel(error);
      }
      anexos.push({ path, nome: arquivo.name, tamanho: arquivo.size, tipo: arquivo.type || "" });
    }
    const { error } = await supabase.rpc("chat_enviar", { p_conversa: conversaId, p_conteudo: html, p_anexos: anexos });
    if (error) {
      if (anexos.length) await supabase.storage.from(BUCKET).remove(anexos.map((a) => a.path));
      throw erroLegivel(error);
    }
    avisarMudanca();
    return;
  }

  const dados = lerLocal();
  exigirLocal(dados, conversaId, user);
  const anexos: ChatAnexo[] = [];
  for (const arquivo of arquivos) {
    if (arquivo.size > 2 * 1024 * 1024) throw new Error("No modo de demonstração, anexos de até 2 MB.");
    anexos.push({ path: await arquivoParaDataUrl(arquivo), nome: arquivo.name, tamanho: arquivo.size, tipo: arquivo.type || "" });
  }
  if (!html.replace(/<[^>]*>|&nbsp;/g, "").trim() && !anexos.length) throw new Error("Escreva a mensagem ou anexe um arquivo.");
  const agora = new Date().toISOString();
  dados.mensagens.push({ id: novoId(), conversaId, autorId: uid(user), autorNome: user.nome, conteudo: html, anexos, tipo: "texto", createdAt: agora });
  const c = dados.conversas.find((x) => x.id === conversaId);
  if (c) c.ultimaMensagemEm = agora;
  const eu = dados.participantes.find((p) => p.conversaId === conversaId && p.userId === uid(user));
  if (eu) eu.lidoAte = agora;
  gravarLocal(dados);
}

export async function excluirMensagem(mensagem: ChatMensagem, user: HubUser) {
  if (mensagem.autorId !== uid(user)) throw new Error("Só quem escreveu pode apagar a mensagem.");
  if (chatUsaSupabase(user) && supabase) {
    const { data, error } = await supabase.rpc("chat_excluir_mensagem", { p_id: mensagem.id });
    if (error) throw erroLegivel(error);
    const paths = (Array.isArray(data) ? (data as ChatAnexo[]) : []).map((a) => a.path).filter(Boolean);
    if (paths.length) await supabase.storage.from(BUCKET).remove(paths);
    avisarMudanca();
    return;
  }
  const dados = lerLocal();
  dados.mensagens = dados.mensagens.filter((m) => m.id !== mensagem.id);
  gravarLocal(dados);
}

export async function marcarLida(conversaId: string, user: HubUser) {
  if (chatUsaSupabase(user) && supabase) {
    await supabase.rpc("chat_marcar_lido", { p_conversa: conversaId });
    return;
  }
  const dados = lerLocal();
  const eu = dados.participantes.find((p) => p.conversaId === conversaId && p.userId === uid(user));
  if (eu) {
    eu.lidoAte = new Date().toISOString();
    writeStorage(LOCAL_KEY, dados);
  }
}

export async function chamarAtencao(conversaId: string, user: HubUser): Promise<ChamadoResultado> {
  if (chatUsaSupabase(user) && supabase) {
    const { data, error } = await supabase.rpc("chat_chamar_atencao", { p_conversa: conversaId });
    if (error) throw erroLegivel(error);
    avisarMudanca();
    return data as ChamadoResultado;
  }
  const dados = lerLocal();
  exigirLocal(dados, conversaId, user);
  const meus = dados.chamados
    .filter((c) => c.conversaId === conversaId && c.remetenteId === uid(user))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 3);
  const agora = Date.now();
  if (meus.length === 3 && Date.parse(meus[0].createdAt) - Date.parse(meus[2].createdAt) <= 30 * 60e3 && Date.parse(meus[0].createdAt) > agora - 30 * 60e3) {
    return { ok: false, restantes: 0, liberadoEm: new Date(Date.parse(meus[0].createdAt) + 30 * 60e3).toISOString() };
  }
  const iso = new Date(agora).toISOString();
  dados.chamados.push({ id: novoId(), conversaId, remetenteId: uid(user), remetenteNome: user.nome, createdAt: iso });
  dados.mensagens.push({ id: novoId(), conversaId, autorId: uid(user), autorNome: user.nome, conteudo: `${user.nome} chamou a atenção.`, anexos: [], tipo: "atencao", createdAt: iso });
  const c = dados.conversas.find((x) => x.id === conversaId);
  if (c) c.ultimaMensagemEm = iso;
  gravarLocal(dados);
  const recentes = dados.chamados.filter((c) => c.conversaId === conversaId && c.remetenteId === uid(user) && Date.parse(c.createdAt) > agora - 30 * 60e3).length;
  return { ok: true, restantes: Math.max(0, 3 - recentes) };
}

export async function urlDoAnexo(anexo: ChatAnexo, user: HubUser) {
  if (anexo.path.startsWith("data:")) return anexo.path;
  if (chatUsaSupabase(user) && supabase) {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(anexo.path, 60 * 60);
    if (error || !data?.signedUrl) throw new Error("Anexo indisponível (pode ter sido apagado).");
    return data.signedUrl;
  }
  throw new Error("Anexo indisponível.");
}

// ------------------------------------------------------------------------------ tempo real
// Avisa quando chega mensagem ou chamado. No Supabase usa o canal em tempo real (com as regras de leitura);
// no modo local, os eventos do navegador. O painel também recarrega periodicamente como garantia.
export function assinarChat(
  user: HubUser,
  handlers: { onMensagem: (m: ChatMensagem) => void; onChamado: (c: { conversaId: string; remetenteId: string; remetenteNome: string; id: string }) => void; onMudanca: () => void }
) {
  const aoMudarLocal = () => handlers.onMudanca();
  window.addEventListener(EVENTO, aoMudarLocal);

  let canal: ReturnType<NonNullable<typeof supabase>["channel"]> | null = null;
  let vistos = new Set<string>();

  if (chatUsaSupabase(user) && supabase) {
    canal = supabase
      .channel(`hub-chat-${uid(user)}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_mensagens" }, (payload) => {
        handlers.onMensagem(mapMensagem(payload.new as Record<string, unknown>));
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_chamados" }, (payload) => {
        const row = payload.new as Record<string, unknown>;
        handlers.onChamado({ id: String(row.id), conversaId: String(row.conversa_id), remetenteId: String(row.remetente_id || ""), remetenteNome: String(row.remetente_nome || "") });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "chat_participantes" }, () => handlers.onMudanca())
      .subscribe();
  } else {
    // Outras abas/janelas deste navegador (modo local): compara chamados novos.
    vistos = new Set(lerLocal().chamados.map((c) => c.id));
    const aoArmazenar = (event: StorageEvent) => {
      if (event.key !== LOCAL_KEY) return;
      const dados = lerLocal();
      for (const c of dados.chamados) {
        if (!vistos.has(c.id)) {
          vistos.add(c.id);
          handlers.onChamado({ id: c.id, conversaId: c.conversaId, remetenteId: c.remetenteId, remetenteNome: c.remetenteNome });
        }
      }
      handlers.onMudanca();
    };
    window.addEventListener("storage", aoArmazenar);
    return () => {
      window.removeEventListener(EVENTO, aoMudarLocal);
      window.removeEventListener("storage", aoArmazenar);
    };
  }

  return () => {
    window.removeEventListener(EVENTO, aoMudarLocal);
    if (canal && supabase) void supabase.removeChannel(canal);
  };
}

// --------------------------------------------------------------------------------- backup
export type ChatBackup = { conversa: ChatConversa; mensagens: ChatMensagem[] }[];

export async function carregarBackup(user: HubUser): Promise<ChatBackup> {
  const conversas = await listarConversas(user);
  const resultado: ChatBackup = [];
  for (const conversa of conversas) {
    resultado.push({ conversa, mensagens: await listarMensagens(conversa.id, user) });
  }
  return resultado;
}

// Quantas mensagens das minhas conversas serão apagadas nos próximos dias (mais antigas que 30 - antecedência).
export async function contarMensagensExpirando(user: HubUser, antecedenciaDias = 3) {
  const corte = new Date(Date.now() - (CHAT_RETENCAO_DIAS - antecedenciaDias) * 864e5).toISOString();
  if (chatUsaSupabase(user) && supabase) {
    const { count, error } = await supabase.from("chat_mensagens").select("id", { count: "exact", head: true }).lt("created_at", corte);
    if (error) return 0;
    return count || 0;
  }
  const dados = lerLocal();
  return dados.mensagens.filter((m) => m.createdAt < corte && localParticipa(dados, m.conversaId, uid(user))).length;
}
