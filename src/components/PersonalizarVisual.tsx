import { useEffect, useRef } from "react";
import { Moon, RotateCcw, Sun, X } from "lucide-react";
import {
  PALETA_PADRAO,
  PREDEFINICOES_DESTAQUE,
  salvarVisualPremium,
  tonsDaPaleta,
  type PaletaPremium,
  type VisualPremium
} from "../lib/visualPremium";

// Gaveta "Personalizar visual": tema, tamanho e a paleta (cor de destaque, matiz, intensidade,
// luzes, degradê, vidro, sombra e cantos). Tudo fica gravado neste navegador.
// Coral (atrasos), âmbar (prazos) e as cores da marca não mudam: a semântica do padrão se mantém.

type Controle = {
  chave: "s" | "luz" | "degrade" | "angulo" | "vidro" | "sombra" | "raio";
  rotulo: string;
  min: number;
  max: number;
  passo: number;
  unidade: string;
  dica: string;
};

const CONTROLES: Controle[] = [
  { chave: "s", rotulo: "Intensidade da cor", min: 40, max: 100, passo: 1, unidade: "%", dica: "Mais suave ↔ mais viva" },
  { chave: "luz", rotulo: "Luzes de fundo", min: 0, max: 140, passo: 5, unidade: "%", dica: "Sem luzes ↔ luzes fortes" },
  { chave: "degrade", rotulo: "Degradê do fundo", min: 0, max: 100, passo: 5, unidade: "%", dica: "Chapado ↔ degradê completo" },
  { chave: "angulo", rotulo: "Ângulo do degradê", min: 150, max: 200, passo: 5, unidade: "°", dica: "Inclina a direção do degradê" },
  { chave: "vidro", rotulo: "Vidro dos cartões", min: 60, max: 160, passo: 5, unidade: "%", dica: "Mais transparente ↔ mais opaco" },
  { chave: "sombra", rotulo: "Sombra", min: 0, max: 200, passo: 10, unidade: "%", dica: "Sem sombra ↔ sombra profunda" },
  { chave: "raio", rotulo: "Cantos", min: 12, max: 32, passo: 2, unidade: "px", dica: "Mais retos ↔ mais arredondados" }
];

