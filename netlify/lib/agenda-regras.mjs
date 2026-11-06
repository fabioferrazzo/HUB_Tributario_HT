// Regras de vencimento estaduais (SEFAZ-RS) e municipais (ISS) da Agenda Tributaria.
//
// A Receita Federal publica a agenda federal mes a mes (lida em rfb-agenda.mjs).
// A SEFAZ-RS nao publica agenda estruturada: os prazos regulares vem do RICMS/RS e
// de instrucoes normativas, e as prorrogacoes extraordinarias saem em avisos avulsos
// (receita.fazenda.rs.gov.br/avisos), que bloqueiam leitura automatizada.
// Por isso os prazos estaduais sao calculados aqui a partir das normas, com o
// fundamento legal em cada item. Revise esta tabela quando a legislacao mudar.

export const MONTH_LABELS = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"
];

const SEFAZ_AVISOS = "Prorrogações extraordinárias são divulgadas nos avisos da Receita Estadual (receita.fazenda.rs.gov.br/avisos).";

// ref = quantos meses antes do vencimento esta o periodo de apuracao/referencia.
// adjust = a norma manda passar para o primeiro dia util seguinte quando nao houver expediente.
export const RS_RULES = [
  {
    day: 9,
    ref: 1,
    adjust: false,
    title: "ICMS-ST – Substituição tributária (regra geral)",
    doc: "Guia de Arrecadação (GA)",
    base: "RICMS/RS, Apêndice III, Seção II, item I",
    desc: "Regra geral para as hipóteses de substituição tributária não especificadas nos demais itens da Seção II; há prazos próprios por produto e segmento."
  },
  {
    day: 9,
    ref: 1,
    adjust: false,
    title: "ICMS DIFAL – Remetente de outra UF para consumidor final não contribuinte no RS",
    doc: "GA / GNRE",
    base: "RICMS/RS, Apêndice III, Seção I, item XV",
    desc: "Diferencial de alíquota em operações de remetente de outra unidade da Federação com consumidor final não contribuinte localizado no RS."
  },
  {
    day: 12,
    ref: 1,
    adjust: false,
    title: "ICMS – Débito próprio (estabelecimentos comerciais)",
    doc: "Guia de Arrecadação (GA)",
    base: "RICMS/RS, Apêndice III, Seção I, item I",
    desc: "Regra geral para saídas de estabelecimentos comerciais; indústria e outras atividades têm prazos próprios no Apêndice III. O DIFAL do contribuinte da categoria Geral segue o prazo do ICMS próprio (RICMS/RS, Livro I, art. 16, I, “f”)."
  },
  {
    day: 15,
    ref: 1,
    adjust: true,
    title: "GIA – Guia de Informação e Apuração do ICMS (categoria Geral)",
    doc: "Internet (TED / SEFAZ-RS)",
    base: "IN DRP nº 45/98, com redação da IN RE nº 064/18",
    desc: "Entrega até o dia 15; se não houver expediente normal na SEFAZ, o prazo passa para o primeiro dia útil seguinte."
  },
  {
    day: 15,
    ref: 1,
    adjust: true,
    title: "EFD ICMS/IPI – Escrituração Fiscal Digital",
    doc: "SPED",
    base: "IN RE nº 064/18 (prazo alinhado ao da GIA)",
    desc: "Prazo alinhado ao da GIA; se não houver expediente normal na SEFAZ, passa para o primeiro dia útil seguinte."
  },
  {
    day: 23,
    ref: 2,
    adjust: false,
    title: "ICMS Simples Nacional – ST, antecipação e DIFAL (destinatário no RS)",
    doc: "Guia de Arrecadação (GA)",
    base: "LC nº 123/06, art. 13, § 1º, XIII, “g”",
    desc: "Pagamento até o dia 23 do segundo mês subsequente ao das entradas."
  },
  {
    day: 28,
    ref: 1,
    adjust: false,
    title: "DeSTDA – Declaração de ST, DIFAL e Antecipação (Simples Nacional)",
    doc: "Aplicativo SEDIF-SN",
    base: "Ajuste SINIEF nº 12/15",
    desc: "Entrega até o dia 28 do mês subsequente; não se aplica ao MEI."
  }
];

export const ISS_RULE = {
  day: 20,
  ref: 1,
  title: "ISS – São Francisco de Paula (prazo fixo)",
  doc: "Guia municipal",
  base: "Legislação municipal de São Francisco de Paula",
  desc: "Prazo fixo no dia 20, configurado no HUB. Para confirmar alterações (dia não útil, prorrogações ou mudanças na legislação), consulte a Prefeitura de São Francisco de Paula."
};

// ---------------------------------------------------------------- feriados

