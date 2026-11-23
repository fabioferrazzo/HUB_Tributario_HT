import { type ChangeEvent, type KeyboardEvent as ReactKeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  BellRing,
  Download,
  ExternalLink,
  FileText,
  LogOut,
  MessageSquarePlus,
  MessagesSquare,
  Minus,
  Paperclip,
  Search,
  Send,
  Settings2,
  Trash2,
  UserPlus,
  Users,
  X
} from "lucide-react";
import type { HubProfile, HubUser } from "../../types";
import { RichTextEditor } from "../RichTextEditor";
import { sanitizePautaRichHtml } from "../../lib/richText";
import { getInitials } from "../../lib/formatters";
import {
  CHAT_ANEXO_MAX,
  CHAT_RETENCAO_DIAS,
  type ChatConversa,
  type ChatMensagem,
  type ChatPessoa,
  abrirDireta,
  alterarGrupo,
  assinarChat,
  chamarAtencao,
  contarMensagensExpirando,
  criarGrupo,
  enviarMensagem,
  excluirMensagem,
  listarConversas,
  listarMensagens,
  marcarLida,
  nomeDaConversa,
  sairDoGrupo,
  uid,
  urlDoAnexo
} from "../../lib/chatRepository";
import { baixarBackupChat } from "./chatBackup";
import { alertaSonoro, mostrarNotificacao, piscarTitulo, tremerTela } from "./chatAlertas";
import { hubDesktop } from "../../lib/desktop";

export type ChatJanela = "fechado" | "aberto" | "minimizado";

type Vista = { tela: "lista" } | { tela: "conversa"; id: string } | { tela: "nova" } | { tela: "grupo"; id?: string };

const RECARGA_MS = 20000;
const PERGUNTA_BACKUP_KEY = "hub_chat_backup_perguntado";