export function PersonalizarVisual({ visual, onFechar }: { visual: VisualPremium; onFechar: () => void }) {
  const painelRef = useRef<HTMLDivElement>(null);
  const { paleta, tema, tamanho } = visual;
  const anguloPadrao = tema === "escuro" ? 180 : 160;
  const tons = tonsDaPaleta(paleta, tema);
  const predefinicoes = PREDEFINICOES_DESTAQUE.filter((item) => !("soEscuro" in item && item.soEscuro) || tema === "escuro");

  useEffect(() => {
    painelRef.current?.focus();
    const aoTeclar = (evento: KeyboardEvent) => {
      if (evento.key === "Escape") onFechar();
    };
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [onFechar]);

  function mudar(parcial: Partial<PaletaPremium>) {
    salvarVisualPremium({ paleta: parcial });
  }

  function valor(chave: Controle["chave"]) {
    if (chave === "angulo") return paleta.angulo ?? anguloPadrao;
    return paleta[chave];
  }

  return (
    <div className="hp-paleta-fundo" role="presentation" onClick={onFechar}>
      <div
        aria-labelledby="hp-paleta-titulo"
        aria-modal="true"
        className="hp-paleta"
        ref={painelRef}
        role="dialog"
        tabIndex={-1}
        onClick={(evento) => evento.stopPropagation()}
      >
        <header className="hp-paleta-topo">
          <div>
            <span className="hp-paleta-rotulo">Padrão H. Teixeira Premium</span>
            <h2 id="hp-paleta-titulo">Personalizar visual</h2>
            <p>Vale só neste navegador. Atrasos, prazos e as cores da marca não mudam.</p>
          </div>
          <button type="button" className="hp-paleta-icone" onClick={onFechar} aria-label="Fechar personalização" title="Fechar">
            <X size={18} strokeWidth={1.6} />
          </button>
        </header>

        <div className="hp-paleta-corpo">
          <fieldset className="hp-paleta-grupo">
            <legend>Tema</legend>
            <div className="hp-paleta-alternar">
              <button type="button" aria-pressed={tema === "escuro"} onClick={() => salvarVisualPremium({ tema: "escuro" })}>
                <Moon size={15} strokeWidth={1.6} /> Escuro
              </button>
              <button type="button" aria-pressed={tema === "claro"} onClick={() => salvarVisualPremium({ tema: "claro" })}>
                <Sun size={15} strokeWidth={1.6} /> Claro
              </button>
            </div>
          </fieldset>

          <fieldset className="hp-paleta-grupo">
            <legend>Tamanho do texto</legend>
            <div className="hp-paleta-alternar">
              <button type="button" aria-pressed={tamanho === "compacto"} onClick={() => salvarVisualPremium({ tamanho: "compacto" })}>
                Compacto
              </button>
              <button type="button" aria-pressed={tamanho === "ampliado"} onClick={() => salvarVisualPremium({ tamanho: "ampliado" })}>
                Ampliado
              </button>
            </div>
          </fieldset>

          <fieldset className="hp-paleta-grupo">
            <legend>Cor de destaque</legend>
            <div className="hp-paleta-amostras">
              {predefinicoes.map((item) => (
                <button
                  key={item.h}
                  type="button"
                  className="hp-paleta-amostra"
                  aria-pressed={paleta.base === item.h}
                  aria-label={item.nome}
                  title={item.nome}
                  onClick={() => mudar({ base: item.h, h: item.h })}
                >
                  <i style={{ background: `hsl(${item.h} ${paleta.s}% ${tema === "escuro" ? 42 : 30}%)` }} />
                  <span>{item.nome}</span>
                </button>
              ))}
            </div>
            <label className="hp-paleta-controle">
              <span className="hp-paleta-controle-topo">
                <span>Matiz fino</span>
                <output>{paleta.h - paleta.base > 0 ? "+" : ""}{paleta.h - paleta.base}°</output>
              </span>
              <input
                type="range"
                min={paleta.base - 20}
                max={paleta.base + 20}
                step={1}
                value={paleta.h}
                onChange={(evento) => mudar({ h: Number(evento.target.value) })}
              />
              <small>Puxa o destaque para o vizinho de cor (até 20° para cada lado)</small>
            </label>
          </fieldset>

          <fieldset className="hp-paleta-grupo">
            <legend>Nuances</legend>
            {CONTROLES.map((controle) => (
              <label key={controle.chave} className="hp-paleta-controle">
                <span className="hp-paleta-controle-topo">
                  <span>{controle.rotulo}</span>
                  <output>
                    {valor(controle.chave)}
                    {controle.unidade}
                  </output>
                </span>
                <input
                  type="range"
                  min={controle.min}
                  max={controle.max}
                  step={controle.passo}
                  value={valor(controle.chave)}
                  onChange={(evento) => mudar({ [controle.chave]: Number(evento.target.value) } as Partial<PaletaPremium>)}
                />
                <small>{controle.dica}</small>
              </label>
            ))}
          </fieldset>

          {tons.ajustado ? (
            <p className="hp-paleta-aviso" role="status">
              Ajustamos o tom para manter a leitura.
            </p>
          ) : null}
        </div>

        <footer className="hp-paleta-pe">
          <button
            type="button"
            className="hp-paleta-restaurar"
            onClick={() => salvarVisualPremium({ paleta: null })}
            disabled={JSON.stringify(paleta) === JSON.stringify(PALETA_PADRAO)}
          >
            <RotateCcw size={15} strokeWidth={1.6} /> Restaurar padrão H. Teixeira
          </button>
        </footer>
      </div>
    </div>
  );
}
