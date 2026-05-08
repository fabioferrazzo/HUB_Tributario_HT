const DEFAULT_SHEET_ID = "1rpAcGBQCmm5KlMX1TMBN-qBL1vaNgy6gn3j_ffjkVsg";
const DEFAULT_GID = "1705398292";

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"' && quoted && next === '"') {
      cell += '"';
      i += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(cell.trim());
      cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") i += 1;
      row.push(cell.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }

  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function normalizeKey(value) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

function mapRows(rows) {
  const [headers = [], ...records] = rows;
  const keys = headers.map(normalizeKey);
  return records.map((record, index) => {
    const item = { id: `sheet-${index + 1}` };
    keys.forEach((key, keyIndex) => {
      item[key || `coluna_${keyIndex + 1}`] = record[keyIndex] || "";
    });
    return {
      id: item.id,
      tema: item.tema || item.pauta || item.assunto || item.titulo || "Pauta sem titulo",
      acoes: item.acoes || item.acao || "",
      prazo: item.prazo || item.data || item.vencimento || "",
      prioridade: item.prioridade || item.status || "Normal",
      responsavel: item.responsavel || item.usuario || item.colaborador || "",
      email: item.email || item.e_mail || "",
      pendenciasObs: item.pendencias_obs || item.pendencias || item.obs || item.observacoes || "",
      retorno: item.retorno || "",
      status: item.status || "Sem status",
      periodicidade: item.periodicidade || "",
      modificadoEm: item.modificado_em || item.modificado || "",
      concluidoEm: item.concluido_em || item.concluido || "",
      origem: "Sheets HUB Tributario",
      raw: item
    };
  });
}

export async function handler(event) {
  const sheetId = event.queryStringParameters?.sheetId || process.env.GOOGLE_SHEETS_ID || DEFAULT_SHEET_ID;
  const gid = event.queryStringParameters?.gid || process.env.GOOGLE_SHEETS_HUB_GID || DEFAULT_GID;
  const url = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      return {
        statusCode: response.status,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ error: "Nao foi possivel ler a planilha compartilhada." })
      };
    }

    const csv = await response.text();
    const rows = parseCsv(csv);
    return {
      statusCode: 200,
      headers: { "content-type": "application/json", "cache-control": "public, max-age=300" },
      body: JSON.stringify({ rows: mapRows(rows), source: { sheetId, gid } })
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ error: error?.message || "Erro inesperado ao sincronizar pautas." })
    };
  }
}
