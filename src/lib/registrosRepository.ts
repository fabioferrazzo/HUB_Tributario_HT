// Aba Registros: aberturas, alterações contratuais e clientes novos.
// Supabase (tabelas hub_registros, hub_registros_eventos, hub_registros_anexos) ou, sem Supabase,
// modo demonstração no navegador. A consulta à Receita e o aviso ao responsável passam pela
// função do servidor netlify/functions/registros.mjs.
import type { DadosReceita, HubUser, RegistroAnexo, RegistroEmpresa, RegistroEvento, RegistroStatus, RegistroTipo } from "../types";
import { getSupabaseAccessToken } from "./auth";
import { readStorage, writeStorage } from "./storage";
import { isSupabaseConfigured, supabase } from "./supabase";

const STORAGE_KEY = "hub_registros_app";
const STORAGE_BUCKET = "hub-anexos";
const ANEXO_MAX_BYTES = 25 * 1024 * 1024;

export const ROTULO_TIPO_REGISTRO: Record<RegistroTipo, string> = {
  abertura: "Abertura",
  alteracao: "Alteração contratual",
  cliente_novo: "Cliente novo",
  outro: "Outro"
};

export const ROTULO_STATUS_REGISTRO: Record<RegistroStatus, string> = {
  revisao: "Aguardando revisão",
  ativo: "Ativo",
  arquivado: "Arquivado"
};

export const REGIMES_SUGERIDOS = ["MEI", "Simples Nacional", "Lucro Presumido", "Lucro Real", "Lucro Arbitrado", "Imune/Isenta"];

type LocalState = { registros: RegistroEmpresa[]; eventos: RegistroEvento[]; anexos: RegistroAnexo[] };

