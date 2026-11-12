import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Download, History, RefreshCw, Search } from "lucide-react";
import { getErrorMessage } from "../lib/formatters";
import { downloadXlsxReport } from "../lib/reportExport";
import {
  HISTORICO_POR_PAGINA,
  detalhesEmLinhas,
  listarHistorico,
  listarHistoricoCompleto,
  type HistoricoFiltro,
  type HistoricoItem,
  type HistoricoPagina
} from "../lib/historicoRepository";

// Histórico e auditoria (só administradores): quem fez o quê em Pautas, Avisos, Tarefas, Férias e Apuração.

function isoLocal(data: Date) {
  return `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, "0")}-${String(data.getDate()).padStart(2, "0")}`;
}

function filtroInicial(): HistoricoFiltro {
  const hoje = new Date();
  const inicio = new Date(hoje);
  inicio.setDate(inicio.getDate() - 30);
  return { de: isoLocal(inicio), ate: isoLocal(hoje), modulo: "", usuario: "", busca: "" };
}

function dataHora(valor: string) {
  const d = new Date(valor);
  if (Number.isNaN(d.getTime())) return { data: valor, hora: "" };
  return {
    data: d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" }),
    hora: d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
  };
}

function tomDaAcao(acao: string) {
  const a = acao.toLowerCase();
  if (a.startsWith("exclu") || a.startsWith("retirou") || a.startsWith("apagou")) return "excluir";
  if (a.startsWith("criou") || a.startsWith("publicou") || a.startsWith("incluiu") || a.startsWith("cadastrou")) return "criar";
  if (a.startsWith("concluiu") || a.startsWith("marcou") || a.startsWith("fechou")) return "concluir";
  return "editar";
}

