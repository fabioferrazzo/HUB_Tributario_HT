/*
 * CBS e IBS nas operações com bens imóveis — H. Teixeira.
 * Regras da LC 214/2025, com a redação da LC 227/2026 (conferidas em 13/11/2026):
 *  - regime específico: arts. 251 a 270 (redutor de ajuste, arts. 257/258; redutor social, arts. 259/260;
 *    redução de 50% e de 70% na locação, art. 261; incorporação e loteamento, art. 262);
 *  - transição: CBS de 0,9% em 2026 (art. 346); CBS reduzida em 0,1 p.p. em 2027 e 2028 (art. 347);
 *    regimes opcionais das operações iniciadas antes de 2029 (arts. 485 a 487).
 * Regulamentos: Decreto 12.955/2026 (CBS), arts. 359 a 390 e 461 a 463, e Resolução CGIBS 6/2026 (IBS), com as mesmas regras.
 * As alíquotas de referência de CBS e IBS ainda serão fixadas pelo Senado: o simulador usa estimativas editáveis.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.ImobHT = factory();
})(this, function () {
  "use strict";

  function arred(v) { return Math.round((v + (v >= 0 ? 1e-9 : -1e-9)) * 100) / 100; }
  function num(v) { v = Number(v); return Number.isFinite(v) && v > 0 ? v : 0; }

  var REDUCAO = { venda: 50, locacao: 70 };              // art. 261
  var REDUTOR_SOCIAL = { residencialNovo: 100000, lote: 30000, locacaoMes: 600 }; // arts. 259 e 260 (valores de jan/2025, corrigidos pelo IPCA)
  var LIMITE_PF_LOCACAO = 240000;                         // art. 251, § 1º, I, a (corrigido pelo IPCA)
  var ANOS = [2026, 2027, 2028, 2029, 2030, 2031, 2032, 2033];
  // Parcela do IBS cheio cobrada no ano (estimativa: acompanha a redução de ICMS e ISS, EC 132/2023).
  var FRACAO_IBS = { 2029: 0.1, 2030: 0.2, 2031: 0.3, 2032: 0.4, 2033: 1 };

  // Alíquotas nominais (antes das reduções do regime) de CBS e IBS no ano.
  function aliquotasAno(ano, ref) {
    var cbs = num(ref.cbs), ibs = num(ref.ibs);
    if (ano <= 2026) return { cbs: 0.9, ibs: 0.1, teste: true, nota: "2026 é ano de teste: CBS 0,9% e IBS 0,1% destacados na nota e compensados com PIS/Cofins; quem cumpre as obrigações acessórias fica dispensado do pagamento (LC 214/2025, arts. 343 a 348)." };
    if (ano <= 2028) return { cbs: Math.max(0, cbs - 0.1), ibs: 0.1, nota: "2027 e 2028: CBS integral menos 0,1 ponto (art. 347) e IBS de 0,1%. PIS e Cofins deixam de existir." };
    if (ano <= 2032) return { cbs: cbs, ibs: ibs * FRACAO_IBS[ano], nota: "2029 a 2032: IBS sobe aos poucos enquanto ICMS e ISS caem (estimativa: " + Math.round(FRACAO_IBS[ano] * 100) + "% do IBS cheio)." };
    return { cbs: cbs, ibs: ibs, nota: "A partir de 2033: CBS e IBS integrais." };
  }

  function efetivas(ano, ref, reducaoPct) {
    var a = aliquotasAno(ano, ref), f = 1 - reducaoPct / 100;
    return { cbs: a.cbs * f, ibs: a.ibs * f, nominalCbs: a.cbs, nominalIbs: a.ibs, teste: !!a.teste, nota: a.nota };
  }

  // ---------- Venda (alienação) ----------
  // o = { valor, redutorAjuste, tipo: "residencialNovo" | "lote" | "outro", redutorSocial (opcional, valor corrigido), creditos, ano, ref }
  function venda(o) {
    var valor = num(o.valor), ra = Math.min(valor, num(o.redutorAjuste));
    var base1 = valor - ra;
    var rsPadrao = o.tipo === "residencialNovo" ? REDUTOR_SOCIAL.residencialNovo : o.tipo === "lote" ? REDUTOR_SOCIAL.lote : 0;
    var rsInf = Number(o.redutorSocial);
    var rs = o.tipo === "outro" ? 0 : Math.min(base1, Number.isFinite(rsInf) && rsInf > 0 ? rsInf : rsPadrao);
    var base = arred(base1 - rs);
    var e = efetivas(Number(o.ano), o.ref || {}, REDUCAO.venda);
    var cbs = arred(base * e.cbs / 100), ibs = arred(base * e.ibs / 100), creditos = num(o.creditos);
    var debito = arred(cbs + ibs), apagar = arred(debito - creditos);
    return { valor: valor, redutorAjuste: ra, redutorSocial: rs, base: base, aliquotas: e, cbs: cbs, ibs: ibs, debito: debito, creditos: creditos,
      apagar: apagar, carga: valor > 0 ? Math.max(0, apagar) / valor * 100 : 0 };
  }

  // ---------- Locação ----------
  // o = { aluguel, exclusoes (IPTU, condomínio, foro), residencial, imoveis, pctResidencial (área residencial, %), redutorMes (opcional), creditos, ano, ref, regimeTransicao: bool }
  function locacao(o) {
    var aluguel = num(o.aluguel), excl = Math.min(aluguel, num(o.exclusoes));
    var base1 = aluguel - excl, imoveis = Math.max(1, Math.floor(num(o.imoveis) || 1));
    var e = efetivas(Number(o.ano), o.ref || {}, REDUCAO.locacao);
    if (o.regimeTransicao) {
      var v = arred(base1 * 0.0365);
      return { aluguel: aluguel, exclusoes: excl, redutorSocial: 0, base: arred(base1), aliquotas: e, transicao: true, cbs: null, ibs: null,
        debito: v, creditos: 0, apagar: v, carga: aluguel > 0 ? v / aluguel * 100 : 0 };
    }
    var rsInf = Number(o.redutorMes);
    var rsUnit = Number.isFinite(rsInf) && rsInf > 0 ? rsInf : REDUTOR_SOCIAL.locacaoMes;
    var fracaoRes = o.pctResidencial == null || o.pctResidencial === "" ? 1 : Math.min(100, Math.max(0, Number(o.pctResidencial) || 0)) / 100;
    var rs = o.residencial ? Math.min(base1, rsUnit * imoveis * fracaoRes) : 0; // Decreto 12.955/2026, art. 378
    var base = arred(base1 - rs);
    var cbs = arred(base * e.cbs / 100), ibs = arred(base * e.ibs / 100), creditos = num(o.creditos);
    var debito = arred(cbs + ibs), apagar = arred(debito - creditos);
    return { aluguel: aluguel, exclusoes: excl, redutorSocial: rs, base: base, aliquotas: e, transicao: false, cbs: cbs, ibs: ibs, debito: debito,
      creditos: creditos, apagar: apagar, carga: aluguel > 0 ? Math.max(0, apagar) / aluguel * 100 : 0 };
  }

  // Pessoa física: vira contribuinte do regime regular? (LC 214/2025, art. 251; Decreto 12.955/2026, art. 382)
  // o = { receitaLocacaoAnoAnterior, imoveisLocados, receitaLocacaoAnoAtual, imoveisLocadosAnoAtual,
  //       vendasAnoAnterior, vendasAnoAtual (imóveis com menos de 5 anos), construidosVendidosAnoAnterior, construidosVendidosAnoAtual, limite }
  function pessoaFisica(o) {
    var lim = num(o.limite) || LIMITE_PF_LOCACAO, motivos = [];
    var imoveisAtual = o.imoveisLocadosAnoAtual == null ? num(o.imoveisLocados) : num(o.imoveisLocadosAnoAtual);
    if (num(o.receitaLocacaoAnoAnterior) > lim && num(o.imoveisLocados) > 3) motivos.push("locação: receita do ano anterior acima de " + fmt(lim) + " com mais de 3 imóveis (art. 251, § 1º, I; Decreto 12.955/2026, art. 382, I)");
    if (num(o.receitaLocacaoAnoAtual) > lim * 1.2 && imoveisAtual > 3) motivos.push("locação: no próprio ano, receita acima de " + fmt(lim * 1.2) + " (limite + 20%) com mais de 3 imóveis (art. 251, § 2º, II; Decreto 12.955/2026, art. 382, § 1º, III)");
    if (num(o.vendasAnoAnterior) > 3) motivos.push("venda de mais de 3 imóveis distintos, com menos de 5 anos no patrimônio, no ano anterior (art. 251, § 1º, II, e § 3º)");
    if (num(o.vendasAnoAtual) > 3) motivos.push("no próprio ano, a partir da 4ª venda de imóvel com menos de 5 anos no patrimônio (Decreto 12.955/2026, art. 382, § 1º, I)");
    if (num(o.construidosVendidosAnoAnterior) > 1) motivos.push("venda de mais de 1 imóvel construído pela própria pessoa nos 5 anos anteriores, no ano anterior (art. 251, § 1º, III)");
    if (num(o.construidosVendidosAnoAtual) > 1) motivos.push("no próprio ano, a partir da 2ª venda de imóvel construído pela própria pessoa (Decreto 12.955/2026, art. 382, § 1º, II)");
    return { contribuinte: motivos.length > 0, motivos: motivos };
  }

  // ---------- Incorporação e loteamento ----------
  // o = { tipo: "ret" | "retSocial" | "loteamento" | "semRet", recebido (no mês), juros (juros e correção dentro do recebido), valorTotal (da unidade), redutorAjuste, redutorSocial,
  //       residencial: bool, creditos (do mês), ano, ref }
  var OPCAO_TRANSICAO = {
    ret: { pct: 2.08, artigo: "art. 485, I", nome: "RET da incorporação (Lei 10.931/2004, arts. 4º e 8º)", irCsll: 1.92 },
    retSocial: { pct: 0.53, artigo: "art. 485, II", nome: "RET social (Lei 10.931/2004, art. 4º, §§ 6º e 8º)", irCsll: 0.47 },
    loteamento: { pct: 3.65, artigo: "art. 486", nome: "Parcelamento do solo com registro pedido antes de 2029" }
  };
  function incorporacao(o) {
    var recebido = num(o.recebido), total = num(o.valorTotal);
    var e = efetivas(Number(o.ano), o.ref || {}, REDUCAO.venda);
    var ra = num(o.redutorAjuste);
    var rsPadrao = o.residencial ? (o.tipo === "loteamento" ? REDUTOR_SOCIAL.lote : REDUTOR_SOCIAL.residencialNovo) : 0;
    var rsInf = Number(o.redutorSocial);
    var rs = o.residencial ? (Number.isFinite(rsInf) && rsInf > 0 ? rsInf : rsPadrao) : 0;
    // art. 262, § 4º (Decreto 12.955/2026, art. 380, § 6º): redutores proporcionais ao valor principal da parcela
    // em relação ao valor total da alienação; juros e correção da parcela entram inteiros na base (art. 255, § 1º).
    var juros = Math.min(recebido, num(o.juros)), principal = recebido - juros;
    var redutorParcela = total > 0 ? Math.min(principal, (ra + rs) * principal / total) : 0;
    var proporcao = recebido > 0 ? redutorParcela / recebido : 0;
    var base = arred(recebido - redutorParcela);
    var cbs = arred(base * e.cbs / 100), ibs = arred(base * e.ibs / 100), creditos = num(o.creditos);
    var regular = { base: base, proporcaoRedutores: proporcao, redutorParcela: arred(redutorParcela), juros: juros, cbs: cbs, ibs: ibs, debito: arred(cbs + ibs), creditos: creditos, apagar: arred(cbs + ibs - creditos) };
    regular.carga = recebido > 0 ? Math.max(0, regular.apagar) / recebido * 100 : 0;
    var op = OPCAO_TRANSICAO[o.tipo] || null, opcao = null;
    if (op) {
      var v = arred(recebido * op.pct / 100);
      opcao = { pct: op.pct, artigo: op.artigo, nome: op.nome, valor: v, carga: op.pct, irCsll: op.irCsll || 0, valorIrCsll: op.irCsll ? arred(recebido * op.irCsll / 100) : 0 };
    }
    return { recebido: recebido, aliquotas: e, regular: regular, opcao: opcao };
  }

  // ---------- Regime atual (PIS/Cofins) para o comparativo ----------
  var REGIMES_ATUAIS = {
    presumido: { nome: "Lucro Presumido — PIS/Cofins cumulativos (3,65%)", pct: 3.65 },
    real: { nome: "Lucro Real — PIS/Cofins não cumulativos (9,25%)", pct: 9.25, creditos: true },
    ret: { nome: "RET da incorporação — parcela de PIS/Cofins (2,08% de 4%)", pct: 2.08 },
    retSocial: { nome: "RET social — parcela de PIS/Cofins (0,53% de 1%)", pct: 0.53 },
    pf: { nome: "Pessoa física não contribuinte", pct: 0 }
  };
  function atual(valor, regime, creditosPisCofins) {
    var r = REGIMES_ATUAIS[regime] || REGIMES_ATUAIS.presumido;
    var deb = arred(num(valor) * r.pct / 100), cred = r.creditos ? num(creditosPisCofins) : 0;
    return { nome: r.nome, pct: r.pct, debito: deb, creditos: cred, apagar: arred(deb - cred) };
  }

  // Linha do tempo 2026–2033 para venda ou locação.
  // o = { operacao: "venda" | "locacao", entrada (objeto de venda()/locacao() sem ano), regimeAtual, creditosPisCofins }
  function comparativo(o) {
    var linhas = [], base = o.operacao === "locacao" ? num(o.entrada.aluguel) : num(o.entrada.valor);
    var at = atual(o.operacao === "locacao" ? num(o.entrada.aluguel) - Math.min(num(o.entrada.aluguel), num(o.entrada.exclusoes)) : base, o.regimeAtual, o.creditosPisCofins);
    ANOS.forEach(function (ano) {
      var entrada = {}; for (var k in o.entrada) entrada[k] = o.entrada[k];
      entrada.ano = ano;
      var r = o.operacao === "locacao" ? locacao(entrada) : venda(entrada);
      if (ano <= 2026) {
        linhas.push({ ano: ano, pisCofins: at.apagar, cbs: 0, ibs: 0, total: at.apagar, carga: base > 0 ? Math.max(0, at.apagar) / base * 100 : 0, teste: { cbs: r.cbs, ibs: r.ibs }, nota: r.aliquotas.nota });
      } else {
        linhas.push({ ano: ano, pisCofins: 0, cbs: r.transicao ? null : r.cbs, ibs: r.transicao ? null : r.ibs, total: r.apagar, carga: r.carga, transicao: !!r.transicao, nota: r.aliquotas.nota });
      }
    });
    return { atual: at, linhas: linhas };
  }

  function fmt(v) {
    var s = arred(v).toFixed(2).split("."), i = s[0].replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    return "R$ " + i + "," + s[1];
  }

  return { REDUCAO: REDUCAO, REDUTOR_SOCIAL: REDUTOR_SOCIAL, LIMITE_PF_LOCACAO: LIMITE_PF_LOCACAO, ANOS: ANOS, OPCAO_TRANSICAO: OPCAO_TRANSICAO,
    REGIMES_ATUAIS: REGIMES_ATUAIS, aliquotasAno: aliquotasAno, efetivas: efetivas, venda: venda, locacao: locacao, pessoaFisica: pessoaFisica,
    incorporacao: incorporacao, atual: atual, comparativo: comparativo, arred: arred, fmt: fmt };
});
