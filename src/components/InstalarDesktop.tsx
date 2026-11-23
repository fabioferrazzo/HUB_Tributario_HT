import { Download, MonitorDown, X } from "lucide-react";
import { useEffect, useState } from "react";
import { INSTALADOR_DESKTOP_URL, ehDesktop } from "../lib/desktop";

// Botão do menu lateral que oferece o HUB instalado no Windows (some quando já se está nele).
export function InstalarDesktop() {
  const [aberto, setAberto] = useState(false);
  const windows = typeof navigator !== "undefined" && /Windows/i.test(navigator.userAgent);

  useEffect(() => {
    if (!aberto) return;
    const fechar = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAberto(false);
    };
    window.addEventListener("keydown", fechar);
    return () => window.removeEventListener("keydown", fechar);
  }, [aberto]);

  if (ehDesktop()) return null;

  return (
    <>
      <button className="sign-out sign-out--instalar" type="button" title="Instalar o HUB no computador (Windows)" onClick={() => setAberto(true)}>
        <MonitorDown size={17} />
        <span>Instalar no PC</span>
      </button>
      {aberto ? (
        <div className="instalar-desktop-fundo" role="presentation" onClick={() => setAberto(false)}>
          <section
            className="instalar-desktop"
            role="dialog"
            aria-modal="true"
            aria-labelledby="instalar-desktop-titulo"
            onClick={(e) => e.stopPropagation()}
          >
            <header>
              <h2 id="instalar-desktop-titulo">HUB Tributário no computador</h2>
              <button type="button" aria-label="Fechar" title="Fechar" onClick={() => setAberto(false)}>
                <X size={16} strokeWidth={1.7} />
              </button>
            </header>
            <p>
              O mesmo HUB, numa janela própria: fica no ícone perto do relógio, abre com o Windows e o
              &ldquo;chamar atenção&rdquo; do chat traz a janela para a frente de qualquer programa. Ele se atualiza sozinho.
            </p>
            <ol>
              <li>Clique em <strong>Baixar instalador</strong> e abra o arquivo baixado.</li>
              <li>
                Se aparecer <strong>&ldquo;O Windows protegeu o computador&rdquo;</strong>, clique em <strong>Mais informações</strong> e
                depois em <strong>Executar assim mesmo</strong> (só na primeira vez).
              </li>
              <li>O HUB abre sozinho. Entre com o seu e-mail e senha de sempre.</li>
            </ol>
            <p className="instalar-desktop-nota">
              Não pede senha de administrador. Para remover: Configurações do Windows → Aplicativos → HUB Tributário → Desinstalar.
            </p>
            {windows ? null : <p className="instalar-desktop-nota">Disponível só para Windows 10 e 11.</p>}
            <div className="instalar-desktop-acoes">
              <a className="instalar-desktop-baixar" href={INSTALADOR_DESKTOP_URL} download="HUB-Tributario-Instalador.exe">
                <Download size={15} strokeWidth={1.8} /> Baixar instalador
              </a>
              <button type="button" onClick={() => setAberto(false)}>
                Agora não
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
