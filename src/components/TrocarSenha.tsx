import { useEffect, useRef, useState, type FormEvent } from "react";
import { Check, Eye, EyeOff, KeyRound, LogOut, X } from "lucide-react";
import { atualizarSessao } from "../lib/auth";
import { trocarMinhaSenha } from "../lib/usersRepository";
import type { HubUser } from "../types";
import "./trocarSenha.css";

// Troca da própria senha. "obrigatoria": primeiro acesso com senha provisória — não fecha até trocar
// (a única saída é sair do HUB). A senha nunca é guardada no navegador: vai direto ao servidor do HUB,
// que confere a senha atual e o bloqueio definido pelo administrador.

type Props = {
  user: HubUser;
  obrigatoria?: boolean;
  onFechar: () => void;
  onTrocada: (user: HubUser) => void;
  onSair?: () => void;
};

export function TrocarSenha({ user, obrigatoria = false, onFechar, onTrocada, onSair }: Props) {
  const [atual, setAtual] = useState("");
  const [nova, setNova] = useState("");
  const [confirmar, setConfirmar] = useState("");
  const [mostrar, setMostrar] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const [feito, setFeito] = useState(false);
  const primeiroCampo = useRef<HTMLInputElement>(null);

  useEffect(() => {
    primeiroCampo.current?.focus();
    if (obrigatoria) return;
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === "Escape") onFechar();
    };
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [obrigatoria, onFechar]);

  const regras = [
    { ok: nova.length >= 8, texto: "Pelo menos 8 caracteres" },
    { ok: /[A-Za-zÀ-ÿ]/.test(nova) && /\d/.test(nova), texto: "Letras e números" },
    { ok: Boolean(nova) && nova !== atual, texto: "Diferente da senha atual" },
    { ok: Boolean(confirmar) && nova === confirmar, texto: "Confirmação igual à nova senha" }
  ];
  const valida = regras.every((r) => r.ok) && Boolean(atual);

  async function enviar(evento: FormEvent) {
    evento.preventDefault();
    if (!valida || salvando) return;
    setSalvando(true);
    setErro("");
    try {
      await trocarMinhaSenha(user.email, atual, nova);
      setFeito(true);
      setAtual("");
      setNova("");
      setConfirmar("");
      const atualizado = atualizarSessao({ senhaProvisoria: false }) || { ...user, senhaProvisoria: false };
      window.setTimeout(() => onTrocada(atualizado), obrigatoria ? 900 : 1400);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível trocar a senha.");
    } finally {
      setSalvando(false);
    }
  }

  const tipo = mostrar ? "text" : "password";

  return (
    <div className="trocar-senha-fundo" role="presentation">
      <form className="trocar-senha" role="dialog" aria-modal="true" aria-labelledby="trocar-senha-titulo" onSubmit={enviar} noValidate>
        <header className="trocar-senha__topo">
          <span className="trocar-senha__icone" aria-hidden="true">
            <KeyRound size={18} strokeWidth={1.6} />
          </span>
          <div>
            <h2 id="trocar-senha-titulo">{obrigatoria ? "Crie sua senha" : "Trocar senha"}</h2>
            <p>
              {obrigatoria
                ? `Olá, ${user.nome.split(" ")[0]}! Você entrou com uma senha provisória. Por segurança, crie uma senha só sua para continuar.`
                : "Confirme a senha atual e escolha a nova."}
            </p>
          </div>
          {!obrigatoria ? (
            <button type="button" className="trocar-senha__fechar" onClick={onFechar} aria-label="Fechar">
              <X size={17} strokeWidth={1.6} />
            </button>
          ) : null}
        </header>

        {feito ? (
          <p className="trocar-senha__ok" role="status">
            <Check size={16} strokeWidth={1.8} aria-hidden="true" /> Senha trocada. {obrigatoria ? "Bem-vindo ao HUB!" : "Use a nova senha no próximo acesso."}
          </p>
        ) : (
          <>
            <label>
              {obrigatoria ? "Senha provisória (a que veio no e-mail)" : "Senha atual"}
              <input ref={primeiroCampo} type={tipo} autoComplete="current-password" value={atual} onChange={(e) => setAtual(e.target.value)} />
            </label>
            <label>
              Nova senha
              <input type={tipo} autoComplete="new-password" value={nova} onChange={(e) => setNova(e.target.value)} />
            </label>
            <label>
              Confirme a nova senha
              <input type={tipo} autoComplete="new-password" value={confirmar} onChange={(e) => setConfirmar(e.target.value)} />
            </label>
            <button type="button" className="trocar-senha__mostrar" onClick={() => setMostrar((v) => !v)} aria-pressed={mostrar}>
              {mostrar ? <EyeOff size={15} strokeWidth={1.6} /> : <Eye size={15} strokeWidth={1.6} />}
              {mostrar ? "Ocultar senhas" : "Mostrar senhas"}
            </button>
            <ul className="trocar-senha__regras" aria-label="Requisitos da nova senha">
              {regras.map((r) => (
                <li key={r.texto} className={r.ok ? "ok" : ""}>
                  <Check size={13} strokeWidth={2} aria-hidden="true" /> {r.texto}
                </li>
              ))}
            </ul>
            {erro ? (
              <p className="trocar-senha__erro" role="alert">
                {erro}
              </p>
            ) : null}
            <footer className="trocar-senha__acoes">
              {obrigatoria && onSair ? (
                <button type="button" className="trocar-senha__sair" onClick={onSair}>
                  <LogOut size={15} strokeWidth={1.6} /> Sair
                </button>
              ) : null}
              <button type="submit" className="primary-action" disabled={!valida || salvando}>
                {salvando ? "Salvando…" : obrigatoria ? "Criar senha e entrar" : "Trocar senha"}
              </button>
            </footer>
          </>
        )}
      </form>
    </div>
  );
}
