// Arquivos da avaliação: XLSX no layout da planilha, PDF e XLSX consolidado da competência.
import { createZipArchive, downloadBlob, encodeUtf8 } from "../../lib/reportExport";
import {
  AVALIACAO_TITULO,
  AVALIACAO_TITULO_PLANILHA,
  CRITERIOS,
  ESCALA,
  FEEDBACK_INTRO,
  PERGUNTAS_FEEDBACK,
  STATUS_COORDENACAO,
  faixa,
  formatarNota,
  media,
  nomeArquivo,
  notasPreenchidas,
  notaValida,
  rotuloCompetencia,
  type Avaliacao,
  type Notas
} from "../../lib/avaliacoes";

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

// ---------------------------------------------------------------------------------------------
// XLSX (SpreadsheetML escrito à mão, com estilos, mesclagens e larguras da planilha)

type Celula = { v?: string | number | null; s?: number; f?: string };
type Planilha = {
  nome: string;
  larguras: number[];
  alturas: Record<number, number>;
  celulas: Map<string, Celula>;
  mescladas: string[];
  paisagem?: boolean;
};

function esc(t: string) {
  return t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
}
function col(n: number) {
  let s = "";
  for (n += 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}
function ref(c: string) {
  const m = /^([A-Z]+)(\d+)$/.exec(c)!;
  let n = 0;
  for (const ch of m[1]) n = n * 26 + ch.charCodeAt(0) - 64;
  return { c: n - 1, r: Number(m[2]) };
}

// Estilos (índices de cellXfs)
const S = {
  padrao: 0, titulo: 1, cabCoord: 2, cabColab: 3, cabSub: 4, cabCinza: 5, criterio: 6, notaCoord: 7, justCoord: 8, notaColab: 9, justColab: 10,
  notaSub: 11, justSub: 12, caixaGeral: 13, totalRot: 14, totalVal: 15, recTitulo: 16, texto: 17, escala: 18, sugTitulo: 19, rotulo: 20, textoTopo: 21,
  numero: 22, info: 23, cabTabela: 24, celula: 25, celulaNum: 26, cabCinzaP: 27
};

function stylesXml() {
  const fills = ["none", "gray125", "FFDBE5F1", "FFB8CCE4", "FF8DB3E2", "FFEBF1DE", "FFFF0000", "FFE5E0EC", "FFF2F2F2"];
  const fillXml = fills
    .map((f, i) => (i < 2 ? `<fill><patternFill patternType="${f}"/></fill>` : `<fill><patternFill patternType="solid"><fgColor rgb="${f}"/><bgColor indexed="64"/></patternFill></fill>`))
    .join("");
  // fontes: 0 normal 11, 1 negrito 11, 2 negrito 16, 3 negrito 9, 4 negrito 12, 5 negrito branco 11, 6 negrito 14, 7 itálico 10
  const fonts = [
    `<font><sz val="11"/><name val="Calibri"/></font>`,
    `<font><b/><sz val="11"/><name val="Calibri"/></font>`,
    `<font><b/><sz val="16"/><name val="Calibri"/></font>`,
    `<font><b/><sz val="9"/><name val="Calibri"/></font>`,
    `<font><b/><sz val="12"/><name val="Calibri"/></font>`,
    `<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>`,
    `<font><b/><sz val="14"/><name val="Calibri"/></font>`,
    `<font><i/><sz val="10"/><color rgb="FF555555"/><name val="Calibri"/></font>`
  ];
  // xf: [fonte, preenchimento, borda(0/1), horizontal, vertical, quebra, formato]
  const xfs: Array<[number, number, number, string, string, boolean, number]> = [
    [0, 0, 0, "", "", false, 0], // padrao
    [2, 2, 0, "center", "center", true, 0], // titulo
    [3, 2, 1, "center", "center", true, 0], // cabCoord
    [3, 3, 1, "center", "center", true, 0], // cabColab
    [3, 4, 1, "center", "center", true, 0], // cabSub
    [4, 2, 1, "center", "center", true, 0], // cabCinza
    [1, 0, 1, "left", "center", true, 0], // criterio
    [0, 2, 1, "center", "center", true, 0], // notaCoord
    [0, 2, 1, "left", "center", true, 0], // justCoord
    [0, 3, 1, "center", "center", true, 0], // notaColab
    [0, 3, 1, "left", "center", true, 0], // justColab
    [0, 4, 1, "center", "center", true, 0], // notaSub
    [0, 4, 1, "left", "center", true, 0], // justSub
    [0, 2, 1, "left", "top", true, 0], // caixaGeral
    [1, 0, 1, "center", "center", true, 0], // totalRot
    [1, 0, 1, "center", "center", false, 2], // totalVal
    [4, 5, 0, "left", "center", true, 0], // recTitulo
    [0, 0, 0, "left", "center", true, 0], // texto
    [5, 6, 1, "center", "center", false, 0], // escala
    [6, 7, 1, "center", "center", false, 0], // sugTitulo
    [1, 0, 0, "left", "center", true, 0], // rotulo
    [0, 0, 0, "left", "top", true, 0], // textoTopo
    [0, 0, 1, "center", "center", false, 0], // numero
    [7, 0, 0, "left", "center", true, 0], // info
    [1, 8, 1, "center", "center", true, 0], // cabTabela
    [0, 0, 1, "left", "top", true, 0], // celula
    [0, 0, 1, "center", "top", false, 2], // celulaNum
    [3, 2, 1, "center", "center", true, 0] // cabCinzaP
  ];
  const xfXml = xfs
    .map(([f, fi, b, h, v, w, nf]) => {
      const al = h || v || w ? `<alignment${h ? ` horizontal="${h}"` : ""}${v ? ` vertical="${v}"` : ""}${w ? ` wrapText="1"` : ""}/>` : "";
      return `<xf numFmtId="${nf}" fontId="${f}" fillId="${fi}" borderId="${b}" xfId="0"${nf ? ` applyNumberFormat="1"` : ""} applyFont="1" applyFill="1" applyBorder="1"${al ? ` applyAlignment="1">${al}</xf>` : "/>"}`;
    })
    .join("");
  const borda = `<border><left style="thin"><color rgb="FF8E9AAF"/></left><right style="thin"><color rgb="FF8E9AAF"/></right><top style="thin"><color rgb="FF8E9AAF"/></top><bottom style="thin"><color rgb="FF8E9AAF"/></bottom><diagonal/></border>`;
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
        `<fonts count="${fonts.length}">${fonts.join("")}</fonts>` +
    `<fills count="${fills.length}">${fillXml}</fills>` +
    `<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>${borda}</borders>` +
    `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
    `<cellXfs count="${xfs.length}">${xfXml}</cellXfs>` +
    `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`
  );
}

function sheetXml(p: Planilha) {
  const linhas = new Map<number, Array<[number, string, Celula]>>();
  for (const [r, c] of p.celulas) {
    const { c: ci, r: ri } = ref(r);
    if (!linhas.has(ri)) linhas.set(ri, []);
    linhas.get(ri)!.push([ci, r, c]);
  }
  for (const r of Object.keys(p.alturas).map(Number)) if (!linhas.has(r)) linhas.set(r, []);
  const corpo = [...linhas.keys()]
    .sort((a, b) => a - b)
    .map((r) => {
      const cels = linhas
        .get(r)!
        .sort((a, b) => a[0] - b[0])
        .map(([, endereco, c]) => {
          const s = c.s ? ` s="${c.s}"` : "";
          if (c.f) return `<c r="${endereco}"${s}><f>${esc(c.f)}</f>${typeof c.v === "number" ? `<v>${c.v}</v>` : ""}</c>`;
          if (typeof c.v === "number") return `<c r="${endereco}"${s}><v>${c.v}</v></c>`;
          if (c.v === null || c.v === undefined || c.v === "") return `<c r="${endereco}"${s}/>`;
          return `<c r="${endereco}"${s} t="inlineStr"><is><t xml:space="preserve">${esc(String(c.v))}</t></is></c>`;
        })
        .join("");
      const h = p.alturas[r] ? ` ht="${p.alturas[r]}" customHeight="1"` : "";
      return `<row r="${r}"${h}>${cels}</row>`;
    })
    .join("");
  const cols = p.larguras.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("");
  const merges = p.mescladas.length ? `<mergeCells count="${p.mescladas.length}">${p.mescladas.map((m) => `<mergeCell ref="${m}"/>`).join("")}</mergeCells>` : "";
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><sheetViews><sheetView workbookViewId="0" zoomScale="90"/></sheetViews><sheetFormatPr defaultRowHeight="15"/>` +
    `<cols>${cols}</cols><sheetData>${corpo}</sheetData>${merges}` +
    `<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/>` +
    `<pageSetup paperSize="9" orientation="${p.paisagem === false ? "portrait" : "landscape"}" fitToWidth="1" fitToHeight="0"/></worksheet>`
  );
}

