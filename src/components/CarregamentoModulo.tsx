import { Component, type ReactNode } from "react";

const CHAVE_RECARGA = "hub_modulo_recarregado";

type Estado = { falhou: boolean };

/**
 * Protege os módulos carregados sob demanda. Depois de uma publicação nova,
 * uma aba aberta há tempo pode pedir um arquivo que não existe mais: nesse
 * caso a página é recarregada uma única vez para buscar a versão atual.
 */
export class CarregamentoModulo extends Component<{ children: ReactNode }, Estado> {
  state: Estado = { falhou: false };

  static getDerivedStateFromError(): Estado {
    return { falhou: true };
  }

  componentDidCatch(erro: unknown) {
    const mensagem = erro instanceof Error ? erro.message : String(erro);
    const falhaDeCarga = /dynamically imported module|Importing a module script failed|Failed to fetch|ChunkLoadError|error loading/i.test(mensagem);
    let jaRecarregou = false;
    try {
      jaRecarregou = sessionStorage.getItem(CHAVE_RECARGA) === "1";
      if (falhaDeCarga && !jaRecarregou) sessionStorage.setItem(CHAVE_RECARGA, "1");
    } catch {
      jaRecarregou = true;
    }
    if (falhaDeCarga && !jaRecarregou) window.location.reload();
  }

  componentDidMount() {
    // Carga bem-sucedida: libera uma nova recarga automática no futuro.
    window.setTimeout(() => {
      try {
        if (!this.state.falhou) sessionStorage.removeItem(CHAVE_RECARGA);
      } catch {
        /* sem armazenamento: nada a fazer */
      }
    }, 5000);
  }

  render() {
    if (!this.state.falhou) return this.props.children;
    return (
      <div className="module-error" role="alert">
        <p>Não foi possível abrir este módulo. Verifique a conexão e recarregue a página.</p>
        <button className="btn-mini primary" type="button" onClick={() => window.location.reload()}>
          Recarregar
        </button>
      </div>
    );
  }
}