export function HistoricoModule() {
  const [filtro, setFiltro] = useState<HistoricoFiltro>(filtroInicial);
  const [aplicado, setAplicado] = useState<HistoricoFiltro>(filtroInicial);
  const [pagina, setPagina] = useState<HistoricoPagina | null>(null);
  const [itens, setItens] = useState<HistoricoItem[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [exportando, setExportando] = useState(false);
  const [erro, setErro] = useState("");
  const [abertos, setAbertos] = useState<Set<number>>(new Set());

  const carregar = useCallback(async (f: HistoricoFiltro, deslocamento = 0) => {
    setCarregando(true);
    setErro("");
    try {
      const resultado = await listarHistorico(f, deslocamento);
      setPagina(resultado);
      setItens((anteriores) => (deslocamento ? [...anteriores, ...resultado.itens] : resultado.itens));
      if (!deslocamento) setAbertos(new Set());
    } catch (e) {
      setErro(getErrorMessage(e));
      if (!deslocamento) setItens([]);
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    void carregar(aplicado, 0);
  }, [aplicado, carregar]);

  function aplicar(event?: React.FormEvent) {
    event?.preventDefault();
    if (filtro.de && filtro.ate && filtro.de > filtro.ate) {
      setErro("A data inicial é maior que a final.");
      return;
    }
    setAplicado({ ...filtro });
  }

  function limpar() {
    const f = filtroInicial();
    setFiltro(f);
    setAplicado(f);
  }

  function alternar(indice: number) {
    setAbertos((atual) => {
      const novo = new Set(atual);
      if (novo.has(indice)) novo.delete(indice);
      else novo.add(indice);
      return novo;
    });
  }

  async function exportar() {
    setExportando(true);
    setErro("");
    try {
      const todos = await listarHistoricoCompleto(aplicado);
      const linhas = todos.map((item) => {
        const { data, hora } = dataHora(item.quando);
        return {
          Data: data,
          Hora: hora,
          Usuário: item.usuario,
          Módulo: item.modulo,
          Ação: item.acao,
          Item: item.titulo,
          Detalhes: detalhesEmLinhas(item.detalhes).join(" | ")
        };
      });
      downloadXlsxReport(`Histórico do HUB ${aplicado.de} a ${aplicado.ate}`, linhas.length ? linhas : [{ Info: "Nenhum registro no filtro escolhido." }]);
    } catch (e) {
      setErro(getErrorMessage(e));
    } finally {
      setExportando(false);
    }
  }

  const total = pagina?.total ?? 0;
  const faltam = Math.max(0, total - itens.length);
  const filtroMudou = useMemo(() => JSON.stringify(filtro) !== JSON.stringify(aplicado), [filtro, aplicado]);

  return (
    <div className="historico-page">
      <section className="panel historico-panel">
        <header className="historico-head">
          <div className="historico-title">
            <History size={18} strokeWidth={1.6} />
            <div>
              <h2>Histórico e auditoria</h2>
              <p>Quem criou, editou, concluiu ou excluiu em Pautas, Avisos, Tarefas, Férias e Apuração. Visível só para administradores.</p>
            </div>
          </div>
          <div className="historico-head-actions">
            <button className="hist-btn" disabled={carregando} type="button" onClick={() => void carregar(aplicado, 0)} title="Recarregar">
              <RefreshCw size={15} strokeWidth={1.6} /> Atualizar
            </button>
            <button className="hist-btn" disabled={exportando || carregando || !total} type="button" onClick={() => void exportar()} title="Baixar em Excel o filtro atual">
              <Download size={15} strokeWidth={1.6} /> {exportando ? "Exportando..." : "Exportar Excel"}
            </button>
          </div>
        </header>

        <form className="historico-filtros" onSubmit={aplicar}>
          <label>
            <span>De</span>
            <input type="date" value={filtro.de} onChange={(e) => setFiltro({ ...filtro, de: e.target.value })} />
          </label>
          <label>
            <span>Até</span>
            <input type="date" value={filtro.ate} onChange={(e) => setFiltro({ ...filtro, ate: e.target.value })} />
          </label>
          <label>
            <span>Módulo</span>
            <select value={filtro.modulo} onChange={(e) => setFiltro({ ...filtro, modulo: e.target.value })}>
              <option value="">Todos</option>
              {(pagina?.modulos || []).map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Usuário</span>
            <select value={filtro.usuario} onChange={(e) => setFiltro({ ...filtro, usuario: e.target.value })}>
              <option value="">Todos</option>
              {(pagina?.usuarios || []).map((u) => (
                <option key={u.id} value={u.id}>{u.nome}</option>
              ))}
            </select>
          </label>
          <label className="historico-busca">
            <span>Buscar</span>
            <div className="historico-busca-campo">
              <Search size={14} strokeWidth={1.6} />
              <input placeholder="Título, empresa, ação..." value={filtro.busca} onChange={(e) => setFiltro({ ...filtro, busca: e.target.value })} />
            </div>
          </label>
          <div className="historico-filtros-acoes">
            <button className={filtroMudou ? "hist-btn hist-btn--primary" : "hist-btn"} disabled={carregando} type="submit">Filtrar</button>
            <button className="hist-btn hist-btn--ghost" type="button" onClick={limpar}>Limpar</button>
          </div>
        </form>

        {pagina?.local ? (
          <div className="historico-aviso">Modo demonstração: o histórico registra as ações feitas no banco do HUB e aparece aqui quando o HUB está conectado.</div>
        ) : null}
        {erro ? <div className="form-error">{erro}</div> : null}

        <div className="historico-resumo">
          {carregando && !itens.length ? "Carregando..." : `${total.toLocaleString("pt-BR")} registro(s) no período`}
        </div>

        <div className="historico-lista" role="table" aria-label="Histórico">
          <div className="historico-linha historico-linha--cab" role="row">
            <span role="columnheader">Quando</span>
            <span role="columnheader">Usuário</span>
            <span role="columnheader">Módulo</span>
            <span role="columnheader">Ação</span>
            <span role="columnheader">Item</span>
          </div>
          {itens.map((item, indice) => {
            const { data, hora } = dataHora(item.quando);
            const linhas = detalhesEmLinhas(item.detalhes);
            const aberto = abertos.has(indice);
            return (
              <div className={`historico-registro ${aberto ? "historico-registro--aberto" : ""}`} key={`${item.quando}-${indice}`} role="rowgroup">
                <div className="historico-linha" role="row">
                  <span className="historico-quando" role="cell"><strong>{data}</strong> {hora}</span>
                  <span role="cell">{item.usuario}</span>
                  <span className="historico-modulo" role="cell">{item.modulo}</span>
                  <span role="cell"><span className={`historico-acao historico-acao--${tomDaAcao(item.acao)}`}>{item.acao}</span></span>
                  <span className="historico-item" role="cell">
                    {linhas.length ? (
                      <button className="historico-toggle" type="button" aria-expanded={aberto} onClick={() => alternar(indice)} title={aberto ? "Ocultar detalhes" : "Ver detalhes"}>
                        {aberto ? <ChevronDown size={14} strokeWidth={1.6} /> : <ChevronRight size={14} strokeWidth={1.6} />}
                        <span>{item.titulo}</span>
                      </button>
                    ) : (
                      <span className="historico-item-texto">{item.titulo}</span>
                    )}
                  </span>
                </div>
                {aberto && linhas.length ? (
                  <ul className="historico-detalhes">
                    {linhas.map((linha, i) => (
                      <li key={i}>{linha}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            );
          })}
          {!carregando && !itens.length && !erro ? <div className="empty-state">Nenhum registro no filtro escolhido.</div> : null}
        </div>

        {faltam > 0 ? (
          <div className="historico-mais">
            <button className="hist-btn" disabled={carregando} type="button" onClick={() => void carregar(aplicado, itens.length)}>
              {carregando ? "Carregando..." : `Carregar mais ${Math.min(faltam, HISTORICO_POR_PAGINA)} (faltam ${faltam.toLocaleString("pt-BR")})`}
            </button>
          </div>
        ) : null}
      </section>
    </div>
  );
}