export function montarXlsx(planilhas: Planilha[]): Uint8Array {
  const sheets = planilhas.map((p, i) => `<sheet name="${esc(p.nome.slice(0, 31))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("");
  const rels = planilhas
    .map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`)
    .join("");
  const files = [
    {
      name: "[Content_Types].xml",
      data: encodeUtf8(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${planilhas
          .map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`)
          .join("")}</Types>`
      )
    },
    {
      name: "_rels/.rels",
      data: encodeUtf8(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`
      )
    },
    {
      name: "xl/workbook.xml",
      data: encodeUtf8(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets}</sheets><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>`
      )
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      data: encodeUtf8(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}<Relationship Id="rId${planilhas.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`
      )
    },
    { name: "xl/styles.xml", data: encodeUtf8(stylesXml()) },
    ...planilhas.map((p, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: encodeUtf8(sheetXml(p)) }))
  ];
  return createZipArchive(files);
}

function nota(n: Notas, id: string) {
  const v = (n as Record<string, { nota: number | null } | undefined>)[id]?.nota;
  return notaValida(v) ? v : null;
}
function just(n: Notas, id: string) {
  return (n as Record<string, { justificativa?: string } | undefined>)[id]?.justificativa || "";
}
function dataCurta(v?: string) {
  return v ? new Date(v).toLocaleDateString("pt-BR") : "";
}
function textoReplicas(a: Avaliacao) {
  return a.replicas
    .map((r, i) => `Réplica ${i + 1} (${dataCurta(r.enviadaEm)}): ${r.texto}${r.resposta ? `\nResposta da coordenação (${dataCurta(r.respondidaEm)}): ${r.resposta}` : ""}`)
    .join("\n\n");
}

