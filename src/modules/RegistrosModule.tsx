import { Archive, ArchiveRestore, Building2, FilePen, FileText, Mail, Paperclip, Plus, RefreshCw, Save, Search, Send, Trash2, UserCheck } from "lucide-react";
import { type ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { HubProfile, HubUser, RegistroAnexo, RegistroEmpresa, RegistroEvento, RegistroStatus, RegistroTipo } from "../types";
import { PanelHeader } from "../components/common";
import { RichTextEditor } from "../components/RichTextEditor";
import { confirmDeletion, formatDateTime, getErrorMessage, normalizeForSearch } from "../lib/formatters";
import {
  CATEGORIAS_ALTERACAO,
  REGIMES_SUGERIDOS,
  ROTULO_STATUS_REGISTRO,
  ROTULO_TIPO_REGISTRO,
  aplicarDadosReceita,
  cnpjValido,
  consultarCnpj,
  definirResponsavel,
  deleteRegistro,
  enviarContatosApuracao,
  formatarCnpj,
  getRegistrosSource,
  linkDoAnexo,
  listAnexos,
  listEventos,
  listRegistros,
  novoRegistroVazio,
  registrarEvento,
  removerAnexo,
  saveRegistro,
  somenteDigitos,
  uploadAnexo
} from "../lib/registrosRepository";
import "./registros.css";

type FiltroStatus = RegistroStatus | "todos";
type Subaba = "registros" | "alteracoes";

const TIPOS_EMPRESA: RegistroTipo[] = ["abertura", "cliente_novo", "outro"];
const ROTULO_STATUS_ALTERACAO: Record<RegistroStatus, string> = {
  revisao: "Aguardando revisão",
  ativo: "Concluída",
  arquivado: "Arquivada"
};

function rotuloStatus(registro: Pick<RegistroEmpresa, "tipo" | "status">) {
  return registro.tipo === "alteracao" ? ROTULO_STATUS_ALTERACAO[registro.status] : ROTULO_STATUS_REGISTRO[registro.status];
}

function lerSubaba(): Subaba {
  try {
    return window.sessionStorage.getItem("hub_registros_subaba") === "alteracoes" ? "alteracoes" : "registros";
  } catch {
    return "registros";
  }
}

const ROTULO_EVENTO: Record<RegistroEvento["tipo"], string> = {
  ...ROTULO_TIPO_REGISTRO,
  receita: "Dados da Receita",
  responsavel: "Responsável",
  nota: "Anotação"
};

function dataBr(iso: string) {
  if (!iso) return "";
  const [a, m, d] = iso.slice(0, 10).split("-");
  return d && m && a ? `${d}/${m}/${a}` : iso;
}

function tamanhoArquivo(bytes: number) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function RegistrosModule({ user, hubUsers }: { user: HubUser; hubUsers: HubProfile[] }) {
  const isAdmin = user.role === "admin";
  const fonte = getRegistrosSource();
  const [registros, setRegistros] = useState<RegistroEmpresa[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erroLista, setErroLista] = useState("");
  const [busca, setBusca] = useState("");
  const [filtroStatus, setFiltroStatus] = useState<FiltroStatus>("todos");
  const [filtroTipo, setFiltroTipo] = useState<RegistroTipo | "todos">("todos");
  const [filtroCategoria, setFiltroCategoria] = useState("todas");
  const [subaba, setSubabaEstado] = useState<Subaba>(lerSubaba);
  const ehAlteracoes = subaba === "alteracoes";

  const [selecionadoId, setSelecionadoId] = useState<string | null>(null);
  const [rascunho, setRascunho] = useState<RegistroEmpresa | null>(null);
  const [criando, setCriando] = useState(false);
  const [editorSeq, setEditorSeq] = useState(0);
  const [eventos, setEventos] = useState<RegistroEvento[]>([]);
  const [anexos, setAnexos] = useState<RegistroAnexo[]>([]);
  const [responsavelEscolhido, setResponsavelEscolhido] = useState("");

  const [salvando, setSalvando] = useState(false);
  const [consultando, setConsultando] = useState(false);
  const [enviandoAnexo, setEnviandoAnexo] = useState(false);
  const [mensagem, setMensagem] = useState("");
  const [erro, setErro] = useState("");
  const arquivoRef = useRef<HTMLInputElement>(null);

  const usuariosAtivos = useMemo(() => hubUsers.filter((pessoa) => pessoa.active && pessoa.id), [hubUsers]);
  const nomeDoUsuario = useCallback(
    (id: string) => {
      if (!id) return "";
      const pessoa = hubUsers.find((item) => item.id === id || item.email === id);
      return pessoa?.nome || pessoa?.email || id;
    },
    [hubUsers]
  );

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErroLista("");
    try {
      setRegistros(await listRegistros());
    } catch (error) {
      setErroLista(getErrorMessage(error));
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const setSubaba = useCallback((nova: Subaba) => {
    setSubabaEstado(nova);
    try {
      window.sessionStorage.setItem("hub_registros_subaba", nova);
    } catch {
      // sem sessionStorage
    }
  }, []);

  const abrir = useCallback(
    (registro: RegistroEmpresa) => {
      setSubaba(registro.tipo === "alteracao" ? "alteracoes" : "registros");
      setCriando(false);
      setSelecionadoId(registro.id);
      setRascunho({ ...registro });
      setResponsavelEscolhido(registro.responsavelId);
      setEditorSeq((seq) => seq + 1);
      setMensagem("");
      setErro("");
    },
    [setSubaba]
  );

  // Abertura pelo sino (notificação de registro).
  useEffect(() => {
    function abrirPedido() {
      let id = "";
      try {
        id = window.sessionStorage.getItem("hub_registros_abrir") || "";
      } catch {
        id = "";
      }
      if (!id) return;
      const alvo = registros.find((item) => item.id === id);
      if (!alvo) return;
      try {
        window.sessionStorage.removeItem("hub_registros_abrir");
      } catch {
        // sem sessionStorage
      }
      abrir(alvo);
    }
    abrirPedido();
    window.addEventListener("hub:registros-abrir", abrirPedido);
    return () => window.removeEventListener("hub:registros-abrir", abrirPedido);
  }, [registros, abrir]);

  useEffect(() => {
    if (!selecionadoId || criando) {
      setEventos([]);
      setAnexos([]);
      return;
    }
    let ativo = true;
    Promise.all([listEventos(selecionadoId), listAnexos(selecionadoId)])
      .then(([listaEventos, listaAnexos]) => {
        if (!ativo) return;
        setEventos(listaEventos);
        setAnexos(listaAnexos);
      })
      .catch((error) => ativo && setErro(getErrorMessage(error)));
    return () => {
      ativo = false;
    };
  }, [selecionadoId, criando]);

  const filtrados = useMemo(() => {
    const termo = normalizeForSearch(busca);
    return registros.filter((registro) => {
      if ((registro.tipo === "alteracao") !== ehAlteracoes) return false;
      if (filtroStatus !== "todos" && registro.status !== filtroStatus) return false;
      if (!ehAlteracoes && filtroTipo !== "todos" && registro.tipo !== filtroTipo) return false;
      if (ehAlteracoes && filtroCategoria !== "todas" && !registro.categorias.includes(filtroCategoria)) return false;
      if (!termo) return true;
      return normalizeForSearch(
        `${registro.razaoSocial} ${registro.nomeFantasia} ${registro.cnpj} ${formatarCnpj(registro.cnpj)} ${registro.codigoDominio} ${registro.ie} ${nomeDoUsuario(registro.responsavelId)} ${registro.telefone1} ${registro.telefone2} ${registro.email1} ${registro.email2} ${registro.categorias.map((c) => CATEGORIAS_ALTERACAO[c] || c).join(" ")}`
      ).includes(termo);
    });
  }, [registros, busca, filtroStatus, filtroTipo, filtroCategoria, ehAlteracoes, nomeDoUsuario]);

  const empresas = useMemo(() => registros.filter((item) => item.tipo !== "alteracao"), [registros]);
  const alteracoes = useMemo(() => registros.filter((item) => item.tipo === "alteracao"), [registros]);
  const empresaDe = useCallback(
    (alteracao: RegistroEmpresa) =>
      empresas.find((item) => item.id === alteracao.empresaId) || (alteracao.cnpj ? empresas.find((item) => item.cnpj === alteracao.cnpj) : undefined),
    [empresas]
  );

  const totais = useMemo(() => {
    const base = ehAlteracoes ? alteracoes : empresas;
    return {
      revisao: base.filter((item) => item.status === "revisao").length,
      ativo: base.filter((item) => item.status === "ativo").length,
      semResponsavel: empresas.filter((item) => item.status !== "arquivado" && !item.responsavelId).length,
      esteMes: alteracoes.filter((item) => (item.dataAlteracao || item.createdAt).slice(0, 7) === new Date().toLocaleDateString("sv-SE").slice(0, 7)).length
    };
  }, [ehAlteracoes, alteracoes, empresas]);

  function novo() {
    setCriando(true);
    setSelecionadoId(null);
    setRascunho(novoRegistroVazio(user, ehAlteracoes ? "alteracao" : "abertura"));
    setResponsavelEscolhido("");
    setEditorSeq((seq) => seq + 1);
    setMensagem("");
    setErro("");
  }

  function alterar<K extends keyof RegistroEmpresa>(campo: K, valor: RegistroEmpresa[K]) {
    setRascunho((atual) => (atual ? { ...atual, [campo]: valor } : atual));
  }

  function substituirNaLista(registro: RegistroEmpresa) {
    setRegistros((lista) => [registro, ...lista.filter((item) => item.id !== registro.id)]);
  }

  async function buscarNaReceita() {
    if (!rascunho) return;
    const cnpj = somenteDigitos(rascunho.cnpj);
    if (!cnpjValido(cnpj)) {
      setErro("CNPJ inválido. Confira os 14 dígitos.");
      return;
    }
    if (criando && rascunho.tipo !== "alteracao" && empresas.some((item) => item.cnpj === cnpj)) {
      const existente = empresas.find((item) => item.cnpj === cnpj);
      if (existente) {
        abrir(existente);
        setMensagem("Este CNPJ já tem registro: aberto para revisão.");
        return;
      }
    }
    setConsultando(true);
    setErro("");
    setMensagem("");
    try {
      const dados = await consultarCnpj(cnpj);
      const atualizado = aplicarDadosReceita({ ...rascunho, cnpj }, dados);
      setRascunho(atualizado);
      if (!criando) {
        const salvo = await saveRegistro(atualizado, user, false);
        substituirNaLista(salvo);
        setRascunho({ ...salvo, observacoes: rascunho.observacoes });
        await registrarEvento(salvo.id, "receita", `Dados atualizados pela Receita (${dados.fonte}).`, user);
        setEventos(await listEventos(salvo.id));
        setMensagem(`Dados da Receita atualizados (${dados.fonte}).`);
      } else {
        setMensagem(`Dados encontrados na Receita (${dados.fonte}). Confira e salve o registro.`);
      }
    } catch (error) {
      setErro(getErrorMessage(error));
    } finally {
      setConsultando(false);
    }
  }

  async function salvar(event?: FormEvent) {
    event?.preventDefault();
    if (!rascunho) return;
    setSalvando(true);
    setErro("");
    setMensagem("");
    try {
      const ligado =
        rascunho.tipo === "alteracao" && !rascunho.empresaId && rascunho.cnpj
          ? { ...rascunho, empresaId: empresas.find((item) => item.cnpj === somenteDigitos(rascunho.cnpj))?.id || "" }
          : rascunho;
      const salvo = await saveRegistro(ligado, user, criando);
      substituirNaLista(salvo);
      setCriando(false);
      setSelecionadoId(salvo.id);
      setRascunho({ ...salvo });
      setMensagem(criando ? "Registro criado." : "Alterações salvas.");
    } catch (error) {
      setErro(getErrorMessage(error));
    } finally {
      setSalvando(false);
    }
  }

  async function mudarStatus(status: RegistroStatus) {
    if (!rascunho || criando) return;
    setSalvando(true);
    setErro("");
    try {
      const salvo = await saveRegistro({ ...rascunho, status }, user, false);
      substituirNaLista(salvo);
      setRascunho({ ...salvo, observacoes: rascunho.observacoes });
      const alt = rascunho.tipo === "alteracao";
      setMensagem(
        status === "arquivado"
          ? alt ? "Alteração arquivada." : "Registro arquivado."
          : status === "ativo"
            ? alt ? "Alteração marcada como concluída." : "Registro marcado como revisado."
            : "Registro voltou para revisão."
      );
    } catch (error) {
      setErro(getErrorMessage(error));
    } finally {
      setSalvando(false);
    }
  }

  async function excluir() {
    if (!rascunho || criando || !isAdmin) return;
    if (!confirmDeletion(`Excluir o registro "${rascunho.razaoSocial || formatarCnpj(rascunho.cnpj)}" com todos os anexos? Esta ação não pode ser desfeita.`)) return;
    setSalvando(true);
    try {
      await deleteRegistro(rascunho);
      setRegistros((lista) => lista.filter((item) => item.id !== rascunho.id));
      setSelecionadoId(null);
      setRascunho(null);
      setMensagem("Registro excluído.");
    } catch (error) {
      setErro(getErrorMessage(error));
    } finally {
      setSalvando(false);
    }
  }

  async function salvarResponsavel() {
    if (!rascunho || criando || !isAdmin) return;
    setSalvando(true);
    setErro("");
    setMensagem("");
    try {
      const resultado = await definirResponsavel(rascunho, responsavelEscolhido, nomeDoUsuario(responsavelEscolhido), user);
      await carregar();
      const atualizado = (await listRegistros()).find((item) => item.id === rascunho.id);
      if (atualizado) setRascunho({ ...atualizado, observacoes: rascunho.observacoes });
      setEventos(await listEventos(rascunho.id));
      const feitos = [resultado.notificado ? "sino" : "", resultado.chatEnviado ? "chat" : ""].filter(Boolean);
      const apuracao = resultado.apuracao;
      const competencia = apuracao?.competencia ? apuracao.competencia.split("-").reverse().join("/") : "";
      const textoApuracao = !apuracao
        ? ""
        : apuracao.jaExistia
          ? " A empresa já estava na carteira dele no Controle de Apuração."
          : apuracao.incluida
            ? competencia
              ? ` Incluída na apuração de ${competencia} dele (Controle de Apuração).`
              : " Incluída na carteira dele no Controle de Apuração (entra no próximo período gerado)."
            : "";
      const base = resultado.mensagem || (responsavelEscolhido ? `Responsável definido: ${nomeDoUsuario(responsavelEscolhido)}.` : "Responsável retirado.");
      const textoContatos = apuracao?.contatosEnviados ? " Telefones e e-mails enviados ao cadastro da empresa." : "";
      setMensagem(`${base}${feitos.length ? ` Avisado por ${feitos.join(" e ")}.` : ""}${textoApuracao}${textoContatos}`);
      if (resultado.erros?.length) setErro(`Atenção: ${resultado.erros.join(" ")}`);
    } catch (error) {
      setErro(getErrorMessage(error));
    } finally {
      setSalvando(false);
    }
  }

  async function enviarContatos() {
    if (!rascunho || criando) return;
    setSalvando(true);
    setErro("");
    setMensagem("");
    try {
      const salvo = await saveRegistro(rascunho, user, false);
      substituirNaLista(salvo);
      setMensagem(await enviarContatosApuracao(salvo));
    } catch (error) {
      setErro(getErrorMessage(error));
    } finally {
      setSalvando(false);
    }
  }

  function alternarCategoria(chave: string) {
    if (!rascunho) return;
    const atual = rascunho.categorias;
    alterar("categorias", atual.includes(chave) ? atual.filter((item) => item !== chave) : [...atual, chave]);
  }

  async function anexar(event: ChangeEvent<HTMLInputElement>) {
    const arquivos = Array.from(event.target.files || []);
    event.target.value = "";
    if (!rascunho || criando || !arquivos.length) return;
    setEnviandoAnexo(true);
    setErro("");
    try {
      for (const arquivo of arquivos) await uploadAnexo(rascunho.id, arquivo, user);
      setAnexos(await listAnexos(rascunho.id));
      setMensagem(arquivos.length > 1 ? `${arquivos.length} arquivos anexados.` : "Arquivo anexado.");
    } catch (error) {
      setErro(getErrorMessage(error));
    } finally {
      setEnviandoAnexo(false);
    }
  }

  async function abrirAnexo(anexo: RegistroAnexo) {
    try {
      const link = await linkDoAnexo(anexo);
      const aba = window.open(link, "_blank", "noopener");
      if (!aba) window.location.assign(link);
    } catch (error) {
      setErro(getErrorMessage(error));
    }
  }

  async function apagarAnexo(anexo: RegistroAnexo) {
    if (!confirmDeletion(`Excluir o anexo "${anexo.fileName}"? Esta ação não pode ser desfeita.`)) return;
    try {
      await removerAnexo(anexo);
      setAnexos((lista) => lista.filter((item) => item.id !== anexo.id));
    } catch (error) {
      setErro(getErrorMessage(error));
    }
  }

  const ehAlteracao = rascunho?.tipo === "alteracao";
  const empresaDaAlteracao = rascunho && ehAlteracao ? empresaDe(rascunho) : undefined;
  const alteracoesDaEmpresa =
    rascunho && !ehAlteracao && !criando
      ? alteracoes.filter((item) => item.empresaId === rascunho.id || (rascunho.cnpj && item.cnpj === rascunho.cnpj))
      : [];
  const podeEnviarContatos = Boolean(rascunho?.responsavelId) && (isAdmin || rascunho?.responsavelId === user.id);

  const podeExcluirAnexo = (anexo: RegistroAnexo) => isAdmin || user.role === "gestor" || anexo.createdBy === user.id || anexo.createdBy === (user.nome || user.email);

  return (
    <div className="registros-page hp-migrada">
      <section className="panel registros-lista">
        <PanelHeader title="Registros" icon={<Building2 size={18} strokeWidth={1.6} />} action={carregando ? "carregando" : fonte} />
        <div aria-label="Subabas de Registros" className="registros-subabas" role="tablist">
          <button
            aria-selected={!ehAlteracoes}
            className={!ehAlteracoes ? "ativo" : ""}
            role="tab"
            type="button"
            onClick={() => {
              setSubaba("registros");
              setFiltroStatus("todos");
            }}
          >
            <Building2 size={15} strokeWidth={1.6} />
            Registros
            <small>{empresas.length}</small>
          </button>
          <button
            aria-selected={ehAlteracoes}
            className={ehAlteracoes ? "ativo" : ""}
            role="tab"
            type="button"
            onClick={() => {
              setSubaba("alteracoes");
              setFiltroStatus("todos");
            }}
          >
            <FilePen size={15} strokeWidth={1.6} />
            Alterações
            <small>{alteracoes.length}</small>
          </button>
        </div>
        <p className="registros-subaba-nota">
          {ehAlteracoes
            ? "Alterações de contrato social, quadro societário, CNAEs, endereço, capital e demais mudanças das empresas."
            : "Empresas novas (aberturas feitas por nós) e clientes vindos de outros escritórios."}
        </p>
        <div className="registros-totais">
          <button className={filtroStatus === "revisao" ? "ativo" : ""} type="button" onClick={() => setFiltroStatus(filtroStatus === "revisao" ? "todos" : "revisao")}>
            <strong>{totais.revisao}</strong>
            <span>Em revisão</span>
          </button>
          <button className={filtroStatus === "ativo" ? "ativo" : ""} type="button" onClick={() => setFiltroStatus(filtroStatus === "ativo" ? "todos" : "ativo")}>
            <strong>{totais.ativo}</strong>
            <span>{ehAlteracoes ? "Concluídas" : "Ativos"}</span>
          </button>
          <article>
            <strong>{ehAlteracoes ? totais.esteMes : totais.semResponsavel}</strong>
            <span>{ehAlteracoes ? "Neste mês" : "Sem responsável"}</span>
          </article>
        </div>
        <div className="panel-toolbar registros-toolbar">
          <label className="panel-search">
            <Search size={14} strokeWidth={1.6} />
            <input
              aria-label={ehAlteracoes ? "Buscar alterações" : "Buscar registros"}
              onChange={(event) => setBusca(event.target.value)}
              placeholder="Razão social, CNPJ, Domínio..."
              value={busca}
            />
          </label>
          <select aria-label="Filtrar por situação" value={filtroStatus} onChange={(event) => setFiltroStatus(event.target.value as FiltroStatus)}>
            <option value="todos">Todas as situações</option>
            {(Object.keys(ROTULO_STATUS_REGISTRO) as RegistroStatus[]).map((status) => (
              <option key={status} value={status}>
                {ehAlteracoes ? ROTULO_STATUS_ALTERACAO[status] : ROTULO_STATUS_REGISTRO[status]}
              </option>
            ))}
          </select>
          {ehAlteracoes ? (
            <select aria-label="Filtrar por tipo de alteração" value={filtroCategoria} onChange={(event) => setFiltroCategoria(event.target.value)}>
              <option value="todas">Todos os tipos</option>
              {Object.entries(CATEGORIAS_ALTERACAO).map(([chave, rotulo]) => (
                <option key={chave} value={chave}>
                  {rotulo}
                </option>
              ))}
            </select>
          ) : (
            <select aria-label="Filtrar por tipo" value={filtroTipo} onChange={(event) => setFiltroTipo(event.target.value as RegistroTipo | "todos")}>
              <option value="todos">Todos os tipos</option>
              {TIPOS_EMPRESA.map((tipo) => (
                <option key={tipo} value={tipo}>
                  {ROTULO_TIPO_REGISTRO[tipo]}
                </option>
              ))}
            </select>
          )}
          <button className="primary-action registros-novo" type="button" onClick={novo}>
            <Plus size={15} strokeWidth={1.8} />
            {ehAlteracoes ? "Nova alteração" : "Novo registro"}
          </button>
        </div>
        {erroLista ? <div className="form-error">{erroLista}</div> : null}
        <ul className="registros-itens">
          {filtrados.map((registro) => (
            <li key={registro.id}>
              <button
                aria-current={registro.id === selecionadoId ? "true" : undefined}
                className={`registro-item registro-item--${registro.status}`}
                type="button"
                onClick={() => abrir(registro)}
              >
                <span className="registro-item__titulo">
                  {registro.razaoSocial || <em>Sem razão social</em>}
                  {registro.origem === "email" ? <Mail aria-label="Recebido por e-mail" size={13} strokeWidth={1.6} /> : null}
                </span>
                <span className="registro-item__cnpj">{registro.cnpj ? formatarCnpj(registro.cnpj) : "CNPJ a informar"}</span>
                <span className="registro-item__selos">
                  {registro.tipo === "alteracao" ? (
                    (registro.categorias.length ? registro.categorias : ["outra"]).map((categoria) => (
                      <span className="registro-selo registro-selo--alteracao" key={categoria}>
                        {CATEGORIAS_ALTERACAO[categoria] || categoria}
                      </span>
                    ))
                  ) : (
                    <span className={`registro-selo registro-selo--${registro.tipo}`}>{ROTULO_TIPO_REGISTRO[registro.tipo]}</span>
                  )}
                  <span className={`registro-selo registro-selo--status-${registro.status}`}>{rotuloStatus(registro)}</span>
                </span>
                <span className="registro-item__meta">
                  <span>
                    {registro.tipo === "alteracao"
                      ? registro.dataAlteracao
                        ? `Alteração de ${dataBr(registro.dataAlteracao)}`
                        : "Data a informar"
                      : registro.responsavelId
                        ? nomeDoUsuario(registro.responsavelId)
                        : "Sem responsável"}
                  </span>
                  <span>{formatDateTime(registro.updatedAt)}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
        {!carregando && !filtrados.length ? (
          <div className="empty-state">
            {(ehAlteracoes ? alteracoes : empresas).length
              ? "Nada com esses filtros."
              : ehAlteracoes
                ? "Nenhuma alteração ainda. Use \"Nova alteração\" ou aguarde a entrada por e-mail."
                : "Nenhum registro ainda. Use \"Novo registro\" ou aguarde a entrada por e-mail."}
          </div>
        ) : null}
      </section>

      <section className="panel registros-detalhe" aria-live="polite">
        {!rascunho ? (
          <div className="registros-vazio">
            <Building2 aria-hidden="true" size={28} strokeWidth={1.4} />
            <p>{ehAlteracoes ? "Selecione uma alteração na lista ou registre uma nova." : "Selecione um registro na lista ou crie um novo."}</p>
          </div>
        ) : (
          <form className="stack-form registros-form" noValidate onSubmit={salvar}>
            <header className="registros-detalhe__cabeca">
              <div>
                <h2>{criando ? (ehAlteracao ? "Nova alteração" : "Novo registro") : rascunho.razaoSocial || "Sem razão social"}</h2>
                <p>
                  {ehAlteracao ? "Alteração · " : ""}
                  {rascunho.cnpj ? formatarCnpj(rascunho.cnpj) : "CNPJ a informar"}
                  {!criando ? ` · ${rotuloStatus(rascunho)}` : ""}
                  {rascunho.receitaAtualizadaEm ? ` · Receita em ${formatDateTime(rascunho.receitaAtualizadaEm)}` : ""}
                </p>
              </div>
              {!criando ? (
                <div className="registros-detalhe__acoes record-actions">
                  {rascunho.status === "revisao" ? (
                    <button disabled={salvando} type="button" onClick={() => mudarStatus("ativo")}>
                      <UserCheck size={14} strokeWidth={1.6} />
                      {ehAlteracao ? "Marcar como concluída" : "Marcar como revisado"}
                    </button>
                  ) : null}
                  {rascunho.status !== "arquivado" ? (
                    <button disabled={salvando} type="button" onClick={() => mudarStatus("arquivado")}>
                      <Archive size={14} strokeWidth={1.6} />
                      Arquivar
                    </button>
                  ) : (
                    <button disabled={salvando} type="button" onClick={() => mudarStatus("ativo")}>
                      <ArchiveRestore size={14} strokeWidth={1.6} />
                      Reativar
                    </button>
                  )}
                  {isAdmin ? (
                    <button className="danger-action" disabled={salvando} type="button" onClick={excluir}>
                      <Trash2 size={14} strokeWidth={1.6} />
                      Excluir
                    </button>
                  ) : null}
                </div>
              ) : null}
            </header>

            {mensagem ? <div className="module-notice">{mensagem}</div> : null}
            {erro ? <div className="form-error">{erro}</div> : null}

            <details className="registros-secao" open>
              <summary>{ehAlteracao ? "Dados da alteração" : "Dados da empresa"}</summary>
              <div className="registros-grade">
                <label className="registros-cnpj">
                  CNPJ
                  <span className="registros-cnpj__linha">
                    <input
                      inputMode="numeric"
                      placeholder="00.000.000/0000-00"
                      value={rascunho.cnpj.length === 14 ? formatarCnpj(rascunho.cnpj) : rascunho.cnpj}
                      onChange={(event) => alterar("cnpj", somenteDigitos(event.target.value).slice(0, 14))}
                    />
                    <button disabled={consultando || !cnpjValido(rascunho.cnpj)} type="button" onClick={buscarNaReceita}>
                      <RefreshCw className={consultando ? "girando" : ""} size={14} strokeWidth={1.6} />
                      {consultando ? "Consultando..." : criando ? "Buscar na Receita" : "Atualizar da Receita"}
                    </button>
                  </span>
                </label>
                <label className="registros-largo">
                  Razão social
                  <input value={rascunho.razaoSocial} onChange={(event) => alterar("razaoSocial", event.target.value)} />
                </label>
                {ehAlteracao ? (
                  <>
                    <label>
                      Data da alteração
                      <input type="date" value={rascunho.dataAlteracao} onChange={(event) => alterar("dataAlteracao", event.target.value)} />
                    </label>
                    <div className="registros-largo registros-categorias">
                      <span>O que foi alterado</span>
                      <div role="group" aria-label="O que foi alterado">
                        {Object.entries(CATEGORIAS_ALTERACAO).map(([chave, rotulo]) => (
                          <button
                            aria-pressed={rascunho.categorias.includes(chave)}
                            className={rascunho.categorias.includes(chave) ? "ativo" : ""}
                            key={chave}
                            type="button"
                            onClick={() => alternarCategoria(chave)}
                          >
                            {rotulo}
                          </button>
                        ))}
                      </div>
                    </div>
                    <p className="registros-largo registros-empresa-link">
                      {empresaDaAlteracao ? (
                        <>
                          Empresa:{" "}
                          <button type="button" onClick={() => abrir(empresaDaAlteracao)}>
                            {empresaDaAlteracao.razaoSocial || formatarCnpj(empresaDaAlteracao.cnpj)}
                          </button>
                          {" · "}Responsável: {empresaDaAlteracao.responsavelId ? nomeDoUsuario(empresaDaAlteracao.responsavelId) : "não definido"}
                        </>
                      ) : (
                        "Empresa ainda sem registro na subaba Registros (o vínculo é feito pelo CNPJ)."
                      )}
                    </p>
                  </>
                ) : (
                  <>
                <label className="registros-largo">
                  Nome fantasia
                  <input value={rascunho.nomeFantasia} onChange={(event) => alterar("nomeFantasia", event.target.value)} />
                </label>
                <label>
                  Tipo
                  <select value={rascunho.tipo} onChange={(event) => alterar("tipo", event.target.value as RegistroTipo)}>
                    {TIPOS_EMPRESA.map((tipo) => (
                      <option key={tipo} value={tipo}>
                        {ROTULO_TIPO_REGISTRO[tipo]}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Data de início
                  <input type="date" value={rascunho.dataInicio} onChange={(event) => alterar("dataInicio", event.target.value)} />
                </label>
                <label>
                  Inscrição estadual
                  <input value={rascunho.ie} onChange={(event) => alterar("ie", event.target.value)} />
                </label>
                <label>
                  Código no Domínio
                  <input value={rascunho.codigoDominio} onChange={(event) => alterar("codigoDominio", event.target.value)} />
                </label>
                <label>
                  Regime tributário
                  <input list="registros-regimes" value={rascunho.regime} onChange={(event) => alterar("regime", event.target.value)} />
                  <datalist id="registros-regimes">
                    {REGIMES_SUGERIDOS.map((regime) => (
                      <option key={regime} value={regime} />
                    ))}
                  </datalist>
                </label>
                  </>
                )}
              </div>
              {rascunho.situacao || rascunho.municipio || rascunho.naturezaJuridica ? (
                <p className="registros-receita-linha">
                  {[rascunho.situacao && `Situação: ${rascunho.situacao}`, rascunho.municipio && `${rascunho.municipio}/${rascunho.uf}`, rascunho.naturezaJuridica]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              ) : null}
            </details>

            {!ehAlteracao ? (
              <details className="registros-secao" open>
                <summary>Contatos</summary>
                <div className="registros-grade">
                  <label>
                    Telefone 1
                    <input inputMode="tel" placeholder="(54) 0000-0000" value={rascunho.telefone1} onChange={(event) => alterar("telefone1", event.target.value)} />
                  </label>
                  <label>
                    Telefone 2
                    <input inputMode="tel" value={rascunho.telefone2} onChange={(event) => alterar("telefone2", event.target.value)} />
                  </label>
                  <label>
                    E-mail 1
                    <input type="email" placeholder="contato@empresa.com.br" value={rascunho.email1} onChange={(event) => alterar("email1", event.target.value)} />
                  </label>
                  <label>
                    E-mail 2
                    <input type="email" value={rascunho.email2} onChange={(event) => alterar("email2", event.target.value)} />
                  </label>
                </div>
                {!criando && podeEnviarContatos ? (
                  <button className="registros-anexar registros-enviar-contatos" disabled={salvando} type="button" onClick={enviarContatos}>
                    <Send size={14} strokeWidth={1.6} />
                    Salvar e enviar ao Controle de Apuração
                  </button>
                ) : null}
                <p className="field-note">
                  Ao definir o responsável, os telefones e e-mails vão para o cadastro da empresa no Controle de Apuração.
                </p>
              </details>
            ) : null}

            <details className="registros-secao" open={rascunho.socios.length > 0}>
              <summary>
                Sócios <small>{rascunho.socios.length}</small>
              </summary>
              {rascunho.socios.length ? (
                <ul className="registros-socios">
                  {rascunho.socios.map((socio) => (
                    <li key={`${socio.nome}-${socio.desde}`}>
                      <strong>{socio.nome}</strong>
                      <span>
                        {socio.qualificacao}
                        {socio.desde ? ` · desde ${dataBr(socio.desde)}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="field-note">Sem sócios da Receita. Informe o CNPJ e use "Buscar na Receita", ou registre nas observações.</p>
              )}
            </details>

            <details className="registros-secao" open={Boolean(rascunho.cnaePrincipal)}>
              <summary>
                Atividades (CNAE) <small>{(rascunho.cnaePrincipal ? 1 : 0) + rascunho.cnaesSecundarios.length}</small>
              </summary>
              {rascunho.cnaePrincipal ? (
                <ul className="registros-cnaes">
                  <li className="registros-cnaes__principal">
                    <code>{rascunho.cnaePrincipal.codigo}</code>
                    <span>{rascunho.cnaePrincipal.descricao}</span>
                    <small>Principal</small>
                  </li>
                  {rascunho.cnaesSecundarios.map((cnae) => (
                    <li key={cnae.codigo}>
                      <code>{cnae.codigo}</code>
                      <span>{cnae.descricao}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="field-note">Sem atividades da Receita ainda.</p>
              )}
            </details>

            <details className="registros-secao" open>
              <summary>Observações</summary>
              <div className="registros-obs">
                <RichTextEditor
                  ariaLabel="Observações do registro"
                  label="Observações"
                  onChange={(valor) => alterar("observacoes", valor)}
                  placeholder="Anotações da equipe: pendências, documentos, particularidades..."
                  resetKey={`${rascunho.id}-${editorSeq}`}
                  value={rascunho.observacoes}
                />
              </div>
            </details>

            <div className="form-actions-inline registros-salvar">
              <button className="primary-action" disabled={salvando} type="submit">
                <Save size={15} strokeWidth={1.8} />
                {salvando ? "Salvando..." : criando ? "Salvar registro" : "Salvar alterações"}
              </button>
              {criando ? (
                <button disabled={salvando} type="button" onClick={() => setRascunho(null)}>
                  Cancelar
                </button>
              ) : null}
            </div>

            {!criando ? (
              <>
                {alteracoesDaEmpresa.length ? (
                  <details className="registros-secao" open>
                    <summary>
                      Alterações da empresa <small>{alteracoesDaEmpresa.length}</small>
                    </summary>
                    <ul className="registros-alteracoes-empresa">
                      {alteracoesDaEmpresa.map((alt) => (
                        <li key={alt.id}>
                          <button type="button" onClick={() => abrir(alt)}>
                            <FilePen size={14} strokeWidth={1.6} />
                            <span>{(alt.categorias.length ? alt.categorias : ["outra"]).map((c) => CATEGORIAS_ALTERACAO[c] || c).join(", ")}</span>
                          </button>
                          <small>
                            {alt.dataAlteracao ? dataBr(alt.dataAlteracao) : formatDateTime(alt.createdAt)} · {rotuloStatus(alt)}
                          </small>
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}
                {!ehAlteracao ? (
                <details className="registros-secao" open>
                  <summary>Responsável pela apuração</summary>
                  {isAdmin ? (
                    <div className="registros-responsavel">
                      <select aria-label="Responsável pela apuração" value={responsavelEscolhido} onChange={(event) => setResponsavelEscolhido(event.target.value)}>
                        <option value="">Sem responsável</option>
                        {usuariosAtivos.map((pessoa) => (
                          <option key={pessoa.id} value={pessoa.id}>
                            {pessoa.nome || pessoa.email}
                          </option>
                        ))}
                      </select>
                      <button
                        className="primary-action"
                        disabled={salvando || responsavelEscolhido === rascunho.responsavelId}
                        type="button"
                        onClick={salvarResponsavel}
                      >
                        <UserCheck size={15} strokeWidth={1.8} />
                        {responsavelEscolhido ? "Definir e avisar" : "Retirar responsável"}
                      </button>
                    </div>
                  ) : (
                    <p className="registros-responsavel__leitura">{rascunho.responsavelId ? nomeDoUsuario(rascunho.responsavelId) : "Ainda não definido pela coordenação."}</p>
                  )}
                  <p className="field-note">
                    {rascunho.responsavelId && rascunho.responsavelDefinidoEm
                      ? `Definido em ${formatDateTime(rascunho.responsavelDefinidoEm)}. `
                      : ""}
                    Ao definir, a empresa entra na apuração aberta do responsável (Controle de Apuração) e ele é avisado no sino e no chat.
                  </p>
                </details>
                ) : null}

                <details className="registros-secao" open>
                  <summary>
                    Documentos <small>{anexos.length}</small>
                  </summary>
                  <ul className="registros-anexos">
                    {anexos.map((anexo) => (
                      <li key={anexo.id}>
                        <button className="registros-anexo__abrir" type="button" onClick={() => abrirAnexo(anexo)}>
                          <FileText size={15} strokeWidth={1.6} />
                          <span>{anexo.fileName}</span>
                        </button>
                        <small>
                          {tamanhoArquivo(anexo.sizeBytes)} · {formatDateTime(anexo.createdAt)}
                        </small>
                        {podeExcluirAnexo(anexo) ? (
                          <button aria-label={`Excluir ${anexo.fileName}`} className="registros-anexo__excluir" type="button" onClick={() => apagarAnexo(anexo)}>
                            <Trash2 size={14} strokeWidth={1.6} />
                          </button>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                  <input hidden multiple onChange={anexar} ref={arquivoRef} type="file" />
                  <button className="registros-anexar" disabled={enviandoAnexo} type="button" onClick={() => arquivoRef.current?.click()}>
                    <Paperclip size={14} strokeWidth={1.6} />
                    {enviandoAnexo ? "Enviando..." : "Anexar documento (contrato social, alteração...)"}
                  </button>
                </details>

                <details className="registros-secao">
                  <summary>
                    Histórico do registro <small>{eventos.length}</small>
                  </summary>
                  <ol className="registros-eventos">
                    {eventos.map((evento) => (
                      <li key={evento.id}>
                        <div className="registros-eventos__cabeca">
                          <span className={`registro-selo registro-selo--${evento.tipo}`}>{ROTULO_EVENTO[evento.tipo] || evento.tipo}</span>
                          <small>
                            {formatDateTime(evento.createdAt)} · {evento.remetente || nomeDoUsuario(evento.createdBy) || "Sistema"}
                          </small>
                        </div>
                        {evento.assunto ? <strong>{evento.assunto}</strong> : null}
                        {evento.resumo ? <p>{evento.resumo}</p> : null}
                      </li>
                    ))}
                  </ol>
                </details>
              </>
            ) : null}
          </form>
        )}
      </section>
    </div>
  );
}
