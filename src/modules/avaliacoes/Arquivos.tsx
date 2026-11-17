// Botões de download (XLSX e PDF) e envio por e-mail com os arquivos anexados.
import { FileSpreadsheet, FileText, Mail } from "lucide-react";
import { useRef, useState } from "react";
import { enviarArquivosPorEmail, nomeArquivo, rotuloCompetencia, type Anexo, type Avaliacao } from "../../lib/avaliacoes";
import { getErrorMessage } from "../../lib/formatters";
import { MIME, baixarPdf, baixarXlsx, paraBase64, pdfAvaliacao, xlsxAvaliacao } from "./exportar";

export const MODELO_EMAIL = {
  assunto: "Avaliação Mensal — Competência {COMP}",
  corpo:
    "Olá, {NOME}.\n\nSegue em anexo sua avaliação mensal referente à competência {COMP}, contendo sua autoavaliação e a avaliação da coordenação.\n\nEm caso de dúvidas ou se desejar conversar sobre algum ponto específico, fico à disposição.\n\nAtenciosamente,\nCoordenação do Departamento Tributário\nH. Teixeira Contabilidade",
  corpoColaborador: "Cópia da minha avaliação de desempenho da competência {COMP}, gerada pelo HUB."
};

export function preencherModelo(t: string, a: Avaliacao) {
  return t.replace(/\{NOME\}/g, a.colaboradorNome.split(" ")[0] || a.colaboradorNome).replace(/\{COMP\}/g, rotuloCompetencia(a.competencia));
}

export async function anexosDa(a: Avaliacao, xlsx: boolean, pdf: boolean): Promise<Anexo[]> {
  const out: Anexo[] = [];
  if (xlsx) out.push({ nome: nomeArquivo(a, "xlsx"), tipo: MIME.xlsx, base64: paraBase64(xlsxAvaliacao(a)) });
  if (pdf) out.push({ nome: nomeArquivo(a, "pdf"), tipo: MIME.pdf, base64: paraBase64(await pdfAvaliacao(a)) });
  return out;
}

export function BotoesArquivos({ avaliacao, coordenacao, onAviso }: { avaliacao: Avaliacao; coordenacao: boolean; onAviso: (texto: string, erro?: boolean) => void }) {
  const dlg = useRef<HTMLDialogElement>(null);
  const [assunto, setAssunto] = useState("");
  const [mensagem, setMensagem] = useState("");
  const [xlsx, setXlsx] = useState(true);
  const [pdf, setPdf] = useState(true);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState("");
  const podeEnviar = avaliacao.status === "finalizada" || avaliacao.status === "replica";

  function abrir() {
    setAssunto(preencherModelo(MODELO_EMAIL.assunto, avaliacao));
    setMensagem(preencherModelo(coordenacao ? MODELO_EMAIL.corpo : MODELO_EMAIL.corpoColaborador, avaliacao));
    setErro("");
    dlg.current?.showModal();
  }

  async function enviar() {
    if (!xlsx && !pdf) return setErro("Escolha ao menos um arquivo para anexar.");
    if (!assunto.trim()) return setErro("Informe o assunto.");
    setEnviando(true);
    setErro("");
    try {
      const anexos = await anexosDa(avaliacao, xlsx, pdf);
      const msg = await enviarArquivosPorEmail({ id: avaliacao.id, para: coordenacao ? "colaborador" : "eu", assunto: assunto.trim(), mensagem, anexos });
      dlg.current?.close();
      onAviso(msg);
    } catch (e) {
      setErro(getErrorMessage(e));
    } finally {
      setEnviando(false);
    }
  }

  const destino = coordenacao ? `${avaliacao.colaboradorNome}${avaliacao.colaboradorEmail ? ` <${avaliacao.colaboradorEmail}>` : ""}` : "o seu e-mail cadastrado no HUB";

  return (
    <>
      <button className="avd-btn" title="Baixar no layout da planilha (Excel)" type="button" onClick={() => baixarXlsx(avaliacao)}>
        <FileSpreadsheet size={15} strokeWidth={1.6} />
        XLSX
      </button>
      <button
        className="avd-btn"
        title="Baixar em PDF"
        type="button"
        onClick={() => baixarPdf(avaliacao).catch((e) => onAviso(`Não foi possível gerar o PDF: ${getErrorMessage(e)}`, true))}
      >
        <FileText size={15} strokeWidth={1.6} />
        PDF
      </button>
      <button
        className="avd-btn"
        disabled={coordenacao && !podeEnviar}
        title={
          coordenacao
            ? podeEnviar
              ? "Enviar ao colaborador por e-mail, com os arquivos anexados"
              : "Disponível depois de finalizar a avaliação"
            : "Enviar uma cópia para o seu e-mail"
        }
        type="button"
        onClick={abrir}
      >
        <Mail size={15} strokeWidth={1.6} />
        E-mail
      </button>
      <dialog className="avd-dlg" ref={dlg} aria-label="Enviar avaliação por e-mail">
        <form
          method="dialog"
          onSubmit={(e) => {
            e.preventDefault();
            void enviar();
          }}
        >
          <h3>Enviar por e-mail</h3>
          <div className="avd-dica">Para: {destino}</div>
          <label>
            Assunto
            <input maxLength={200} type="text" value={assunto} onChange={(e) => setAssunto(e.target.value)} />
          </label>
          <label>
            Mensagem
            <textarea maxLength={4000} value={mensagem} onChange={(e) => setMensagem(e.target.value)} />
          </label>
          <div className="avd-marcas">
            <label>
              <input checked={xlsx} type="checkbox" onChange={(e) => setXlsx(e.target.checked)} /> Anexar XLSX
            </label>
            <label>
              <input checked={pdf} type="checkbox" onChange={(e) => setPdf(e.target.checked)} /> Anexar PDF
            </label>
          </div>
          {erro ? <p className="avd-aviso avd-aviso--erro">{erro}</p> : null}
          <footer>
            <button className="avd-btn" type="button" onClick={() => dlg.current?.close()}>
              Cancelar
            </button>
            <button className="avd-btn avd-btn--pri" disabled={enviando} type="submit">
              {enviando ? "Enviando…" : "Enviar"}
            </button>
          </footer>
        </form>
      </dialog>
    </>
  );
}