// Planilha da avaliação no layout do modelo (aba "Plan1").
export function planilhaAvaliacao(a: Avaliacao): Planilha {
  const k = a.coordenacao;
  const usaSub = !!k && notasPreenchidas(k.subcoordenacao) > 0;
  const cel = new Map<string, Celula>();
  const put = (r: string, v: Celula["v"], s = 0, f?: string) => cel.set(r, { v, s, f });
  const mescladas = ["B1:F1", "C2:D2", "E2:F2", "H2:I2", "G4:G5", "G6:G7", "G8:G10", "B21:D21", "C22:D22", "G17:G21", "G23:G26", "G27:G28", "G29:G30"];
  put("B1", AVALIACAO_TITULO_PLANILHA, S.titulo);
  for (const c of ["C1", "D1", "E1", "F1"]) put(c, null, S.titulo);
  put("G1", `Colaborador: ${a.colaboradorNome} · Competência: ${rotuloCompetencia(a.competencia)} · ${STATUS_COORDENACAO[a.status]}`, S.info);
  put("C2", "COORDENADOR", S.cabCoord);
  put("D2", null, S.cabCoord);
  put("E2", "COLABORADOR (autoavaliação)", S.cabColab);
  put("F2", null, S.cabColab);
  put("G2", "Para preenchimento do Coordenador (itens 1 e 2) e do Colaborador (item 3)", S.cabCinzaP);
  put("H2", "Subcoordenação", S.cabSub);
  put("I2", null, S.cabSub);
  put("B3", "CRITÉRIOS", S.cabCinza);
  put("C3", "NOTA", S.cabCoord);
  put("D3", "Justificativa", S.cabCoord);
  put("E3", "NOTA", S.cabColab);
  put("F3", "JUSTIFICATIVA. Por quê mereço essa nota?", S.cabColab);
  put("G3", "Avaliação Geral e detalhes (Feedback)", S.cabCinza);
  put("H3", "NOTA", S.cabSub);
  put("I3", "Justificativa", S.cabSub);
  CRITERIOS.forEach((c, i) => {
    const r = 4 + i;
    put(`A${r}`, i + 1, S.numero);
    put(`B${r}`, `${c.nome.toUpperCase()} (${c.detalhe})`, S.criterio);
    put(`C${r}`, k ? nota(k.notas, c.id) : null, S.notaCoord);
    put(`D${r}`, k ? just(k.notas, c.id) : "", S.justCoord);
    put(`E${r}`, nota(a.colaborador.notas, c.id), S.notaColab);
    put(`F${r}`, just(a.colaborador.notas, c.id), S.justColab);
    put(`H${r}`, usaSub && k ? nota(k.subcoordenacao, c.id) : null, S.notaSub);
    put(`I${r}`, usaSub && k ? just(k.subcoordenacao, c.id) : "", S.justSub);
  });
  put("G4", `1 - Pontos Positivos:\n${k?.pontosPositivos || ""}`, S.caixaGeral);
  put("G5", null, S.caixaGeral);
  put("G6", `2 - A melhorar/Sugestões:\n${k?.aMelhorar || ""}`, S.caixaGeral);
  put("G7", null, S.caixaGeral);
  put("G8", `3 - Dúvidas ou réplica do colaborador:\n${textoReplicas(a)}`, S.caixaGeral);
  put("G9", null, S.caixaGeral);
  put("G10", null, S.caixaGeral);
  put("B11", "TOTAL", S.totalRot);
  const mK = k ? media(k.notas) : null;
  const mC = media(a.colaborador.notas);
  const mS = usaSub && k ? media(k.subcoordenacao) : null;
  if (mK !== null) cel.set("C11", { f: "SUM(C4:C10)/7", v: mK, s: S.totalVal });
  else put("C11", null, S.totalVal);
  put("D11", faixa(mK), S.totalRot);
  if (mC !== null) cel.set("E11", { f: "SUM(E4:E10)/7", v: mC, s: S.totalVal });
  else put("E11", null, S.totalVal);
  put("F11", faixa(mC), S.totalRot);
  if (mS !== null) cel.set("H11", { f: "SUM(H4:H10)/7", v: mS, s: S.totalVal });
  put("B13", "Recomendações:", S.recTitulo);
  put("C13", "Acima de", S.rotulo);
  const recs = k?.recomendacoes || [];
  for (let i = 0; i < 5; i++) put(`B${14 + i}`, `${i + 1} - ${recs[i] || ""}`, S.texto);
  ESCALA.forEach((e, i) => {
    put(`C${14 + i}`, e.minimo, S.escala);
    put(`D${14 + i}`, e.rotulo.toUpperCase(), S.escala);
  });
  put("G14", "Feedback", S.cabCinza);
  put("G15", FEEDBACK_INTRO, S.rotulo);
  const posFeedback: Array<[string, string]> = [
    ["G16", "G17"],
    ["G22", "G23"],
    ["G27", "G29"]
  ];
  PERGUNTAS_FEEDBACK.forEach((q, i) => {
    put(posFeedback[i][0], q.pergunta, S.rotulo);
    put(posFeedback[i][1], a.colaborador.feedback[q.id] || "", S.textoTopo);
  });
  put("B21", "Sugestões do colaborador:", S.sugTitulo);
  put("C21", null, S.sugTitulo);
  put("D21", null, S.sugTitulo);
  put("B22", "Sugestão:", S.cabTabela);
  put("C22", "Justificativa:", S.cabTabela);
  put("D22", null, S.cabTabela);
  const sug = a.colaborador.sugestoes.length ? a.colaborador.sugestoes : [{ sugestao: "", justificativa: "" }];
  sug.forEach((s, i) => {
    const r = 23 + i;
    put(`B${r}`, `${i + 1}- ${s.sugestao}`, S.celula);
    put(`C${r}`, s.justificativa, S.celula);
    put(`D${r}`, null, S.celula);
    mescladas.push(`C${r}:D${r}`);
  });
  const alturas: Record<number, number> = { 1: 26, 2: 24, 3: 42, 11: 18, 13: 24, 14: 36, 15: 30, 16: 30, 17: 30, 18: 30 };
  CRITERIOS.forEach((_, i) => (alturas[4 + i] = 60));
  sug.forEach((s, i) => (alturas[23 + i] = Math.min(150, Math.max(30, 15 * Math.ceil(Math.max(s.sugestao.length / 45, s.justificativa.length / 30, 1))))));
  return { nome: "Plan1", larguras: [3.5, 44, 8, 26, 8, 46, 66, 10, 28], alturas, celulas: cel, mescladas };
}

