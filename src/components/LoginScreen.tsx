import { FormEvent, useState } from "react";
import type { HubUser } from "../types";
import { signIn } from "../lib/auth";

export function LoginScreen({ onLogin, aviso, emailInicial }: { onLogin: (user: HubUser) => void; aviso?: string; emailInicial?: string }) {
  const [email, setEmail] = useState(emailInicial || import.meta.env.VITE_ADMIN_EMAIL || "fiscal10.hteixeira@gmail.com");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

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
    <div className="login-page">
      <form className="login-panel" onSubmit={handleSubmit}>
        <div className="login-brand">
          <div className="brand-mark">HT</div>
          <div>
            <strong>HUB Depto Tributário</strong>
            <span>H. Teixeira</span>
          </div>
        </div>

        <label>
          E-mail
          <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" required />
        </label>

        <label>
          Senha
          <input
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            type="password"
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
  );
}
