// CNPJ: validação, extração de texto e consulta pública na Receita (BrasilAPI, com reserva na Minha Receita).
// Usado pela função netlify/functions/registros.mjs.

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

export function somenteDigitos(valor) {
  return String(valor ?? "").replace(/\D/g, "");
}

export function cnpjValido(valor) {
  const cnpj = somenteDigitos(valor);
  if (!/^\d{14}$/.test(cnpj) || /^(\d)\1{13}$/.test(cnpj)) return false;
  const digito = (base) => {
    let soma = 0;
    let peso = base.length - 7;
    for (const n of base) {
      soma += Number(n) * peso--;
      if (peso < 2) peso = 9;
    }
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };
  const d1 = digito(cnpj.slice(0, 12));
  const d2 = digito(cnpj.slice(0, 12) + d1);
  return cnpj.endsWith(`${d1}${d2}`);
}

export function extrairCnpjs(texto) {
  const achados = String(texto || "").match(/\d{2}[.\s]?\d{3}[.\s]?\d{3}[/\s]?\d{4}[-\s]?\d{2}/g) || [];
  return [...new Set(achados.map(somenteDigitos).filter(cnpjValido))];
}

export function formatarCnpj(cnpj) {
  const d = somenteDigitos(cnpj);
  return d.length === 14 ? `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}` : d;
}

export function detectarTipo(texto) {
  const t = String(texto || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
  if (/cliente\s+novo|novo\s+cliente|outro\s+escritorio|transferencia\s+de\s+escritorio|vindo\s+de|migrac/.test(t)) return "cliente_novo";
  if (/altera(cao|coes)|alteracao\s+contratual|aditivo|consolidac/.test(t)) return "alteracao";
  if (/abertura|constituic|nova\s+empresa|empresa\s+nova|inscricao\s+inicial/.test(t)) return "abertura";
  return "outro";
}

async function buscarJson(url) {
  const controle = new AbortController();
  const timer = setTimeout(() => controle.abort(), 9000);
  try {
    const resposta = await fetch(url, { headers: { accept: "application/json" }, signal: controle.signal });
    if (resposta.status === 404) throw httpError(404, "CNPJ não encontrado na Receita.");
    if (!resposta.ok) throw httpError(502, `Consulta indisponível (${resposta.status}).`);
    return await resposta.json();
  } finally {
    clearTimeout(timer);
  }
}

export async function consultarReceita(cnpj) {
  const fontes = [
    ["BrasilAPI", `https://brasilapi.com.br/api/cnpj/v1/${cnpj}`],
    ["Minha Receita", `https://minhareceita.org/${cnpj}`]
  ];
  let ultimoErro = null;
  for (const [fonte, url] of fontes) {
    try {
      return normalizarReceita(await buscarJson(url), fonte);
    } catch (error) {
      ultimoErro = error;
      if (error?.statusCode === 404) break;
    }
  }
  throw ultimoErro || httpError(502, "Consulta à Receita indisponível no momento.");
}

export function sugerirRegime(bruto) {
  if (bruto?.opcao_pelo_mei === true) return "MEI";
  if (bruto?.opcao_pelo_simples === true) return "Simples Nacional";
  const historico = Array.isArray(bruto?.regime_tributario) ? bruto.regime_tributario : [];
  const ultimo = historico
    .filter((item) => item && item.ano)
    .sort((a, b) => Number(b.ano) - Number(a.ano))[0];
  const forma = String(ultimo?.forma_de_tributacao || "").toUpperCase();
  if (forma.includes("PRESUMIDO")) return "Lucro Presumido";
  if (forma.includes("REAL")) return "Lucro Real";
  if (forma.includes("ARBITRADO")) return "Lucro Arbitrado";
  if (forma.includes("IMUNE") || forma.includes("ISENT")) return "Imune/Isenta";
  return "";
}

export function normalizarReceita(bruto, fonte = "BrasilAPI") {
  const cnae = (codigo, descricao) => {
    const c = somenteDigitos(codigo);
    if (!c || /^0+$/.test(c)) return null;
    const fmt = c.length === 7 ? `${c.slice(0, 4)}-${c.slice(4, 5)}/${c.slice(5)}` : c;
    return { codigo: fmt, descricao: String(descricao || "").trim() };
  };
  const secundarios = (Array.isArray(bruto?.cnaes_secundarios) ? bruto.cnaes_secundarios : [])
    .map((item) => cnae(item?.codigo, item?.descricao))
    .filter(Boolean);
  const socios = (Array.isArray(bruto?.qsa) ? bruto.qsa : []).map((item) => ({
    nome: String(item?.nome_socio || item?.nome || "").trim(),
    qualificacao: String(item?.qualificacao_socio || item?.qualificacao || "").trim(),
    desde: String(item?.data_entrada_sociedade || "").slice(0, 10)
  })).filter((item) => item.nome);
  const dataInicio = String(bruto?.data_inicio_atividade || "").slice(0, 10);
  return {
    fonte,
    cnpj: somenteDigitos(bruto?.cnpj),
    razaoSocial: String(bruto?.razao_social || "").trim(),
    nomeFantasia: String(bruto?.nome_fantasia || "").trim(),
    dataInicio: /^\d{4}-\d{2}-\d{2}$/.test(dataInicio) ? dataInicio : "",
    situacao: String(bruto?.descricao_situacao_cadastral || "").trim(),
    naturezaJuridica: String(bruto?.natureza_juridica || "").trim(),
    municipio: String(bruto?.municipio || "").trim(),
    uf: String(bruto?.uf || "").trim(),
    cnaePrincipal: cnae(bruto?.cnae_fiscal, bruto?.cnae_fiscal_descricao),
    cnaesSecundarios: secundarios,
    socios,
    regimeSugerido: sugerirRegime(bruto),
    simples: bruto?.opcao_pelo_simples ?? null,
    mei: bruto?.opcao_pelo_mei ?? null,
    consultadoEm: new Date().toISOString()
  };
}