export function xlsxAvaliacao(a: Avaliacao) {
  return montarXlsx([planilhaAvaliacao(a)]);
}

// Consolidado da competência: uma linha por colaborador.
export function xlsxConsolidado(competencia: string, itens: Avaliacao[], pendentes: string[]) {
  const cel = new Map<string, Celula>();
  const put = (r: string, v: Celula["v"], s = 0) => cel.set(r, { v, s });
  const cab = [
    "Colaborador",
    "Situação",
    "Média autoavaliação",
    "Média coordenador",
    "Média subcoordenação",
    ...CRITERIOS.map((c) => `${c.nome} (coord.)`),
    "1 - Pontos positivos",
    "2 - A melhorar/Sugestões",
    "Recomendações",
    "Réplicas",
    "Finalizada em"
  ];
  put("A1", `Avaliações por desempenho — competência ${rotuloCompetencia(competencia)}`, S.titulo);
  put("A2", `Gerado pelo HUB em ${new Date().toLocaleString("pt-BR")}`, S.info);
  cab.forEach((t, i) => put(`${col(i)}4`, t, S.cabTabela));
  const linhas = itens.filter((a) => a.status !== "rascunho");
  linhas.forEach((a, n) => {
    const r = 5 + n;
    const k = a.coordenacao;
    const vals: Array<string | number | null> = [
      a.colaboradorNome,
      STATUS_COORDENACAO[a.status],
      media(a.colaborador.notas),
      k ? media(k.notas) : null,
      k ? media(k.subcoordenacao) : null,
      ...CRITERIOS.map((c) => (k ? nota(k.notas, c.id) : null)),
      k?.pontosPositivos || "",
      k?.aMelhorar || "",
      (k?.recomendacoes || []).map((t, i) => `${i + 1} - ${t}`).join("\n"),
      textoReplicas(a),
      dataCurta(a.finalizadaEm)
    ];
    vals.forEach((v, i) => put(`${col(i)}${r}`, v, typeof v === "number" || (i >= 2 && i <= 11) ? S.celulaNum : S.celula));
  });
  let r = 6 + linhas.length;
  if (pendentes.length) {
    put(`A${r}`, `Ainda não enviaram (${pendentes.length}): ${pendentes.join(", ")}`, S.info);
    r++;
  }
  return montarXlsx([
    {
      nome: `Resumo ${competencia.slice(5, 7)}-${competencia.slice(0, 4)}`,
      larguras: [26, 20, 12, 12, 12, ...CRITERIOS.map(() => 11), 40, 40, 50, 50, 13],
      alturas: { 1: 24, 4: 45 },
      celulas: cel,
      mescladas: [`A1:${col(cab.length - 1)}1`, `A2:${col(cab.length - 1)}2`]
    }
  ]);
}

