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
  const timer = setTimeout(() => controle.abort(), 7000);
  try {
    const resposta = await fetch(url, { headers: { accept: "application/json" }, signal: controle.signal });
    if (resposta.status === 404) throw httpError(404, "CNPJ não encontrado na Receita.");
    if (!resposta.ok) throw httpError(502, `Consulta indisponível (${resposta.status}).`);
    return await resposta.json();
  } catch (error) {
    if (error?.name === "AbortError") throw httpError(504, "Consulta demorou demais.");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

// Três bases públicas consultadas ao mesmo tempo; vale a primeira que responder (na ordem de preferência,
// se mais de uma responder). Assim uma base fora do ar não trava o HUB.
const FONTES_RECEITA = [
  ["BrasilAPI", (cnpj) => `https://brasilapi.com.br/api/cnpj/v1/${cnpj}`, (bruto) => normalizarReceita(bruto, "BrasilAPI")],
  ["Minha Receita", (cnpj) => `https://minhareceita.org/${cnpj}`, (bruto) => normalizarReceita(bruto, "Minha Receita")],
  ["CNPJá", (cnpj) => `https://open.cnpja.com/office/${cnpj}`, (bruto) => normalizarCnpja(bruto)]
];

export async function consultarReceita(cnpj, fontes = FONTES_RECEITA) {
  const tentativas = fontes.map(([, url, normalizar]) => buscarJson(url(cnpj)).then(normalizar));
  const resultados = await Promise.allSettled(tentativas);
  const alvo = somenteDigitos(cnpj);
  // Resposta de outro CNPJ (base com problema) é descartada.
  const validos = resultados.filter((r) => r.status === "fulfilled" && r.value?.cnpj === alvo).map((r) => r.value);
  if (validos.length) return completarDados(validos[0], validos.slice(1));
  const erros = resultados.map((r) => r.reason).filter(Boolean);
  if (erros.length && erros.every((e) => e?.statusCode === 404)) throw httpError(404, "CNPJ não encontrado nas bases públicas da Receita.");
  if (erros.some((e) => e?.statusCode === 404)) {
    throw httpError(404, "CNPJ ainda não consta em todas as bases públicas (pode ser empresa recém-aberta); as demais estão fora do ar.");
  }
  throw httpError(503, "As bases públicas da Receita (BrasilAPI, Minha Receita e CNPJá) estão fora do ar agora. Tente de novo em alguns minutos.");
}

const vazio = (v) => v === null || v === undefined || v === "" || (Array.isArray(v) && !v.length);

/**
 * A base principal (a primeira que respondeu, na ordem de preferência) pode vir sem e-mail, telefone, capital social
 * etc.; os campos vazios são completados com as outras bases que também responderam. Nada preenchido é trocado.
 */
export function completarDados(principal, outras = []) {
  const dados = { ...principal };
  const usadas = [];
  for (const outra of outras) {
    let usou = false;
    for (const campo of ["email", "capitalSocial", "porte", "nomeFantasia", "naturezaJuridica", "dataInicio", "socios", "cnaePrincipal", "cnaesSecundarios", "regimeSugerido"]) {
      if (vazio(dados[campo]) && !vazio(outra[campo])) {
        dados[campo] = outra[campo];
        usou = true;
      }
    }
    const telefones = [dados.telefone1, dados.telefone2, outra.telefone1, outra.telefone2].filter(Boolean).filter((t, i, l) => l.indexOf(t) === i);
    if (telefones[0] !== dados.telefone1 || (telefones[1] || "") !== (dados.telefone2 || "")) {
      [dados.telefone1 = "", dados.telefone2 = ""] = telefones;
      usou = true;
    }
    if (usou) usadas.push(outra.fonte);
  }
  if (usadas.length) dados.fontesComplementares = usadas;
  return dados;
}

function numeroOuNulo(valor) {
  const n = typeof valor === "number" ? valor : Number(String(valor ?? "").replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** CNPJá (open.cnpja.com): formato próprio, convertido para o mesmo formato das demais bases. */
export function normalizarCnpja(bruto) {
  const cnae = (codigo, descricao) => {
    const c = somenteDigitos(codigo);
    if (!c || /^0+$/.test(c)) return null;
    const fmt = c.length === 7 ? `${c.slice(0, 4)}-${c.slice(4, 5)}/${c.slice(5)}` : c;
    return { codigo: fmt, descricao: String(descricao || "").trim() };
  };
  const empresa = bruto?.company || {};
  const telefones = (Array.isArray(bruto?.phones) ? bruto.phones : []).map((t) => formatarTelefone(`${t?.area || ""}${t?.number || ""}`)).filter(Boolean);
  const dataInicio = String(bruto?.founded || "").slice(0, 10);
  const mei = empresa?.simei?.optant ?? null;
  const simples = empresa?.simples?.optant ?? null;
  return {
    fonte: "CNPJá",
    cnpj: somenteDigitos(bruto?.taxId),
    razaoSocial: String(empresa?.name || "").trim(),
    nomeFantasia: String(bruto?.alias || "").trim(),
    dataInicio: /^\d{4}-\d{2}-\d{2}$/.test(dataInicio) ? dataInicio : "",
    situacao: String(bruto?.status?.text || "").trim().toUpperCase(),
    naturezaJuridica: String(empresa?.nature?.text || "").trim(),
    municipio: String(bruto?.address?.city || "").trim().toUpperCase(),
    uf: String(bruto?.address?.state || "").trim(),
    cnaePrincipal: cnae(bruto?.mainActivity?.id, bruto?.mainActivity?.text),
    cnaesSecundarios: (Array.isArray(bruto?.sideActivities) ? bruto.sideActivities : []).map((a) => cnae(a?.id, a?.text)).filter(Boolean),
    socios: (Array.isArray(empresa?.members) ? empresa.members : [])
      .map((m) => ({ nome: String(m?.person?.name || "").trim(), qualificacao: String(m?.role?.text || "").trim(), desde: String(m?.since || "").slice(0, 10) }))
      .filter((m) => m.nome),
    regimeSugerido: mei === true ? "MEI" : simples === true ? "Simples Nacional" : "",
    telefone1: telefones[0] || "",
    telefone2: telefones[1] || "",
    email: String(bruto?.emails?.[0]?.address || "").trim().toLowerCase(),
    capitalSocial: numeroOuNulo(empresa?.equity),
    porte: String(empresa?.size?.text || "").trim(),
    simples,
    mei,
    consultadoEm: new Date().toISOString()
  };
}

/** Compara razões sociais sem diferenciar maiúsculas, acentos, pontuação e espaços. */
export function mesmaRazaoSocial(a, b) {
  const n = (v) =>
    String(v || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, " ")
      .replace(/\b(LIMITADA)\b/g, "LTDA")
      .trim();
  return n(a) === n(b);
}

// ---------------------------------------------------------------------------------------------
// Campos informados no texto do e-mail ("Código Domínio: 1234", "IE 123/456, Regime: Simples Nacional"...)

const ROTULOS_CAMPOS = [
  ["razaoSocial", /^raz[aã]o\s+social\b/i],
  ["nomeFantasia", /^(?:nome\s+)?fantasia\b/i],
  ["codigoDominio", /^(?:(?:n[uú]mero|n[ºo°]\.?|c[oó]d(?:igo|\.)?)\s*)?(?:(?:n[oa]|d[oa]|de)\s+)?dom[ií]nio\b/i],
  ["ie", /^(?:i\.?\s?e\.?|insc(?:ri[cç][aã]o|\.)?\s*estadual)(?=[\s:\-–=]|$)/i],
  ["emails", /^e-?mails?\b/i],
  ["telefones", /^(?:telefones?|tel\.?|fones?|celular(?:es)?|whats(?:app)?)(?=[\s:\-–=]|$)/i],
  ["regime", /^(?:regime(?:\s+(?:tribut[aá]rio|de\s+tributa[cç][aã]o))?|tributa[cç][aã]o)\b/i],
  ["dataInicio", /^(?:data\s+(?:de\s+|do\s+)?(?:in[ií]cio|abertura)(?:\s+(?:das\s+)?atividades)?|in[ií]cio\s+(?:das\s+)?atividades)\b/i]
];

export function normalizarRegime(valor) {
  const v = String(valor || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  if (!v.trim()) return "";
  if (/\bmei\b|microempreendedor/.test(v)) return "MEI";
  if (/simples/.test(v)) return "Simples Nacional";
  if (/presumido/.test(v)) return "Lucro Presumido";
  if (/arbitrado/.test(v)) return "Lucro Arbitrado";
  if (/\breal\b/.test(v)) return "Lucro Real";
  if (/imune|isent/.test(v)) return "Imune/Isenta";
  return String(valor).trim().slice(0, 60);
}

function dataIso(valor) {
  const t = String(valor || "");
  let m = t.match(/(\d{2})[/.-](\d{2})[/.-](\d{4})/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  m = t.match(/(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : "";
}

/** Lê do texto os campos que o Societário costuma informar. Só valores com rótulo (evita pegar a assinatura). */
export function extrairCamposDoEmail(corpo) {
  const campos = { razaoSocial: "", nomeFantasia: "", codigoDominio: "", ie: "", emails: [], telefones: [], regime: "", dataInicio: "" };
  const linhas = String(corpo || "")
    .replace(/\r/g, "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 80);
  for (const linha of linhas) {
    // Vários campos na mesma linha: "IE 123/456, Domínio 1234; Regime: Simples" (vírgula seguida de letra separa).
    for (const trecho of linha.split(/\s*[;|]\s*|,\s*(?=[A-Za-zÀ-ÿ])/)) {
      const t = trecho.replace(/^[-•*·>\s]+/, "").trim();
      for (const [campo, rotulo] of ROTULOS_CAMPOS) {
        const m = t.match(rotulo);
        if (!m) continue;
        const valor = t
          .slice(m[0].length)
          .replace(/^\s*(?:[:\-–=]|n[ºo°]\.?)?\s*/i, "")
          .replace(/[\s.;,]+$/, "")
          .trim();
        if (!valor) break;
        if (campo === "emails") {
          for (const e of valor.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g) || []) {
            const email = e.toLowerCase();
            if (!campos.emails.includes(email)) campos.emails.push(email);
          }
        } else if (campo === "telefones") {
          for (const f of valor.match(/\(?\d{2}\)?[\s.-]*9?\d{4}[\s.-]?\d{4}/g) || []) {
            const tel = formatarTelefone(f);
            if (tel && !campos.telefones.includes(tel)) campos.telefones.push(tel);
          }
        } else if (campo === "regime") {
          campos.regime ||= normalizarRegime(valor);
        } else if (campo === "dataInicio") {
          campos.dataInicio ||= dataIso(valor);
        } else if (campo === "ie") {
          campos.ie ||= /isent/i.test(valor) ? "ISENTO" : valor.slice(0, 30);
        } else if (!campos[campo]) {
          campos[campo] = valor.slice(0, campo === "codigoDominio" ? 40 : 200);
        }
        break;
      }
    }
  }
  return campos;
}

/** Resumo legível do que foi lido do e-mail (vai para o histórico do registro). */
export function resumoCamposDoEmail(c) {
  return [
    c.codigoDominio && `Código no Domínio ${c.codigoDominio}`,
    c.ie && `IE ${c.ie}`,
    c.regime && `Regime ${c.regime}`,
    c.dataInicio && `Início ${c.dataInicio.split("-").reverse().join("/")}`,
    c.nomeFantasia && `Nome fantasia ${c.nomeFantasia}`,
    c.emails.length && `E-mail ${c.emails.join(", ")}`,
    c.telefones.length && `Telefone ${c.telefones.join(", ")}`
  ]
    .filter(Boolean)
    .join(" · ");
}

// Sem "i": "ME" em maiúsculas é sufixo de empresa; "me" minúsculo é pronome.
const SUFIXO_EMPRESA = /\b(LTDA|Ltda|LIMITADA|Limitada|EIRELI|EPP|ME|MEI|SLU|S\/?A|S\.A\.?)(?![A-Za-z])\.?/;

/**
 * Razão social citada no e-mail: primeiro o assunto (sem "ABERTURA", "CLIENTE NOVO", CNPJ etc.); se o assunto não
 * tiver nome, o trecho do texto antes do CNPJ (ex.: "KETERSON ... LTDA, CNPJ 62865660000192, ...") ou a linha com
 * "LTDA", "ME", "EIRELI"...
 */
export function extrairRazaoSocial(assunto, corpo) {
  const limpar = (v) =>
    String(v || "")
      .replace(/^(\s*(enc|fwd?|res|re)\s*:\s*)+/i, "")
      .replace(/\b(raz[aã]o social|empresa|cliente)\s*:\s*/gi, "")
      .replace(/\b(abertura|altera[cç](?:[aã]o|[oõ]es)( contratual)?|cliente novo|novo cliente)\b\s*[-:–]?\s*/gi, "")
      .replace(/\bCNPJ\b\s*(n[ºo°.]*)?\s*:?/gi, "")
      .replace(/\d{2}[.\s]?\d{3}[.\s]?\d{3}[/\s]?\d{4}[-\s]?\d{2}|\b\d{14}\b/g, "")
      .replace(/^[\s\-–:,;.]+|[\s\-–:,;]+$/g, "")
      .replace(/\s{2,}/g, " ")
      .trim();
  const temNome = (v) => (v.match(/[A-Za-zÀ-ÿ]/g) || []).length >= 4;

  // "Razão social: ..." escrito no texto tem prioridade.
  const rotulada = extrairCamposDoEmail(corpo).razaoSocial;
  if (temNome(limpar(rotulada))) return limpar(rotulada).slice(0, 200);

  const doAssunto = limpar(assunto);
  if (temNome(doAssunto)) return doAssunto.slice(0, 200);

  const linhas = String(corpo || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 40);
  for (const linha of linhas) {
    const posCnpj = linha.search(/\bCNPJ\b|\d{2}[.\s]?\d{3}[.\s]?\d{3}[/\s]?\d{4}[-\s]?\d{2}|\b\d{14}\b/i);
    if (posCnpj > 0) {
      const antes = limpar(linha.slice(0, posCnpj).split(/[,;(]/).filter((p) => temNome(p)).pop() || "");
      if (temNome(antes)) return antes.slice(0, 200);
    }
  }
  for (const linha of linhas) {
    const m = linha.match(SUFIXO_EMPRESA);
    if (m && m.index > 0) {
      const nome = limpar(linha.slice(0, m.index + m[0].length).split(/[,;:]/).pop());
      if (temNome(nome)) return nome.slice(0, 200);
    }
  }
  return "";
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

export function formatarTelefone(valor) {
  const d = somenteDigitos(valor).replace(/^0+/, "");
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  return d;
}

// Categorias de alteração identificadas no assunto/texto do e-mail.
export const CATEGORIAS_ALTERACAO = {
  contrato_social: "Contrato social",
  quadro_societario: "Quadro societário",
  cnae: "Atividades (CNAE)",
  endereco: "Endereço",
  capital_social: "Capital social",
  razao_social: "Razão social / nome",
  natureza_juridica: "Natureza jurídica",
  regime: "Regime tributário",
  outra: "Outra"
};

export function detectarCategorias(texto) {
  const t = String(texto || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  const achadas = [];
  const regra = (chave, re) => re.test(t) && achadas.push(chave);
  regra("quadro_societario", /quadro societario|\bqsa\b|entrada de socio|saida de socio|retirada de socio|admissao de socio|cessao de quotas|transferencia de quotas|socio/);
  regra("cnae", /\bcnae|atividade|objeto social/);
  regra("endereco", /endereco|mudanca de sede|transferencia de sede|\bsede\b|filial/);
  regra("capital_social", /capital social|aumento de capital|reducao de capital/);
  regra("razao_social", /razao social|nome empresarial|nome fantasia/);
  regra("natureza_juridica", /natureza juridica|transformacao|\bslu\b|\beireli\b|\bltda\b para/);
  regra("regime", /regime tributario|enquadramento|desenquadramento|exclusao do simples|opcao pelo simples/);
  regra("contrato_social", /contrato social|alteracao contratual|aditivo|consolidacao/);
  return achadas.length ? achadas : ["outra"];
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
    telefone1: formatarTelefone(bruto?.ddd_telefone_1),
    telefone2: formatarTelefone(bruto?.ddd_telefone_2),
    email: String(bruto?.email || "").trim().toLowerCase(),
    capitalSocial: numeroOuNulo(bruto?.capital_social),
    porte: String(bruto?.descricao_porte || bruto?.porte || "").trim(),
    simples: bruto?.opcao_pelo_simples ?? null,
    mei: bruto?.opcao_pelo_mei ?? null,
    consultadoEm: new Date().toISOString()
  };
}
