import { FormEvent, useEffect, useState } from "react";
import type { HubUser } from "../types";
import { signIn } from "../lib/auth";
import { carregarFontesPremium, lerVisualPremium } from "../lib/visualPremium";
import "./loginScreen.css";

// Fotos da sede da H. Teixeira na tela de entrada; a foto muda a cada dois dias (a mesma para toda a equipe).
// "posicao" mantém o letreiro à vista quando a foto é recortada para caber no painel.
export const FOTOS_LOGIN = [
  { src: "/login/recepcao-1.webp", posicao: "50% 40%" },
  { src: "/login/recepcao-3.webp", posicao: "30% 45%" },
  { src: "/login/recepcao-2.webp", posicao: "50% 38%" },
  { src: "/login/frase.webp", posicao: "45% 40%" },
  { src: "/login/recepcao-4.webp", posicao: "30% 40%" },
  { src: "/login/recepcao-5.webp", posicao: "45% 40%" }
];

export function fotoDoLogin(agora = new Date()) {
  const dias = Math.floor(Date.UTC(agora.getFullYear(), agora.getMonth(), agora.getDate()) / 86400000);
  return FOTOS_LOGIN[Math.floor(dias / 2) % FOTOS_LOGIN.length];
}

export function LoginScreen({ onLogin, aviso, emailInicial }: { onLogin: (user: HubUser) => void; aviso?: string; emailInicial?: string }) {
  const [email, setEmail] = useState(emailInicial || import.meta.env.VITE_ADMIN_EMAIL || "fiscal10.hteixeira@gmail.com");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  // Visual premium: vale neste navegador se foi ligado aqui (o login ainda não sabe quem é o usuário).
  const [visual] = useState(lerVisualPremium);
  const foto = fotoDoLogin();

  useEffect(() => {
    if (visual.ativo) carregarFontesPremium();
  }, [visual.ativo]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");

    try {
      const session = await signIn(email, password);
      onLogin(session);
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : "Falha ao entrar.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={`login-page login-page--foto${visual.ativo ? ` login-premium login-premium--${visual.tema}` : ""}`}>
      <div className="login-foto">
        <img src={foto.src} alt="" style={{ objectPosition: foto.posicao }} />
        <div className="login-foto-legenda">
          <span>H. Teixeira Contabilidade</span>
          <p>Ao empreendedor que quiser prosperar, estaremos juntos para ajudar.</p>
        </div>
      </div>

      <div className="login-lado">
        {visual.ativo ? (
          <div className="login-orbes" aria-hidden="true">
            <i />
            <i />
            <i />
          </div>
        ) : null}
        <form className="login-panel" onSubmit={handleSubmit}>
          <div className="login-brand">
            <div className="brand-mark">HT</div>
            <div>
              <strong>HUB Depto Tributário</strong>
              <span>H. Teixeira</span>
            </div>
          </div>

          {visual.ativo ? <h1 className="login-titulo">Bem-vindo de volta</h1> : null}

          <label>
            E-mail
            <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" autoComplete="username" required />
          </label>

          <label>
            Senha
            <input
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              type="password"
              autoComplete="current-password"
              required
            />
          </label>

          {aviso && !error ? <p className="form-notice" role="status">{aviso}</p> : null}
          {error ? <p className="form-error">{error}</p> : null}

          <button className="primary-action" disabled={loading} type="submit">
            {loading ? "Entrando..." : "Entrar"}
          </button>
        </form>
      </div>
    </div>
  );
}