// ---------------------------------------------------------------------------------------------
// PDF (jsPDF, carregado só quando usado)

export async function pdfAvaliacao(a: Avaliacao): Promise<Uint8Array> {
  const [{ jsPDF }, { autoTable }] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const k = a.coordenacao;
  const usaSub = !!k && notasPreenchidas(k.subcoordenacao) > 0;
  const azul: [number, number, number] = [27, 42, 65];
  const W = doc.internal.pageSize.getWidth();
  const M = 12;
  let y = 14;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.setTextColor(...azul);
  doc.text(AVALIACAO_TITULO, M, y);
  y += 6;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(60);
  doc.text(`Colaborador: ${a.colaboradorNome}    Competência: ${rotuloCompetencia(a.competencia)}    Situação: ${STATUS_COORDENACAO[a.status]}`, M, y);
  y += 4;

  const head = [["Critério", "Nota colab.", "Justificativa do colaborador", ...(k ? ["Nota coord.", "Justificativa do coordenador"] : []), ...(usaSub ? ["Nota sub.", "Justificativa da subcoordenação"] : [])]];
  const body = CRITERIOS.map((c, i) => [
    `${i + 1}. ${c.nome}\n${c.detalhe}`,
    formatarNota(nota(a.colaborador.notas, c.id)),
    just(a.colaborador.notas, c.id),
    ...(k ? [formatarNota(nota(k.notas, c.id)), just(k.notas, c.id)] : []),
    ...(usaSub && k ? [formatarNota(nota(k.subcoordenacao, c.id)), just(k.subcoordenacao, c.id)] : [])
  ]);
  const mC = media(a.colaborador.notas);
  const mK = k ? media(k.notas) : null;
  const mS = usaSub && k ? media(k.subcoordenacao) : null;
  const foot = [
    ["Total (média)", formatarNota(mC), faixa(mC), ...(k ? [formatarNota(mK), faixa(mK)] : []), ...(usaSub ? [formatarNota(mS), faixa(mS)] : [])]
  ];
  const nCols = head[0].length;
  const colStyles: Record<number, { cellWidth?: number | "auto"; halign?: "center" }> = { 0: { cellWidth: 52 }, 1: { cellWidth: 16, halign: "center" } };
  if (k) colStyles[3] = { cellWidth: 16, halign: "center" };
  if (usaSub) colStyles[5] = { cellWidth: 16, halign: "center" };
  autoTable(doc, {
    startY: y + 2,
    head,
    body,
    foot,
    theme: "grid",
    margin: { left: M, right: M },
    styles: { font: "helvetica", fontSize: 8.5, cellPadding: 1.8, valign: "middle", lineColor: [180, 190, 205], lineWidth: 0.2, overflow: "linebreak" },
    headStyles: { fillColor: [219, 229, 241], textColor: azul, fontStyle: "bold", halign: "center" },
    footStyles: { fillColor: [242, 245, 248], textColor: azul, fontStyle: "bold" },
    columnStyles: colStyles,
    didParseCell: (d) => {
      if (d.section === "body" && (d.column.index === 1 || d.column.index === 2)) d.cell.styles.fillColor = [223, 233, 245];
      if (d.section === "body" && d.column.index === 0) d.cell.styles.fontStyle = "bold";
      if (nCols < 3) d.cell.styles.cellWidth = "auto";
    }
  });
  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;

  const bloco = (titulo: string, linhas: Array<[string, string]>) => {
    autoTable(doc, {
      startY: y,
      head: [[titulo, ""]],
      body: linhas,
      theme: "grid",
      margin: { left: M, right: M },
      styles: { font: "helvetica", fontSize: 9, cellPadding: 2, lineColor: [200, 205, 215], lineWidth: 0.2, overflow: "linebreak", valign: "top" },
      headStyles: { fillColor: [27, 42, 65], textColor: 255, fontStyle: "bold" },
      columnStyles: { 0: { cellWidth: 62, fontStyle: "bold", textColor: azul } },
      didParseCell: (d) => {
        if (d.section === "head" && d.column.index === 0) d.cell.colSpan = 2;
      }
    });
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 5;
  };

  if (k || a.replicas.length) {
    const geral: Array<[string, string]> = [];
    if (k) {
      geral.push(["1 - Pontos positivos", k.pontosPositivos || "—"]);
      geral.push(["2 - A melhorar/Sugestões", k.aMelhorar || "—"]);
    }
    if (a.replicas.length) {
      a.replicas.forEach((r, i) => {
        geral.push([`3 - Réplica ${i + 1} (${dataCurta(r.enviadaEm)})`, r.texto]);
        if (r.resposta) geral.push([`Resposta da coordenação (${dataCurta(r.respondidaEm)})`, r.resposta]);
      });
    } else geral.push(["3 - Dúvidas ou réplica do colaborador", "—"]);
    bloco("Avaliação geral e detalhes (feedback)", geral);
  }
  if (k) bloco("Recomendações da coordenação", k.recomendacoes.length ? k.recomendacoes.map((t, i) => [`${i + 1} -`, t]) : [["—", "Sem recomendações."]]);
  bloco(
    "Sugestões do colaborador",
    a.colaborador.sugestoes.length ? a.colaborador.sugestoes.map((s, i) => [`${i + 1} - ${s.sugestao}`, s.justificativa || "—"]) : [["—", "Sem sugestões."]]
  );
  bloco(`Feedback — ${FEEDBACK_INTRO}`, PERGUNTAS_FEEDBACK.map((q) => [q.pergunta, a.colaborador.feedback[q.id] || "—"]));
  doc.setFontSize(8);
  doc.setTextColor(110);
  if (y > doc.internal.pageSize.getHeight() - 16) {
    doc.addPage();
    y = 14;
  }
  doc.text(`Referência de notas (acima de): ${ESCALA.map((e) => `${formatarNota(e.minimo)} ${e.rotulo}`).join(" · ")}`, M, y);

  const total = doc.getNumberOfPages();
  for (let i = 1; i <= total; i++) {
    doc.setPage(i);
    doc.setFontSize(7.5);
    doc.setTextColor(130);
    doc.text(`H. Teixeira — Depto Tributário · gerado pelo HUB em ${new Date().toLocaleString("pt-BR")} · página ${i} de ${total}`, W - M, doc.internal.pageSize.getHeight() - 6, { align: "right" });
  }
  return new Uint8Array(doc.output("arraybuffer"));
}

// ---------------------------------------------------------------------------------------------
// Baixar e converter

export function baixarXlsx(a: Avaliacao) {
  downloadBlob(new Blob([xlsxAvaliacao(a) as BlobPart], { type: XLSX_MIME }), nomeArquivo(a, "xlsx"));
}
export async function baixarPdf(a: Avaliacao) {
  downloadBlob(new Blob([(await pdfAvaliacao(a)) as BlobPart], { type: "application/pdf" }), nomeArquivo(a, "pdf"));
}
export function baixarConsolidado(competencia: string, itens: Avaliacao[], pendentes: string[]) {
  downloadBlob(
    new Blob([xlsxConsolidado(competencia, itens, pendentes) as BlobPart], { type: XLSX_MIME }),
    `AVALIACOES - consolidado ${competencia.slice(5, 7)}.${competencia.slice(0, 4)}.xlsx`
  );
}
export function paraBase64(bytes: Uint8Array) {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
export const MIME = { xlsx: XLSX_MIME, pdf: "application/pdf" };