function easterSunday(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

const iso = (date) => date.toISOString().slice(0, 10);
const addDays = (date, days) => new Date(date.getTime() + days * 86400000);

// Feriados nacionais, data magna do RS (20/09) e dias sem expediente na SEFAZ-RS
// (Carnaval, Sexta-feira Santa e Corpus Christi).
export function nonBusinessDays(year) {
  const easter = easterSunday(year);
  const fixed = {
    "01-01": "Confraternização Universal",
    "04-21": "Tiradentes",
    "05-01": "Dia do Trabalho",
    "09-07": "Independência do Brasil",
    "09-20": "Revolução Farroupilha (RS)",
    "10-12": "Nossa Senhora Aparecida",
    "11-02": "Finados",
    "11-15": "Proclamação da República",
    "11-20": "Dia Nacional de Zumbi e da Consciência Negra",
    "12-25": "Natal"
  };
  const days = new Map(Object.entries(fixed).map(([md, name]) => [`${year}-${md}`, name]));
  days.set(iso(addDays(easter, -48)), "Carnaval");
  days.set(iso(addDays(easter, -47)), "Carnaval");
  days.set(iso(addDays(easter, -2)), "Sexta-feira Santa");
  days.set(iso(addDays(easter, 60)), "Corpus Christi");
  return days;
}

function describeNonBusiness(date) {
  const holiday = nonBusinessDays(date.getUTCFullYear()).get(iso(date));
  if (holiday) return holiday;
  const weekday = date.getUTCDay();
  if (weekday === 0) return "domingo";
  if (weekday === 6) return "sábado";
  return "";
}

function nextBusinessDay(date) {
  let current = date;
  while (describeNonBusiness(current)) current = addDays(current, 1);
  return current;
}

// ---------------------------------------------------------------- montagem

const escapeHtml = (value) =>
  String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function referenceLabel(year, month, monthsBack) {
  const date = new Date(Date.UTC(year, month - 1 - monthsBack, 1));
  return `${MONTH_LABELS[date.getUTCMonth()]}/${date.getUTCFullYear()}`;
}

function lastDayOfMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function pushItem(dates, day, item) {
  const key = String(day);
  if (!dates[key]) dates[key] = [];
  dates[key].push(item);
}

export function buildRegionalDates(year, month) {
  const dates = {};

  for (const rule of RS_RULES) {
    const legal = new Date(Date.UTC(year, month - 1, Math.min(rule.day, lastDayOfMonth(year, month))));
    const reason = describeNonBusiness(legal);
    let due = legal;
    let note = "";
    if (reason && rule.adjust) {
      due = nextBusinessDay(legal);
      note = ` Neste mês, o dia ${rule.day} cai em ${reason}; o prazo passa para o primeiro dia útil seguinte, ${String(due.getUTCDate()).padStart(2, "0")}/${String(month).padStart(2, "0")}.`;
    } else if (reason) {
      note = ` Atenção: o dia ${rule.day} cai em ${reason}; confirme no RICMS/RS se o pagamento é prorrogado ou antecipado.`;
    }
    if (due.getUTCMonth() !== month - 1) continue;
    pushItem(dates, due.getUTCDate(), {
      cat: "estadual",
      title: escapeHtml(rule.title),
      periodo: referenceLabel(year, month, rule.ref),
      doc: escapeHtml(rule.doc),
      base: escapeHtml(rule.base),
      desc: escapeHtml(`${rule.desc}${note} ${SEFAZ_AVISOS}`)
    });
  }

  pushItem(dates, Math.min(ISS_RULE.day, lastDayOfMonth(year, month)), {
    cat: "municipal",
    title: escapeHtml(ISS_RULE.title),
    periodo: referenceLabel(year, month, ISS_RULE.ref),
    doc: escapeHtml(ISS_RULE.doc),
    base: escapeHtml(ISS_RULE.base),
    desc: escapeHtml(ISS_RULE.desc)
  });

  return dates;
}

export function mergeDates(...sources) {
  const merged = {};
  for (const source of sources) {
    for (const [day, items] of Object.entries(source || {})) {
      if (!Array.isArray(items)) continue;
      merged[day] = [...(merged[day] || []), ...items];
    }
  }
  return Object.fromEntries(Object.entries(merged).sort(([a], [b]) => Number(a) - Number(b)));
}

export function buildCritical(dates) {
  const entries = Object.entries(dates || {}).sort((a, b) => b[1].length - a[1].length);
  if (!entries.length) return null;
  const [day, items] = entries[0];
  if (items.length < 3) return null;
  return {
    day: Number(day),
    text: `O dia <strong>${String(day).padStart(2, "0")}</strong> concentra ${items.length} obrigações e vencimentos (federais, estaduais e municipais).`
  };
}

// Junta a agenda federal (RFB) com as regras estaduais e municipais.
export function combineAgenda(federal, year, month) {
  const federalDates = federal?.warning ? {} : federal?.dates || {};
  const dates = mergeDates(federalDates, buildRegionalDates(year, month));
  return {
    year,
    month,
    source: federal?.warning || !federal ? "SEFAZ-RS (RICMS/RS) · ISS municipal" : "Receita Federal · SEFAZ-RS (RICMS/RS) · ISS municipal",
    sourceUrl: federal?.sourceUrl || "",
    updated: new Date().toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }),
    critical: buildCritical(dates),
    dates,
    ...(federal?.warning ? { warning: federal.warning } : {})
  };
}

// ---------------------------------------------------------------- mudancas

const plain = (value) =>
  String(value || "").replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&amp;/g, "&");

function indexItems(dates) {
  const index = new Map();
  for (const [day, items] of Object.entries(dates || {})) {
    for (const item of items || []) {
      const key = `${item.cat}|${plain(item.title)}|${plain(item.periodo)}`;
      if (!index.has(key)) index.set(key, { day: Number(day), title: plain(item.title) });
    }
  }
  return index;
}

// Compara duas versoes da agenda de um mes e descreve o que mudou.
export function describeAgendaChanges(previousDates, nextDates) {
  const before = indexItems(previousDates);
  const after = indexItems(nextDates);
  const moved = [];
  const added = [];
  const removed = [];

  for (const [key, item] of after) {
    const old = before.get(key);
    if (!old) added.push(item);
    else if (old.day !== item.day) moved.push({ ...item, from: old.day });
  }
  for (const [key, item] of before) if (!after.has(key)) removed.push(item);

  const lines = [
    ...moved.map((item) => `${item.title}: do dia ${item.from} para o dia ${item.day}`),
    ...added.map((item) => `Novo no dia ${item.day}: ${item.title}`),
    ...removed.map((item) => `Removido do dia ${item.day}: ${item.title}`)
  ];

  return { changed: lines.length > 0, moved: moved.length, added: added.length, removed: removed.length, lines };
}