type RegistroRow = {
  id: string;
  cnpj: string;
  razao_social: string;
  nome_fantasia: string;
  ie: string;
  codigo_dominio: string;
  regime: string;
  data_inicio: string | null;
  situacao_cadastral: string;
  natureza_juridica: string;
  municipio: string;
  uf: string;
  socios: RegistroEmpresa["socios"] | null;
  cnae_principal: RegistroEmpresa["cnaePrincipal"];
  cnaes_secundarios: RegistroEmpresa["cnaesSecundarios"] | null;
  receita_atualizada_em: string | null;
  observacoes: string;
  tipo: RegistroTipo;
  status: RegistroStatus;
  origem: "manual" | "email";
  responsavel_id: string | null;
  responsavel_definido_em: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export function getRegistrosSource(): "supabase" | "local" {
  return isSupabaseConfigured ? "supabase" : "local";
}

// ---------------------------------------------------------------------------------------------
// CNPJ (mesma regra do servidor)

export function somenteDigitos(valor: string) {
  return String(valor || "").replace(/\D/g, "");
}

export function cnpjValido(valor: string) {
  const cnpj = somenteDigitos(valor);
  if (!/^\d{14}$/.test(cnpj) || /^(\d)\1{13}$/.test(cnpj)) return false;
  const digito = (base: string) => {
    let soma = 0;
    let peso = base.length - 7;
    for (const n of base) {
      soma += Number(n) * peso--;
      if (peso < 2) peso = 9;
    }
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };
  const d1 = digito(cnpj.slice(0, 12));
  const d2 = digito(cnpj.slice(0, 12) + d1);
  return cnpj.endsWith(`${d1}${d2}`);
}

export function formatarCnpj(valor: string) {
  const d = somenteDigitos(valor);
  return d.length === 14 ? `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}` : d;
}

// ---------------------------------------------------------------------------------------------
// Conversões

function mapRegistro(row: RegistroRow): RegistroEmpresa {
  return {
    id: row.id,
    cnpj: row.cnpj || "",
    razaoSocial: row.razao_social || "",
    nomeFantasia: row.nome_fantasia || "",
    ie: row.ie || "",
    codigoDominio: row.codigo_dominio || "",
    regime: row.regime || "",
    dataInicio: row.data_inicio || "",
    situacao: row.situacao_cadastral || "",
    naturezaJuridica: row.natureza_juridica || "",
    municipio: row.municipio || "",
    uf: row.uf || "",
    socios: Array.isArray(row.socios) ? row.socios : [],
    cnaePrincipal: row.cnae_principal || null,
    cnaesSecundarios: Array.isArray(row.cnaes_secundarios) ? row.cnaes_secundarios : [],
    receitaAtualizadaEm: row.receita_atualizada_em || "",
    observacoes: row.observacoes || "",
    tipo: row.tipo,
    status: row.status,
    origem: row.origem,
    responsavelId: row.responsavel_id || "",
    responsavelDefinidoEm: row.responsavel_definido_em || "",
    createdBy: row.created_by || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function linhaEditavel(registro: RegistroEmpresa) {
  return {
    cnpj: somenteDigitos(registro.cnpj),
    razao_social: registro.razaoSocial.trim(),
    nome_fantasia: registro.nomeFantasia.trim(),
    ie: registro.ie.trim(),
    codigo_dominio: registro.codigoDominio.trim(),
    regime: registro.regime.trim(),
    data_inicio: registro.dataInicio || null,
    situacao_cadastral: registro.situacao,
    natureza_juridica: registro.naturezaJuridica,
    municipio: registro.municipio,
    uf: registro.uf,
    socios: registro.socios,
    cnae_principal: registro.cnaePrincipal,
    cnaes_secundarios: registro.cnaesSecundarios,
    receita_atualizada_em: registro.receitaAtualizadaEm || null,
    observacoes: registro.observacoes,
    tipo: registro.tipo,
    status: registro.status
  };
}

export function aplicarDadosReceita(registro: RegistroEmpresa, dados: DadosReceita): RegistroEmpresa {
  return {
    ...registro,
    cnpj: dados.cnpj || registro.cnpj,
    razaoSocial: dados.razaoSocial || registro.razaoSocial,
    nomeFantasia: dados.nomeFantasia,
    dataInicio: dados.dataInicio || registro.dataInicio,
    situacao: dados.situacao,
    naturezaJuridica: dados.naturezaJuridica,
    municipio: dados.municipio,
    uf: dados.uf,
    socios: dados.socios,
    cnaePrincipal: dados.cnaePrincipal,
    cnaesSecundarios: dados.cnaesSecundarios,
    regime: registro.regime || dados.regimeSugerido,
    receitaAtualizadaEm: dados.consultadoEm
  };
}

export function novoRegistroVazio(user: HubUser, tipo: RegistroTipo = "abertura"): RegistroEmpresa {
  const agora = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    cnpj: "",
    razaoSocial: "",
    nomeFantasia: "",
    ie: "",
    codigoDominio: "",
    regime: "",
    dataInicio: "",
    situacao: "",
    naturezaJuridica: "",
    municipio: "",
    uf: "",
    socios: [],
    cnaePrincipal: null,
    cnaesSecundarios: [],
    receitaAtualizadaEm: "",
    observacoes: "",
    tipo,
    status: "revisao",
    origem: "manual",
    responsavelId: "",
    responsavelDefinidoEm: "",
    createdBy: user.id || user.email,
    createdAt: agora,
    updatedAt: agora
  };
}

function lerLocal(): LocalState {
  const estado = readStorage<Partial<LocalState>>(STORAGE_KEY, {});
  return { registros: estado.registros || [], eventos: estado.eventos || [], anexos: estado.anexos || [] };
}

function gravarLocal(estado: LocalState) {
  writeStorage(STORAGE_KEY, estado);
}

function assertSupabase() {
  if (!isSupabaseConfigured || !supabase) throw new Error("Supabase não configurado.");
  return supabase;
}

function ordenar(lista: RegistroEmpresa[]) {
  return [...lista].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

// ---------------------------------------------------------------------------------------------
// Registros

export async function listRegistros(): Promise<RegistroEmpresa[]> {
  if (getRegistrosSource() === "local") return ordenar(lerLocal().registros);
  const { data, error } = await assertSupabase().from("hub_registros").select("*").order("updated_at", { ascending: false });
  if (error) {
    if (error.code === "42P01" || error.code === "PGRST205" || /hub_registros/.test(error.message || "")) {
      throw new Error("A aba Registros ainda não foi ativada no banco: rode o arquivo supabase/patch_registros.sql no SQL Editor do Supabase.");
    }
    throw error;
  }
  return ((data || []) as RegistroRow[]).map(mapRegistro);
}

export async function saveRegistro(registro: RegistroEmpresa, user: HubUser, criando: boolean): Promise<RegistroEmpresa> {
  const cnpj = somenteDigitos(registro.cnpj);
  if (cnpj && !cnpjValido(cnpj)) throw new Error("CNPJ inválido. Confira os 14 dígitos.");
  if (!cnpj && !registro.razaoSocial.trim()) throw new Error("Informe o CNPJ ou a razão social.");

  if (getRegistrosSource() === "local") {
    const estado = lerLocal();
    if (cnpj && estado.registros.some((item) => item.cnpj === cnpj && item.id !== registro.id)) {
      throw new Error("Já existe um registro com este CNPJ.");
    }
    const salvo = { ...registro, cnpj, updatedAt: new Date().toISOString() };
    estado.registros = [salvo, ...estado.registros.filter((item) => item.id !== registro.id)];
    if (criando) {
      estado.eventos.unshift(novoEventoLocal(salvo.id, salvo.tipo, "Registro criado manualmente.", user));
    }
    gravarLocal(estado);
    return salvo;
  }

  const client = assertSupabase();
  if (criando) {
    const { data, error } = await client
      .from("hub_registros")
      .insert({ id: registro.id, ...linhaEditavel(registro), origem: "manual", created_by: user.id })
      .select("*")
      .single();
    if (error) throw traduzirErro(error);
    await client.from("hub_registros_eventos").insert({
      registro_id: registro.id,
      tipo: registro.tipo,
      resumo: "Registro criado manualmente.",
      created_by: user.id
    });
    return mapRegistro(data as RegistroRow);
  }
  const { data, error } = await client.from("hub_registros").update(linhaEditavel(registro)).eq("id", registro.id).select("*").single();
  if (error) throw traduzirErro(error);
  return mapRegistro(data as RegistroRow);
}

export async function deleteRegistro(registro: RegistroEmpresa): Promise<void> {
  if (getRegistrosSource() === "local") {
    const estado = lerLocal();
    estado.registros = estado.registros.filter((item) => item.id !== registro.id);
    estado.eventos = estado.eventos.filter((item) => item.registroId !== registro.id);
    estado.anexos = estado.anexos.filter((item) => item.registroId !== registro.id);
    gravarLocal(estado);
    return;
  }
  const client = assertSupabase();
  const anexos = await listAnexos(registro.id);
  if (anexos.length) await client.storage.from(STORAGE_BUCKET).remove(anexos.map((item) => item.storagePath));
  const { error } = await client.from("hub_registros").delete().eq("id", registro.id);
  if (error) throw traduzirErro(error);
}

function traduzirErro(error: { message?: string; code?: string }) {
  if (error?.code === "23505") return new Error("Já existe um registro com este CNPJ.");
  return new Error(error?.message || "Não foi possível gravar o registro.");
}

// ---------------------------------------------------------------------------------------------
// Eventos (histórico do registro)

function novoEventoLocal(registroId: string, tipo: RegistroEvento["tipo"], resumo: string, user: HubUser): RegistroEvento {
  return {
    id: crypto.randomUUID(),
    registroId,
    tipo,
    resumo,
    assunto: "",
    remetente: "",
    createdBy: user.nome || user.email,
    createdAt: new Date().toISOString()
  };
}

export async function listEventos(registroId: string): Promise<RegistroEvento[]> {
  if (getRegistrosSource() === "local") {
    return lerLocal()
      .eventos.filter((item) => item.registroId === registroId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  const { data, error } = await assertSupabase()
    .from("hub_registros_eventos")
    .select("id,registro_id,tipo,resumo,assunto,remetente,created_by,created_at")
    .eq("registro_id", registroId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data || []).map((row) => ({
    id: row.id,
    registroId: row.registro_id,
    tipo: row.tipo,
    resumo: row.resumo || "",
    assunto: row.assunto || "",
    remetente: row.remetente || "",
    createdBy: row.created_by || "",
    createdAt: row.created_at
  }));
}

export async function registrarEvento(registroId: string, tipo: RegistroEvento["tipo"], resumo: string, user: HubUser) {
  if (getRegistrosSource() === "local") {
    const estado = lerLocal();
    estado.eventos.unshift(novoEventoLocal(registroId, tipo, resumo, user));
    gravarLocal(estado);
    return;
  }
  await assertSupabase().from("hub_registros_eventos").insert({ registro_id: registroId, tipo, resumo, created_by: user.id });
}

// ---------------------------------------------------------------------------------------------
// Anexos

function nomeSeguro(nome: string) {
  return (
    String(nome || "anexo")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^\w.\- ]+/g, "_")
      .replace(/\s+/g, "_")
      .slice(-120) || "anexo"
  );
}

export async function listAnexos(registroId: string): Promise<RegistroAnexo[]> {
  if (getRegistrosSource() === "local") {
    return lerLocal()
      .anexos.filter((item) => item.registroId === registroId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  const { data, error } = await assertSupabase()
    .from("hub_registros_anexos")
    .select("id,registro_id,file_name,storage_path,mime_type,size_bytes,created_by,created_at")
    .eq("registro_id", registroId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data || []).map((row) => ({
    id: row.id,
    registroId: row.registro_id,
    fileName: row.file_name,
    storagePath: row.storage_path,
    mimeType: row.mime_type || "",
    sizeBytes: Number(row.size_bytes || 0),
    createdBy: row.created_by || "",
    createdAt: row.created_at
  }));
}

function lerComoDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const leitor = new FileReader();
    leitor.onload = () => resolve(String(leitor.result || ""));
    leitor.onerror = () => reject(new Error("Não foi possível ler o arquivo."));
    leitor.readAsDataURL(file);
  });
}

export async function uploadAnexo(registroId: string, file: File, user: HubUser): Promise<RegistroAnexo> {
  if (file.size > ANEXO_MAX_BYTES) throw new Error("Arquivo acima de 25 MB.");
  const nome = nomeSeguro(file.name);
  const caminho = `registros/${registroId}/${crypto.randomUUID()}-${nome}`;

  if (getRegistrosSource() === "local") {
    const anexo: RegistroAnexo = {
      id: crypto.randomUUID(),
      registroId,
      fileName: file.name,
      storagePath: caminho,
      mimeType: file.type,
      sizeBytes: file.size,
      createdBy: user.nome || user.email,
      createdAt: new Date().toISOString(),
      dataUrl: file.size <= 2 * 1024 * 1024 ? await lerComoDataUrl(file) : undefined
    };
    const estado = lerLocal();
    estado.anexos.unshift(anexo);
    gravarLocal(estado);
    return anexo;
  }

  const client = assertSupabase();
  const { error: erroUpload } = await client.storage.from(STORAGE_BUCKET).upload(caminho, file, {
    contentType: file.type || "application/octet-stream",
    upsert: false
  });
  if (erroUpload) throw erroUpload;
  const { data, error } = await client
    .from("hub_registros_anexos")
    .insert({ registro_id: registroId, file_name: file.name, storage_path: caminho, mime_type: file.type, size_bytes: file.size, created_by: user.id })
    .select("id,registro_id,file_name,storage_path,mime_type,size_bytes,created_by,created_at")
    .single();
  if (error) {
    await client.storage.from(STORAGE_BUCKET).remove([caminho]);
    throw error;
  }
  return {
    id: data.id,
    registroId: data.registro_id,
    fileName: data.file_name,
    storagePath: data.storage_path,
    mimeType: data.mime_type || "",
    sizeBytes: Number(data.size_bytes || 0),
    createdBy: data.created_by || "",
    createdAt: data.created_at
  };
}

export async function linkDoAnexo(anexo: RegistroAnexo): Promise<string> {
  if (getRegistrosSource() === "local") {
    if (!anexo.dataUrl) throw new Error("No modo demonstração, só arquivos de até 2 MB ficam disponíveis.");
    return anexo.dataUrl;
  }
  const { data, error } = await assertSupabase().storage.from(STORAGE_BUCKET).createSignedUrl(anexo.storagePath, 120);
  if (error || !data?.signedUrl) throw error || new Error("Não foi possível abrir o arquivo.");
  return data.signedUrl;
}

export async function removerAnexo(anexo: RegistroAnexo): Promise<void> {
  if (getRegistrosSource() === "local") {
    const estado = lerLocal();
    estado.anexos = estado.anexos.filter((item) => item.id !== anexo.id);
    gravarLocal(estado);
    return;
  }
  const client = assertSupabase();
  const { error } = await client.from("hub_registros_anexos").delete().eq("id", anexo.id);
  if (error) throw error;
  await client.storage.from(STORAGE_BUCKET).remove([anexo.storagePath]);
}

// ---------------------------------------------------------------------------------------------
// Servidor: consulta à Receita e aviso ao responsável

async function chamarServidor<T>(corpo: Record<string, unknown>): Promise<T> {
  const token = getRegistrosSource() === "supabase" ? await getSupabaseAccessToken() : "";
  if (getRegistrosSource() === "supabase" && !token) throw new Error("Sessão expirada. Entre novamente.");
  const resposta = await fetch("/.netlify/functions/registros", {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(corpo)
  }).catch(() => {
    throw new Error("Consulta indisponível: o servidor do HUB não respondeu.");
  });
  const dados = await resposta.json().catch(() => ({}));
  if (!resposta.ok) throw new Error(dados?.error || "Não foi possível concluir a consulta.");
  return dados as T;
}

export async function consultarCnpj(cnpj: string): Promise<DadosReceita> {
  const digitos = somenteDigitos(cnpj);
  if (!cnpjValido(digitos)) throw new Error("CNPJ inválido. Confira os 14 dígitos.");
  const resposta = await chamarServidor<{ dados: DadosReceita }>({ acao: "consultar-cnpj", cnpj: digitos });
  return resposta.dados;
}

export type ResultadoResponsavel = { emailEnviado: boolean; avisoCriado: boolean; notificado: boolean; erros: string[]; mensagem?: string };

export async function definirResponsavel(registro: RegistroEmpresa, responsavelId: string, responsavelNome: string, user: HubUser): Promise<ResultadoResponsavel> {
  if (getRegistrosSource() === "local") {
    const estado = lerLocal();
    const agora = new Date().toISOString();
    estado.registros = estado.registros.map((item) =>
      item.id === registro.id
        ? { ...item, responsavelId, responsavelDefinidoEm: responsavelId ? agora : "", status: "ativo", updatedAt: agora }
        : item
    );
    estado.eventos.unshift(
      novoEventoLocal(registro.id, "responsavel", responsavelId ? `Responsável pela apuração: ${responsavelNome}` : "Responsável pela apuração retirado", user)
    );
    gravarLocal(estado);
    return { emailEnviado: false, avisoCriado: false, notificado: false, erros: [], mensagem: "Modo demonstração: o aviso ao responsável não é enviado." };
  }
  return chamarServidor<ResultadoResponsavel>({ acao: "definir-responsavel", registroId: registro.id, responsavelId: responsavelId || null });
}