function horaCurta(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const hoje = new Date();
  const mesmoDia = d.toDateString() === hoje.toDateString();
  return mesmoDia
    ? d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function tamanho(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;
}

function textoVazio(html: string) {
  return !html.replace(/<[^>]*>|&nbsp;/g, "").trim();
}

// Central do chat: lista de conversas, conversa aberta, tempo real e "chamar atenção".
// modo "janela": painel flutuante (minimizar/fechar/destacar). modo "pagina": ocupa a tela (menu Chat ou janela destacada).
export function ChatCentral({
  user,
  hubUsers,
  modo,
  janela = "aberto",
  onJanela,
  onNaoLidas
}: {
  user: HubUser;
  hubUsers: HubProfile[];
  modo: "janela" | "pagina";
  janela?: ChatJanela;
  onJanela?: (estado: ChatJanela) => void;
  onNaoLidas?: (total: number) => void;
}) {
  const meuId = uid(user);
  const [conversas, setConversas] = useState<ChatConversa[]>([]);
  const [vista, setVista] = useState<Vista>({ tela: "lista" });
  const [mensagens, setMensagens] = useState<ChatMensagem[]>([]);
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");
  const [busca, setBusca] = useState("");
  const [tremendo, setTremendo] = useState(false);
  const [perguntaBackup, setPerguntaBackup] = useState(0);
  const [baixando, setBaixando] = useState(false);
  const visivel = modo === "pagina" || janela === "aberto";
  const conversaAberta = vista.tela === "conversa" ? conversas.find((c) => c.id === vista.id) || null : null;
  const conversaAbertaId = vista.tela === "conversa" ? vista.id : "";
  const conversaAbertaRef = useRef("");
  conversaAbertaRef.current = visivel ? conversaAbertaId : "";

  const pessoas: ChatPessoa[] = useMemo(
    () =>
      hubUsers
        .filter((p) => p.active)
        .map((p) => ({ id: p.id || p.email, nome: p.nome || p.email, email: p.email }))
        .filter((p) => p.id !== meuId && p.email.toLowerCase() !== user.email.toLowerCase())
        .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")),
    [hubUsers, meuId, user.email]
  );

  const recarregarConversas = useCallback(async () => {
    try {
      setConversas(await listarConversas(user));
      setErro("");
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível carregar o chat.");
    }
  }, [user]);

  const recarregarMensagens = useCallback(async () => {
    const id = conversaAbertaRef.current;
    if (!id) return;
    try {
      const lista = await listarMensagens(id, user);
      if (conversaAbertaRef.current === id) setMensagens(lista);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível carregar a conversa.");
    }
  }, [user]);

  // Total de não lidas para o botão do topo.
  const totalNaoLidas = conversas.reduce((soma, c) => soma + (c.id === conversaAbertaRef.current ? 0 : c.naoLidas || 0), 0);
  useEffect(() => {
    onNaoLidas?.(totalNaoLidas);
  }, [onNaoLidas, totalNaoLidas]);

  // Carga inicial + recarga periódica de segurança.
  useEffect(() => {
    void recarregarConversas();
    const timer = window.setInterval(() => {
      void recarregarConversas();
      void recarregarMensagens();
    }, RECARGA_MS);
    return () => window.clearInterval(timer);
  }, [recarregarConversas, recarregarMensagens]);

  // Ao abrir uma conversa: carrega e marca como lida.
  useEffect(() => {
    if (!conversaAbertaId || !visivel) return;
    setMensagens([]);
    void recarregarMensagens();
    void marcarLida(conversaAbertaId, user).then(() => recarregarConversas());
  }, [conversaAbertaId, visivel, recarregarMensagens, recarregarConversas, user]);

  // Tempo real.
  useEffect(() => {
    const parar = assinarChat(user, {
      onMensagem: (m) => {
        if (m.conversaId === conversaAbertaRef.current) {
          setMensagens((atual) => (atual.some((x) => x.id === m.id) ? atual : [...atual, m]));
          void marcarLida(m.conversaId, user);
        } else if (m.autorId !== meuId && m.tipo === "texto" && (document.hidden || !document.hasFocus())) {
          mostrarNotificacao(`Nova mensagem de ${m.autorNome}`, m.conteudo.replace(/<[^>]*>/g, " ").slice(0, 120) || "Arquivo enviado", false);
        }
        void recarregarConversas();
      },
      onChamado: (c) => {
        if (c.remetenteId === meuId) return;
        // Chamar atenção: abre a conversa, chacoalha, bip e notificação do Windows.
        onJanela?.("aberto");
        setVista({ tela: "conversa", id: c.conversaId });
        setTremendo(true);
        window.setTimeout(() => setTremendo(false), 900);
        tremerTela();
        alertaSonoro();
        piscarTitulo(`${c.remetenteNome} chamou sua atenção`);
        const desktop = hubDesktop();
        if (desktop) desktop.chamarAtencao(`${c.remetenteNome} está chamando sua atenção`, "Abra o chat do HUB.");
        else mostrarNotificacao(`${c.remetenteNome} está chamando sua atenção`, "Clique para abrir o chat do HUB.", true);
        void recarregarConversas();
      },
      onMudanca: () => {
        void recarregarConversas();
        void recarregarMensagens();
      }
    });
    return parar;
  }, [user, meuId, onJanela, recarregarConversas, recarregarMensagens]);

  // Aviso antes da limpeza de 30 dias: oferece o backup (no máximo a cada 3 dias).
  useEffect(() => {
    if (modo !== "janela" && modo !== "pagina") return;
    let ativo = true;
    const chave = `${PERGUNTA_BACKUP_KEY}:${meuId}`;
    let ultima = 0;
    try {
      ultima = Number(window.localStorage.getItem(chave) || 0);
    } catch {
      ultima = 0;
    }
    if (Date.now() - ultima < 3 * 864e5) return;
    void contarMensagensExpirando(user, 3).then((qtd) => {
      if (ativo && qtd > 0) setPerguntaBackup(qtd);
    });
    return () => {
      ativo = false;
    };
  }, [meuId, modo, user]);

  // Com o chat fechado, a pergunta do backup aparece como o botão minimizado (lembrete discreto).
  useEffect(() => {
    if (perguntaBackup > 0 && modo === "janela" && janela === "fechado") onJanela?.("minimizado");
  }, [janela, modo, onJanela, perguntaBackup]);

  function responderBackup(baixar: boolean) {
    try {
      window.localStorage.setItem(`${PERGUNTA_BACKUP_KEY}:${meuId}`, String(Date.now()));
    } catch {
      // ignorado
    }
    setPerguntaBackup(0);
    if (baixar) void fazerBackup();
  }

  async function fazerBackup() {
    setBaixando(true);
    setErro("");
    try {
      await baixarBackupChat(user);
      setAviso("Backup das conversas dos últimos 30 dias baixado.");
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível gerar o backup.");
    } finally {
      setBaixando(false);
    }
  }

  function destacarJanela() {
    const largura = 440;
    const altura = Math.min(760, window.screen.availHeight || 760);
    window.open(`${window.location.pathname}?janela=1#/chat`, "hub-chat", `popup=yes,width=${largura},height=${altura}`);
    onJanela?.("fechado");
  }

  const filtradas = conversas.filter((c) => !busca.trim() || nomeDaConversa(c, user).toLowerCase().includes(busca.trim().toLowerCase()));

  const corpo = (
    <div className="chat-corpo">
      {erro ? (
        <p className="chat-erro" role="alert">
          {erro}
        </p>
      ) : null}
      {aviso ? (
        <p className="chat-aviso" role="status" onClick={() => setAviso("")}>
          {aviso}
        </p>
      ) : null}
      {perguntaBackup ? (
        <div className="chat-backup-pergunta" role="alertdialog" aria-label="Backup antes da limpeza">
          <p>
            <strong>{perguntaBackup}</strong> mensagem(ns) das suas conversas completam {CHAT_RETENCAO_DIAS} dias e serão apagadas automaticamente nos
            próximos dias. Deseja baixar um backup antes?
          </p>
          <div>
            <button type="button" className="chat-btn chat-btn--pri" onClick={() => responderBackup(true)}>
              <Download size={14} strokeWidth={1.6} /> Baixar backup
            </button>
            <button type="button" className="chat-btn" onClick={() => responderBackup(false)}>
              Agora não
            </button>
          </div>
        </div>
      ) : null}

      {vista.tela === "lista" ? (
        <ListaConversas
          baixando={baixando}
          busca={busca}
          conversas={filtradas}
          user={user}
          onAbrir={(id) => setVista({ tela: "conversa", id })}
          onBackup={() => void fazerBackup()}
          onBusca={setBusca}
          onNovaConversa={() => setVista({ tela: "nova" })}
          onNovoGrupo={() => setVista({ tela: "grupo" })}
        />
      ) : null}

      {vista.tela === "nova" ? (
        <NovaConversa
          pessoas={pessoas}
          onCancelar={() => setVista({ tela: "lista" })}
          onEscolher={async (pessoa) => {
            try {
              const id = await abrirDireta(pessoa, user);
              await recarregarConversas();
              setVista({ tela: "conversa", id });
            } catch (e) {
              setErro(e instanceof Error ? e.message : "Não foi possível abrir a conversa.");
            }
          }}
        />
      ) : null}

      {vista.tela === "grupo" ? (
        <EditorGrupo
          conversa={vista.id ? conversas.find((c) => c.id === vista.id) || null : null}
          pessoas={pessoas}
          user={user}
          onCancelar={() => setVista(vista.id ? { tela: "conversa", id: vista.id } : { tela: "lista" })}
          onPronto={async (id) => {
            await recarregarConversas();
            setVista(id ? { tela: "conversa", id } : { tela: "lista" });
          }}
          onErro={setErro}
        />
      ) : null}

      {vista.tela === "conversa" ? (
        <Conversa
          conversa={conversaAberta}
          mensagens={mensagens}
          user={user}
          onEditarGrupo={() => setVista({ tela: "grupo", id: vista.id })}
          onErro={setErro}
          onVoltar={() => setVista({ tela: "lista" })}
          onAviso={setAviso}
          onRecarregar={() => {
            void recarregarMensagens();
            void recarregarConversas();
          }}
        />
      ) : null}
    </div>
  );

  if (modo === "pagina") {
    return (
      <section className={`chat chat--pagina${tremendo ? " chat--tremer" : ""}`} aria-label="Chat do HUB">
        <header className="chat-topo">
          <MessagesSquare size={17} strokeWidth={1.6} />
          <strong>Chat</strong>
          {totalNaoLidas ? <span className="chat-contagem">{totalNaoLidas}</span> : null}
          <PermissaoAlertas />
        </header>
        {corpo}
      </section>
    );
  }

  if (janela === "fechado") return null;

  if (janela === "minimizado") {
    return (
      <button className={`chat-minimizado${tremendo ? " chat--tremer" : ""}`} type="button" onClick={() => onJanela?.("aberto")} aria-label="Abrir o chat">
        <MessagesSquare size={16} strokeWidth={1.6} />
        <span>Chat</span>
        {totalNaoLidas ? <span className="chat-contagem">{totalNaoLidas}</span> : null}
      </button>
    );
  }

  return (
    <section className={`chat chat--janela${tremendo ? " chat--tremer" : ""}`} aria-label="Chat do HUB" role="dialog">
      <header className="chat-topo">
        <MessagesSquare size={17} strokeWidth={1.6} />
        <strong>Chat</strong>
        {totalNaoLidas ? <span className="chat-contagem">{totalNaoLidas}</span> : null}
        <PermissaoAlertas />
        <span className="chat-topo-acoes">
          <button aria-label="Abrir em janela separada" title="Abrir em janela separada (continua aberta mesmo fechando o HUB)" type="button" onClick={destacarJanela}>
            <ExternalLink size={15} strokeWidth={1.6} />
          </button>
          <button aria-label="Minimizar o chat" title="Minimizar" type="button" onClick={() => onJanela?.("minimizado")}>
            <Minus size={16} strokeWidth={1.6} />
          </button>
          <button aria-label="Fechar o chat" title="Fechar" type="button" onClick={() => onJanela?.("fechado")}>
            <X size={16} strokeWidth={1.6} />
          </button>
        </span>
      </header>
      {corpo}
    </section>
  );
}

// Pede permissão para as notificações do Windows (usadas no "chamar atenção" com o HUB em segundo plano).
function PermissaoAlertas() {
  // No HUB instalado, os avisos saem pelo ícone perto do relógio: não precisa pedir permissão.
  const suportado = typeof window !== "undefined" && "Notification" in window && !hubDesktop();
  const [estado, setEstado] = useState(suportado ? Notification.permission : "denied");
  if (!suportado || estado !== "default") return null;
  return (
    <button
      className="chat-permissao"
      type="button"
      title="Permite que o chat avise você com notificações do Windows quando o HUB estiver em segundo plano"
      onClick={() => void Notification.requestPermission().then(setEstado)}
    >
      <BellRing size={13} strokeWidth={1.6} /> Ativar alertas
    </button>
  );
}

// ------------------------------------------------------------------------------- lista
function ListaConversas({
  conversas,
  user,
  busca,
  baixando,
  onBusca,
  onAbrir,
  onNovaConversa,
  onNovoGrupo,
  onBackup
}: {
  conversas: ChatConversa[];
  user: HubUser;
  busca: string;
  baixando: boolean;
  onBusca: (v: string) => void;
  onAbrir: (id: string) => void;
  onNovaConversa: () => void;
  onNovoGrupo: () => void;
  onBackup: () => void;
}) {
  return (
    <div className="chat-lista">
      <div className="chat-lista-acoes">
        <button className="chat-btn chat-btn--pri" type="button" onClick={onNovaConversa}>
          <MessageSquarePlus size={14} strokeWidth={1.6} /> Nova conversa
        </button>
        <button className="chat-btn" type="button" onClick={onNovoGrupo}>
          <Users size={14} strokeWidth={1.6} /> Novo grupo
        </button>
        <button className="chat-icone" disabled={baixando} title={`Baixar backup das conversas (últimos ${CHAT_RETENCAO_DIAS} dias)`} type="button" onClick={onBackup} aria-label="Baixar backup das conversas">
          <Download size={15} strokeWidth={1.6} />
        </button>
      </div>
      <label className="chat-busca">
        <Search size={14} strokeWidth={1.6} />
        <input aria-label="Buscar conversa" placeholder="Buscar conversa…" value={busca} onChange={(e) => onBusca(e.target.value)} />
      </label>
      {!conversas.length ? <p className="chat-vazio">Nenhuma conversa ainda. Comece uma em “Nova conversa”.</p> : null}
      <ul>
        {conversas.map((c) => {
          const nome = nomeDaConversa(c, user);
          const previa = c.ultima
            ? c.ultima.tipo === "sistema"
              ? c.ultima.conteudo
              : `${c.tipo === "grupo" && c.ultima.autor ? `${c.ultima.autor.split(" ")[0]}: ` : ""}${c.ultima.conteudo.trim() || (c.ultima.anexos ? "📎 Arquivo" : "")}`
            : "Sem mensagens";
          return (
            <li key={c.id}>
              <button className={`chat-item${c.naoLidas ? " chat-item--nova" : ""}`} type="button" onClick={() => onAbrir(c.id)}>
                <span className={`chat-avatar${c.tipo === "grupo" ? " chat-avatar--grupo" : ""}`}>
                  {c.tipo === "grupo" ? <Users size={15} strokeWidth={1.6} /> : getInitials(nome)}
                </span>
                <span className="chat-item-texto">
                  <strong>{nome}</strong>
                  <small>{previa}</small>
                </span>
                <span className="chat-item-meta">
                  <time>{c.ultima ? horaCurta(c.ultima.em) : ""}</time>
                  {c.naoLidas ? <span className="chat-contagem">{c.naoLidas}</span> : null}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function NovaConversa({ pessoas, onEscolher, onCancelar }: { pessoas: ChatPessoa[]; onEscolher: (p: ChatPessoa) => void; onCancelar: () => void }) {
  const [busca, setBusca] = useState("");
  const lista = pessoas.filter((p) => !busca.trim() || `${p.nome} ${p.email}`.toLowerCase().includes(busca.trim().toLowerCase()));
  return (
    <div className="chat-lista">
      <div className="chat-subtopo">
        <button aria-label="Voltar" className="chat-icone" type="button" onClick={onCancelar}>
          <ArrowLeft size={16} strokeWidth={1.6} />
        </button>
        <strong>Nova conversa</strong>
      </div>
      <label className="chat-busca">
        <Search size={14} strokeWidth={1.6} />
        <input aria-label="Buscar pessoa" autoFocus placeholder="Buscar pessoa…" value={busca} onChange={(e) => setBusca(e.target.value)} />
      </label>
      <ul>
        {lista.map((p) => (
          <li key={p.id}>
            <button className="chat-item" type="button" onClick={() => onEscolher(p)}>
              <span className="chat-avatar">{getInitials(p.nome)}</span>
              <span className="chat-item-texto">
                <strong>{p.nome}</strong>
                <small>{p.email}</small>
              </span>
            </button>
          </li>
        ))}
        {!lista.length ? <p className="chat-vazio">Ninguém encontrado.</p> : null}
      </ul>
    </div>
  );
}

function EditorGrupo({
  conversa,
  pessoas,
  user,
  onCancelar,
  onPronto,
  onErro
}: {
  conversa: ChatConversa | null;
  pessoas: ChatPessoa[];
  user: HubUser;
  onCancelar: () => void;
  onPronto: (id: string | null) => void;
  onErro: (m: string) => void;
}) {
  const meuId = uid(user);
  const souDono = !conversa || conversa.papel === "dono";
  const membrosAtuais = conversa ? conversa.participantes.filter((p) => p.id !== meuId).map((p) => p.id) : [];
  const [nome, setNome] = useState(conversa?.nome || "");
  const [marcados, setMarcados] = useState<string[]>(membrosAtuais);
  const [salvando, setSalvando] = useState(false);

  async function salvar() {
    setSalvando(true);
    try {
      if (!conversa) {
        const id = await criarGrupo(nome, pessoas.filter((p) => marcados.includes(p.id)), user);
        onPronto(id);
      } else {
        const adicionar = pessoas.filter((p) => marcados.includes(p.id) && !membrosAtuais.includes(p.id));
        const remover = membrosAtuais.filter((id) => !marcados.includes(id));
        await alterarGrupo(conversa, nome, adicionar, remover, user);
        onPronto(conversa.id);
      }
    } catch (e) {
      onErro(e instanceof Error ? e.message : "Não foi possível salvar o grupo.");
    } finally {
      setSalvando(false);
    }
  }

  async function sair() {
    if (!conversa || !window.confirm(`Sair do grupo "${conversa.nome}"? Você deixa de ver as mensagens dele.`)) return;
    try {
      await sairDoGrupo(conversa, user);
      onPronto(null);
    } catch (e) {
      onErro(e instanceof Error ? e.message : "Não foi possível sair do grupo.");
    }
  }

  return (
    <div className="chat-lista chat-grupo">
      <div className="chat-subtopo">
        <button aria-label="Voltar" className="chat-icone" type="button" onClick={onCancelar}>
          <ArrowLeft size={16} strokeWidth={1.6} />
        </button>
        <strong>{conversa ? "Grupo" : "Novo grupo"}</strong>
      </div>
      <label className="chat-campo">
        Nome do grupo
        <input disabled={!souDono} maxLength={80} value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Equipe fiscal" />
      </label>
      <fieldset className="chat-membros" disabled={!souDono}>
        <legend>Membros</legend>
        {conversa && !souDono ? (
          <p className="chat-vazio">Só quem criou o grupo altera o nome e os membros.</p>
        ) : null}
        {pessoas.map((p) => (
          <label key={p.id}>
            <input
              checked={marcados.includes(p.id)}
              type="checkbox"
              onChange={() => setMarcados((atual) => (atual.includes(p.id) ? atual.filter((id) => id !== p.id) : [...atual, p.id]))}
            />
            <span>{p.nome}</span>
          </label>
        ))}
      </fieldset>
      <div className="chat-grupo-acoes">
        {conversa ? (
          <button className="chat-btn chat-btn--perigo" type="button" onClick={() => void sair()}>
            <LogOut size={14} strokeWidth={1.6} /> Sair do grupo
          </button>
        ) : null}
        <span />
        <button className="chat-btn" type="button" onClick={onCancelar}>
          Cancelar
        </button>
        {souDono ? (
          <button className="chat-btn chat-btn--pri" disabled={salvando || !nome.trim()} type="button" onClick={() => void salvar()}>
            <UserPlus size={14} strokeWidth={1.6} /> {conversa ? "Salvar" : "Criar grupo"}
          </button>
        ) : null}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------------------- conversa
function Conversa({
  conversa,
  mensagens,
  user,
  onVoltar,
  onEditarGrupo,
  onErro,
  onAviso,
  onRecarregar
}: {
  conversa: ChatConversa | null;
  mensagens: ChatMensagem[];
  user: HubUser;
  onVoltar: () => void;
  onEditarGrupo: () => void;
  onErro: (m: string) => void;
  onAviso: (m: string) => void;
  onRecarregar: () => void;
}) {
  const meuId = uid(user);
  const [html, setHtml] = useState("");
  const [arquivos, setArquivos] = useState<File[]>([]);
  const [resetKey, setResetKey] = useState(0);
  const [enviando, setEnviando] = useState(false);
  const [bloqueadoAte, setBloqueadoAte] = useState("");
  const [agora, setAgora] = useState(Date.now());
  const fimRef = useRef<HTMLDivElement | null>(null);
  const arquivoRef = useRef<HTMLInputElement | null>(null);
  const htmlRef = useRef(html);
  htmlRef.current = html;

  useEffect(() => {
    fimRef.current?.scrollIntoView({ block: "end" });
  }, [mensagens.length, conversa?.id]);

  useEffect(() => {
    if (!bloqueadoAte) return;
    const timer = window.setInterval(() => setAgora(Date.now()), 15000);
    return () => window.clearInterval(timer);
  }, [bloqueadoAte]);

  const bloqueado = bloqueadoAte && Date.parse(bloqueadoAte) > agora;

  async function enviar() {
    if (!conversa || enviando) return;
    const conteudo = htmlRef.current;
    if (textoVazio(conteudo) && !arquivos.length) return;
    setEnviando(true);
    try {
      await enviarMensagem(conversa.id, textoVazio(conteudo) ? "" : sanitizePautaRichHtml(conteudo), arquivos, user);
      setHtml("");
      setArquivos([]);
      setResetKey((k) => k + 1);
      onRecarregar();
    } catch (e) {
      onErro(e instanceof Error ? e.message : "Não foi possível enviar.");
    } finally {
      setEnviando(false);
    }
  }

  async function chamar() {
    if (!conversa) return;
    try {
      const r = await chamarAtencao(conversa.id, user);
      if (!r.ok) {
        setBloqueadoAte(r.liberadoEm || "");
        onErro(`Você chamou a atenção 3 vezes seguidas. Liberado novamente às ${r.liberadoEm ? new Date(r.liberadoEm).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "daqui a 30 minutos"}.`);
      } else {
        onAviso(r.restantes > 0 ? `Atenção chamada. Você ainda pode chamar ${r.restantes} vez(es) seguidas.` : "Atenção chamada. Próxima chamada liberada em 30 minutos.");
        if (r.restantes === 0) setBloqueadoAte(new Date(Date.now() + 30 * 60e3).toISOString());
        onRecarregar();
      }
    } catch (e) {
      onErro(e instanceof Error ? e.message : "Não foi possível chamar a atenção.");
    }
  }

  async function apagar(m: ChatMensagem) {
    if (!window.confirm("Apagar esta mensagem para todos?")) return;
    try {
      await excluirMensagem(m, user);
      onRecarregar();
    } catch (e) {
      onErro(e instanceof Error ? e.message : "Não foi possível apagar.");
    }
  }

  async function abrirAnexo(m: ChatMensagem, indice: number) {
    try {
      const url = await urlDoAnexo(m.anexos[indice], user);
      const link = document.createElement("a");
      link.href = url;
      link.target = "_blank";
      link.rel = "noreferrer";
      if (url.startsWith("data:")) link.download = m.anexos[indice].nome;
      link.click();
    } catch (e) {
      onErro(e instanceof Error ? e.message : "Anexo indisponível.");
    }
  }

  function escolherArquivos(event: ChangeEvent<HTMLInputElement>) {
    const novos = Array.from(event.target.files || []);
    const grandes = novos.filter((f) => f.size > CHAT_ANEXO_MAX);
    if (grandes.length) onErro(`Arquivo acima de 10 MB: ${grandes.map((f) => f.name).join(", ")}`);
    setArquivos((atual) => [...atual, ...novos.filter((f) => f.size <= CHAT_ANEXO_MAX)].slice(0, 10));
    event.target.value = "";
  }

  // Enter envia; Shift+Enter quebra a linha.
  function aoTeclar(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.ctrlKey && !event.altKey) {
      const alvo = event.target as HTMLElement;
      if (alvo.isContentEditable) {
        event.preventDefault();
        event.stopPropagation();
        void enviar();
      }
    }
  }

  if (!conversa) {
    return (
      <div className="chat-conversa">
        <div className="chat-subtopo">
          <button aria-label="Voltar" className="chat-icone" type="button" onClick={onVoltar}>
            <ArrowLeft size={16} strokeWidth={1.6} />
          </button>
          <strong>Carregando…</strong>
        </div>
      </div>
    );
  }

  const nome = nomeDaConversa(conversa, user);
  const membros = conversa.participantes.map((p) => (p.id === meuId ? "você" : p.nome.split(" ")[0])).join(", ");

  return (
    <div className="chat-conversa">
      <div className="chat-subtopo">
        <button aria-label="Voltar para as conversas" className="chat-icone" type="button" onClick={onVoltar}>
          <ArrowLeft size={16} strokeWidth={1.6} />
        </button>
        <span className="chat-subtopo-nome">
          <strong>{nome}</strong>
          {conversa.tipo === "grupo" ? <small>{membros}</small> : null}
        </span>
        {conversa.tipo === "grupo" ? (
          <button aria-label="Membros e configurações do grupo" className="chat-icone" title="Membros do grupo" type="button" onClick={onEditarGrupo}>
            <Settings2 size={15} strokeWidth={1.6} />
          </button>
        ) : null}
        <button
          aria-label="Chamar atenção"
          className="chat-atencao"
          disabled={Boolean(bloqueado)}
          title={bloqueado ? "Liberado novamente em até 30 minutos" : "Chamar atenção (máximo de 3 seguidas)"}
          type="button"
          onClick={() => void chamar()}
        >
          <BellRing size={14} strokeWidth={1.6} /> Chamar atenção
        </button>
      </div>

      <div className="chat-mensagens" aria-live="polite">
        {!mensagens.length ? <p className="chat-vazio">Nenhuma mensagem nos últimos {CHAT_RETENCAO_DIAS} dias.</p> : null}
        {mensagens.map((m) => {
          if (m.tipo === "sistema") {
            return (
              <p className="chat-msg-sistema" key={m.id}>
                {m.conteudo} <time>{horaCurta(m.createdAt)}</time>
              </p>
            );
          }
          if (m.tipo === "atencao") {
            return (
              <p className="chat-msg-sistema chat-msg-atencao" key={m.id}>
                <BellRing size={12} strokeWidth={1.6} /> {m.autorId === meuId ? "Você chamou a atenção." : m.conteudo} <time>{horaCurta(m.createdAt)}</time>
              </p>
            );
          }
          const minha = m.autorId === meuId;
          return (
            <div className={`chat-msg${minha ? " chat-msg--minha" : ""}`} key={m.id}>
              {!minha && conversa.tipo === "grupo" ? <span className="chat-msg-autor">{m.autorNome}</span> : null}
              {m.conteudo ? <div className="chat-msg-texto pauta-rich-text" dangerouslySetInnerHTML={{ __html: sanitizePautaRichHtml(m.conteudo) }} /> : null}
              {m.anexos.length ? (
                <div className="chat-msg-anexos">
                  {m.anexos.map((a, i) => (
                    <button key={`${a.path}-${i}`} type="button" onClick={() => void abrirAnexo(m, i)} title={`Abrir ${a.nome}`}>
                      <FileText size={13} strokeWidth={1.6} />
                      <span>{a.nome}</span>
                      <small>{tamanho(a.tamanho)}</small>
                    </button>
                  ))}
                </div>
              ) : null}
              <span className="chat-msg-meta">
                <time>{horaCurta(m.createdAt)}</time>
                {minha ? (
                  <button aria-label="Apagar mensagem" className="chat-msg-apagar" title="Apagar mensagem" type="button" onClick={() => void apagar(m)}>
                    <Trash2 size={12} strokeWidth={1.6} />
                  </button>
                ) : null}
              </span>
            </div>
          );
        })}
        <div ref={fimRef} />
      </div>

      <div className="chat-composer" onKeyDownCapture={aoTeclar}>
        {arquivos.length ? (
          <div className="chat-arquivos">
            {arquivos.map((f, i) => (
              <span key={`${f.name}-${i}`}>
                <Paperclip size={12} strokeWidth={1.6} /> {f.name} <small>{tamanho(f.size)}</small>
                <button aria-label={`Remover ${f.name}`} type="button" onClick={() => setArquivos((atual) => atual.filter((_, j) => j !== i))}>
                  <X size={12} strokeWidth={1.6} />
                </button>
              </span>
            ))}
          </div>
        ) : null}
        <RichTextEditor ariaLabel="Escrever mensagem" onChange={setHtml} placeholder="Escreva uma mensagem… (Enter envia, Shift+Enter quebra a linha)" resetKey={`${conversa.id}-${resetKey}`} value={html} />
        <div className="chat-composer-acoes">
          <input hidden multiple ref={arquivoRef} type="file" onChange={escolherArquivos} />
          <button aria-label="Anexar arquivo" className="chat-icone" title="Anexar arquivo (até 10 MB)" type="button" onClick={() => arquivoRef.current?.click()}>
            <Paperclip size={16} strokeWidth={1.6} />
          </button>
          <span className="chat-dica">Mensagens ficam guardadas por {CHAT_RETENCAO_DIAS} dias.</span>
          <button className="chat-btn chat-btn--pri" disabled={enviando || (textoVazio(html) && !arquivos.length)} type="button" onClick={() => void enviar()}>
            <Send size={14} strokeWidth={1.6} /> Enviar
          </button>
        </div>
      </div>
    </div>
  );
}
