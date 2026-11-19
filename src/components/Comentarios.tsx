import { type FormEvent, type KeyboardEvent, useCallback, useEffect, useState } from "react";
import { ChevronDown, Lock, LockOpen, MessageSquare, Send, Trash2 } from "lucide-react";
import type { HubUser } from "../types";
import {
  COMENTARIO_LIMITE,
  type Comentario,
  type ComentarioAlvo,
  aoMudarComentarios,
  bloquearComentarios,
  comentar,
  excluirComentario,
  isAdmin,
  listarComentarios,
  podeExcluirComentario
} from "../lib/comentariosRepository";

function quando(iso: string) {
  const data = new Date(iso);
  if (Number.isNaN(data.getTime())) return "";
  return data.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

// Conversa de um aviso ou pauta: lista, novo comentário e, para o administrador, excluir e bloquear.
export function Comentarios({
  alvo,
  alvoId,
  user,
  abertoInicial = false,
  contagem
}: {
  alvo: ComentarioAlvo;
  alvoId: string;
  user: HubUser;
  abertoInicial?: boolean;
  contagem?: number;
}) {
  const [aberto, setAberto] = useState(abertoInicial);
  const [lista, setLista] = useState<Comentario[] | null>(null);
  const [bloqueado, setBloqueado] = useState(false);
  const [texto, setTexto] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState("");
  const admin = isAdmin(user);

  const carregar = useCallback(async () => {
    try {
      const r = await listarComentarios(alvo, alvoId, user);
      setLista(r.comentarios);
      setBloqueado(r.bloqueado);
      setErro("");
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível carregar os comentários.");
    }
  }, [alvo, alvoId, user]);

  useEffect(() => {
    if (aberto) void carregar();
  }, [aberto, carregar]);

  useEffect(
    () =>
      aoMudarComentarios((a, id) => {
        if (a === alvo && id === alvoId && aberto) void carregar();
      }),
    [alvo, alvoId, aberto, carregar]
  );

  // Ao voltar para a aba do navegador, atualiza (outros usuários podem ter comentado).
  useEffect(() => {
    if (!aberto) return;
    const aoVoltar = () => {
      if (document.visibilityState === "visible") void carregar();
    };
    document.addEventListener("visibilitychange", aoVoltar);
    return () => document.removeEventListener("visibilitychange", aoVoltar);
  }, [aberto, carregar]);

  async function enviar(event?: FormEvent) {
    event?.preventDefault();
    if (!texto.trim() || ocupado) return;
    setOcupado(true);
    setErro("");
    try {
      await comentar(alvo, alvoId, texto, user);
      setTexto("");
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível comentar.");
    } finally {
      setOcupado(false);
    }
  }

  async function excluir(comentario: Comentario) {
    if (!window.confirm("Excluir este comentário?")) return;
    setOcupado(true);
    setErro("");
    try {
      await excluirComentario(comentario, user);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível excluir.");
    } finally {
      setOcupado(false);
    }
  }

  async function alternarBloqueio() {
    setOcupado(true);
    setErro("");
    try {
      await bloquearComentarios(alvo, alvoId, !bloqueado, user);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível alterar o bloqueio.");
    } finally {
      setOcupado(false);
    }
  }

  function aoTeclar(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) void enviar();
  }

  const total = lista ? lista.length : contagem;
  const podeEscrever = !bloqueado || admin;

  return (
    <section className={`hub-comentarios ${aberto ? "is-open" : ""}`} data-comentarios={`${alvo}:${alvoId}`}>
      <div className="hub-comentarios__head">
        <button aria-expanded={aberto} className="hub-comentarios__toggle" type="button" onClick={() => setAberto((v) => !v)}>
          <MessageSquare size={14} strokeWidth={1.6} />
          <span>Comentários{total ? ` (${total})` : ""}</span>
          {bloqueado ? <Lock aria-label="Comentários bloqueados" size={12} strokeWidth={1.6} /> : null}
          <ChevronDown className="hub-comentarios__chevron" size={14} strokeWidth={1.6} />
        </button>
        {aberto && admin ? (
          <button
            className="hub-comentarios__lock"
            disabled={ocupado}
            title={bloqueado ? "Permitir novos comentários" : "Impedir novos comentários (administradores continuam podendo comentar)"}
            type="button"
            onClick={() => void alternarBloqueio()}
          >
            {bloqueado ? <LockOpen size={13} strokeWidth={1.6} /> : <Lock size={13} strokeWidth={1.6} />}
            {bloqueado ? "Desbloquear" : "Bloquear"}
          </button>
        ) : null}
      </div>

      {aberto ? (
        <div className="hub-comentarios__body">
          {lista === null && !erro ? <p className="hub-comentarios__vazio">Carregando…</p> : null}
          {lista && !lista.length ? <p className="hub-comentarios__vazio">Nenhum comentário ainda.</p> : null}
          {lista && lista.length ? (
            <ul className="hub-comentarios__lista">
              {lista.map((c) => (
                <li key={c.id}>
                  <div className="hub-comentarios__meta">
                    <strong>{c.autorNome}</strong>
                    <time dateTime={c.createdAt}>{quando(c.createdAt)}</time>
                    {podeExcluirComentario(c, user) ? (
                      <button
                        aria-label={`Excluir comentário de ${c.autorNome}`}
                        className="hub-comentarios__excluir"
                        disabled={ocupado}
                        title="Excluir comentário"
                        type="button"
                        onClick={() => void excluir(c)}
                      >
                        <Trash2 size={13} strokeWidth={1.6} />
                      </button>
                    ) : null}
                  </div>
                  <p>{c.texto}</p>
                </li>
              ))}
            </ul>
          ) : null}

          {bloqueado ? (
            <p className="hub-comentarios__bloqueio">
              <Lock size={12} strokeWidth={1.6} />
              {admin ? "Comentários bloqueados para os usuários. Você ainda pode comentar." : "Comentários bloqueados pela coordenação."}
            </p>
          ) : null}

          {podeEscrever ? (
            <form className="hub-comentarios__form" onSubmit={(e) => void enviar(e)}>
              <textarea
                aria-label="Escrever comentário"
                maxLength={COMENTARIO_LIMITE}
                placeholder="Escreva um comentário ou pergunta…"
                rows={2}
                value={texto}
                onChange={(e) => setTexto(e.target.value)}
                onKeyDown={aoTeclar}
              />
              <button disabled={ocupado || !texto.trim()} title="Enviar (Ctrl+Enter)" type="submit">
                <Send size={13} strokeWidth={1.6} />
                Comentar
              </button>
            </form>
          ) : null}
          {erro ? <p className="hub-comentarios__erro" role="alert">{erro}</p> : null}
        </div>
      ) : null}
    </section>
  );
}
