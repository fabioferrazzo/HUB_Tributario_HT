/*
 * Simples Nacional — tabelas e cálculos compartilhados pelos simuladores do HUB.
 *
 * Fontes (conferidas em 13/11/2026):
 * - LC 123/2006, art. 18, §§ 1º, 1º-A, 1º-B, 1º-C, 2º, 5º-J, 5º-K, 5º-M e 24; Anexos I a V na redação da LC 155/2016
 *   (vigência desde 01/01/2018). Pelo § 1º-C, as alíquotas nominais e efetivas e os percentuais do ICMS e do ISS
 *   são mantidos na substituição de PIS/Cofins pela CBS/IBS (2027).
 * - Resolução CGSN 140/2018, arts. 21 (alíquota efetiva; RBT12 zero = R$ 1,00; 6ª faixa sem impedimento),
 *   22 (início de atividade), 26 (fator "r"), 27 (alíquota de ISS na retenção) e 60 (crédito de ICMS).
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.SimplesHT = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var LIMITES = [180000, 360000, 720000, 1800000, 3600000, 4800000];
  var NOMES_TRIBUTOS = { IRPJ: "IRPJ", CSLL: "CSLL", COFINS: "Cofins", PIS: "PIS/Pasep", CPP: "CPP", ICMS: "ICMS", IPI: "IPI", ISS: "ISS" };

  // [alíquota nominal %, parcela a deduzir R$] por faixa; partilha em % por faixa (6ª faixa sem ICMS/ISS)
  var ANEXOS = {
    I: {
      nome: "Anexo I — Comércio", local: "ICMS", tributos: ["IRPJ", "CSLL", "COFINS", "PIS", "CPP", "ICMS"],
      faixas: [[4.00, 0], [7.30, 5940], [9.50, 13860], [10.70, 22500], [14.30, 87300], [19.00, 378000]],
      partilha: [
        [5.50, 3.50, 12.74, 2.76, 41.50, 34.00], [5.50, 3.50, 12.74, 2.76, 41.50, 34.00], [5.50, 3.50, 12.74, 2.76, 42.00, 33.50],
        [5.50, 3.50, 12.74, 2.76, 42.00, 33.50], [5.50, 3.50, 12.74, 2.76, 42.00, 33.50], [13.50, 10.00, 28.27, 6.13, 42.10, 0]
      ]
    },
    II: {
      nome: "Anexo II — Indústria", local: "ICMS", tributos: ["IRPJ", "CSLL", "COFINS", "PIS", "CPP", "IPI", "ICMS"],
      faixas: [[4.50, 0], [7.80, 5940], [10.00, 13860], [11.20, 22500], [14.70, 85500], [30.00, 720000]],
      partilha: [
        [5.50, 3.50, 11.51, 2.49, 37.50, 7.50, 32.00], [5.50, 3.50, 11.51, 2.49, 37.50, 7.50, 32.00], [5.50, 3.50, 11.51, 2.49, 37.50, 7.50, 32.00],
        [5.50, 3.50, 11.51, 2.49, 37.50, 7.50, 32.00], [5.50, 3.50, 11.51, 2.49, 37.50, 7.50, 32.00], [8.50, 7.50, 20.96, 4.54, 23.50, 35.00, 0]
      ]
    },
    III: {
      nome: "Anexo III — Serviços", local: "ISS", tributos: ["IRPJ", "CSLL", "COFINS", "PIS", "CPP", "ISS"],
      faixas: [[6.00, 0], [11.20, 9360], [13.50, 17640], [16.00, 35640], [21.00, 125640], [33.00, 648000]],
      partilha: [
        [4.00, 3.50, 12.82, 2.78, 43.40, 33.50], [4.00, 3.50, 14.05, 3.05, 43.40, 32.00], [4.00, 3.50, 13.64, 2.96, 43.40, 32.50],
        [4.00, 3.50, 13.64, 2.96, 43.40, 32.50], [4.00, 3.50, 12.82, 2.78, 43.40, 33.50], [35.00, 15.00, 16.03, 3.47, 30.50, 0]
      ],
      // nota (*) do Anexo III: 5ª faixa com alíquota efetiva acima de 14,92537% — (efetiva − 5%) × percentual; ISS fixo em 5%
      tetoIss: { limite: 14.92537, percentuais: [6.02, 5.26, 19.28, 4.18, 65.26] }
    },
    IV: {
      nome: "Anexo IV — Serviços (§ 5º-C)", local: "ISS", tributos: ["IRPJ", "CSLL", "COFINS", "PIS", "ISS"], semCpp: true,
      faixas: [[4.50, 0], [9.00, 8100], [10.20, 12420], [14.00, 39780], [22.00, 183780], [33.00, 828000]],
      partilha: [
        [18.80, 15.20, 17.67, 3.83, 44.50], [19.80, 15.20, 20.55, 4.45, 40.00], [20.80, 15.20, 19.73, 4.27, 40.00],
        [17.80, 19.20, 18.90, 4.10, 40.00], [18.80, 19.20, 18.08, 3.92, 40.00], [53.50, 21.50, 20.55, 4.45, 0]
      ],
      // nota (*) do Anexo IV: 5ª faixa com alíquota efetiva acima de 12,5%
      tetoIss: { limite: 12.5, percentuais: [31.33, 32.00, 30.13, 6.54] }
    },
    V: {
      nome: "Anexo V — Serviços (§ 5º-I)", local: "ISS", tributos: ["IRPJ", "CSLL", "COFINS", "PIS", "CPP", "ISS"],
      faixas: [[15.50, 0], [18.00, 4500], [19.50, 9900], [20.50, 17100], [23.00, 62100], [30.50, 540000]],
      partilha: [
        [25.00, 15.00, 14.10, 3.05, 28.85, 14.00], [23.00, 15.00, 14.10, 3.05, 27.85, 17.00], [24.00, 15.00, 14.92, 3.23, 23.85, 19.00],
        [21.00, 15.00, 15.74, 3.41, 23.85, 21.00], [23.00, 12.50, 14.10, 3.05, 23.85, 23.50], [35.00, 15.50, 16.44, 3.56, 29.50, 0]
      ]
    }
  };

  function arred(v, casas) { var f = Math.pow(10, casas == null ? 2 : casas); return Math.round((v + Number.EPSILON) * f) / f; }
  function faixaDe(rbt12) { for (var i = 0; i < LIMITES.length; i++) if (rbt12 <= LIMITES[i]) return i; return 5; }
  function efetivaFaixa(rbt12, anexo, faixa) {
    var f = ANEXOS[anexo].faixas[faixa];
    return (rbt12 * f[0] / 100 - f[1]) / rbt12 * 100;
  }

  /*
   * Alíquota efetiva e percentuais efetivos por tributo.
   * opcoes: { anexo, rbt12, receita, impedido } — impedido: ICMS/ISS fora do Simples (sublimite excedido).
   */
  function calcular(opcoes) {
    var anexo = opcoes.anexo, cfg = ANEXOS[anexo];
    if (!cfg) throw new Error("Anexo inválido.");
    var avisos = [];
    var rbtInformada = Number(opcoes.rbt12) || 0;
    var rbt12 = rbtInformada > 0 ? rbtInformada : 1; // Res. CGSN 140, art. 21, parágrafo único
    if (rbtInformada <= 0) avisos.push("RBT12 igual a zero: para determinar a alíquota considera-se R$ 1,00 (Res. CGSN 140/2018, art. 21, parágrafo único).");
    if (rbt12 > 4800000) avisos.push("RBT12 acima de R$ 4.800.000,00 (limite do Simples). O cálculo usa a 6ª faixa; confira a situação de exclusão.");
    var faixa = faixaDe(rbt12);
    var nominal = cfg.faixas[faixa][0], deduzir = cfg.faixas[faixa][1];
    var efetiva = efetivaFaixa(rbt12, anexo, faixa);
    var local = cfg.local, idxLocal = cfg.tributos.indexOf(local);
    var linhas = cfg.tributos.map(function (t, i) { return { tributo: t, nome: NOMES_TRIBUTOS[t], reparticao: cfg.partilha[faixa][i], percentual: efetiva * cfg.partilha[faixa][i] / 100 }; });
    var regra = "Alíquota efetiva × percentual de repartição da " + (faixa + 1) + "ª faixa.";
    var localFora = false;

    if (faixa < 5 && cfg.tetoIss && faixa === 4 && efetiva > cfg.tetoIss.limite) {
      // ISS limitado a 5%: diferença transferida aos tributos federais (percentuais da nota do Anexo)
      var j = 0;
      linhas.forEach(function (l) {
        if (l.tributo === "ISS") { l.percentual = 5; l.reparticao = null; }
        else { l.reparticao = null; l.percentual = (efetiva - 5) * cfg.tetoIss.percentuais[j++] / 100; }
      });
      regra = "5ª faixa com alíquota efetiva acima de " + String(cfg.tetoIss.limite).replace(".", ",") + "%: ISS fixo em 5% e (alíquota efetiva − 5%) repartida entre os tributos federais (nota do " + cfg.nome.split(" —")[0] + ").";
    } else if (faixa < 5 && local === "ISS" && linhas[idxLocal].percentual > 5) {
      // regra geral do art. 18, § 1º-B, I (não ocorre nas tabelas atuais fora da nota do Anexo)
      var excesso = linhas[idxLocal].percentual - 5, somaFed = 100 - cfg.partilha[faixa][idxLocal];
      linhas.forEach(function (l, i) { if (i === idxLocal) l.percentual = 5; else l.percentual += excesso * cfg.partilha[faixa][i] / somaFed; });
      regra = "ISS limitado a 5%, diferença transferida proporcionalmente aos tributos federais (LC 123, art. 18, § 1º-B, I).";
    }

    var percentualLocal5 = null;
    if (faixa === 5) {
      if (opcoes.impedido) {
        localFora = true;
        linhas[idxLocal].percentual = 0;
        avisos.push(local + " fora do Simples: a empresa está impedida de recolher o " + local + " pelo Simples (sublimite excedido) e o recolhe pelo regime normal.");
      } else {
        // Res. CGSN 140, art. 21, III, "b": ICMS/ISS pela fórmula da 5ª faixa com a RBT12
        var ef5 = efetivaFaixa(rbt12, anexo, 4);
        percentualLocal5 = ef5;
        var p = ef5 * cfg.partilha[4][idxLocal] / 100;
        if (local === "ISS" && p > 5) p = 5;
        linhas[idxLocal].percentual = p;
        linhas[idxLocal].reparticao = cfg.partilha[4][idxLocal];
        regra = "6ª faixa: tributos federais pela 6ª faixa; " + local + " pela fórmula da 5ª faixa aplicada à RBT12 (Res. CGSN 140/2018, art. 21, III, b)" + (local === "ISS" ? ", limitado a 5%" : "") + ".";
        avisos.push("Na 6ª faixa, a alíquota total é a soma dos tributos federais (6ª faixa) com o " + local + " calculado pela 5ª faixa, enquanto a empresa não estiver impedida pelo sublimite.");
      }
    }
    var aliquotaTotal = linhas.reduce(function (s, l) { return s + l.percentual; }, 0);
    var receita = Math.max(0, Number(opcoes.receita) || 0);
    linhas.forEach(function (l) { l.valor = arred(receita * l.percentual / 100); });
    var total = arred(receita * aliquotaTotal / 100);
    // diferença de centavos vai para o tributo com maior percentual (LC 123, art. 18, § 1º-B, II)
    var soma = linhas.reduce(function (s, l) { return s + l.valor; }, 0);
    var dif = arred(total - soma);
    if (dif !== 0 && receita > 0) {
      var maior = linhas.reduce(function (a, b) { return b.percentual > a.percentual ? b : a; });
      maior.valor = arred(maior.valor + dif);
    }
    return {
      anexo: anexo, nomeAnexo: cfg.nome, rbt12: rbtInformada, rbt12Calculo: rbt12, faixa: faixa + 1, nominal: nominal, deduzir: deduzir,
      efetiva: efetiva, aliquotaTotal: aliquotaTotal, linhas: linhas, local: local, localFora: localFora,
      percentualLocal: linhas[idxLocal].percentual, efetiva5aFaixa: percentualLocal5, receita: receita, das: total, regra: regra, avisos: avisos
    };
  }

  // RBT12 de quem tem menos de 13 meses de atividade (Res. CGSN 140, art. 22, §§ 2º e 3º)
  function rbt12InicioAtividade(mesesAnteriores, receitaMesesAnteriores, receitaMesAtual) {
    var n = Math.floor(Number(mesesAnteriores) || 0);
    if (n <= 0) return arred((Number(receitaMesAtual) || 0) * 12);
    return arred((Number(receitaMesesAnteriores) || 0) / n * 12);
  }

  /*
   * Fator "r" (Res. CGSN 140, art. 26, §§ 6º e 7º).
   * opcoes: { inicioAtividade (mês de início), fs12, rbt12r, fspa, rpar }
   */
  function fatorR(opcoes) {
    var regra;
    var r;
    if (opcoes.inicioAtividade) {
      var fspa = Number(opcoes.fspa) || 0, rpa = Number(opcoes.rpar) || 0;
      if (fspa > 0 && rpa === 0) { r = 0.28; regra = "Mês de início: folha do mês maior que zero e receita do mês igual a zero — fator “r” = 0,28 (art. 26, § 6º, I)."; }
      else if (fspa === 0 && rpa > 0) { r = 0.01; regra = "Mês de início: folha do mês igual a zero — fator “r” = 0,01 (art. 26, § 6º, II)."; }
      else if (fspa > 0 && rpa > 0) { r = fspa / rpa; regra = "Mês de início: folha do mês ÷ receita do mês (art. 26, § 6º, III)."; }
      else { r = 0.01; regra = "Mês de início sem folha e sem receita: tratado como fator “r” = 0,01."; }
    } else {
      var fs = Number(opcoes.fs12) || 0, rb = Number(opcoes.rbt12r) || 0;
      if (fs === 0 && rb === 0) { r = 0.01; regra = "Folha e receita dos 12 meses iguais a zero — fator “r” = 0,01 (art. 26, § 7º, I)."; }
      else if (fs > 0 && rb === 0) { r = 0.28; regra = "Folha maior que zero e receita igual a zero — fator “r” = 0,28 (art. 26, § 7º, II)."; }
      else if (fs === 0 && rb > 0) { r = 0.01; regra = "Folha igual a zero — fator “r” = 0,01 (art. 26, § 7º, IV)."; }
      else { r = fs / rb; regra = "Folha de salários dos 12 meses ÷ receita bruta dos 12 meses (art. 26, § 7º, III)."; }
    }
    return { r: r, anexo: r >= 0.28 ? "III" : "V", regra: regra };
  }

  // Alíquota de ISS a informar na NFS-e para retenção (Res. CGSN 140, art. 27)
  function aliquotaRetencaoIss(opcoes) {
    if (opcoes.mesInicio) return { aliquota: 2, regra: "Serviço prestado no mês de início de atividade: alíquota de 2% (art. 27, II). Diferença apurada depois é recolhida em guia do Município (art. 27, III)." };
    var c = calcular({ anexo: opcoes.anexo, rbt12: opcoes.rbt12, receita: 0, impedido: opcoes.impedido });
    if (c.localFora) return { aliquota: null, regra: "Com o ISS fora do Simples (sublimite excedido), a retenção segue a legislação municipal do regime normal." };
    return { aliquota: c.percentualLocal, regra: "Percentual efetivo do ISS da faixa a que a empresa está sujeita no mês anterior ao da prestação (art. 27, I).", calculo: c };
  }

  // Crédito de ICMS a informar na NF-e (Res. CGSN 140, art. 60)
  function creditoIcms(opcoes) {
    if (opcoes.primeirosMeses) {
      var a = opcoes.anexo === "II" ? 1.44 : 1.36;
      return { aliquota: a, regra: "Operação nos 2 primeiros meses de atividade: " + String(a).replace(".", ",") + "% (" + (opcoes.anexo === "II" ? "produtos industrializados" : "revenda de mercadorias") + ", art. 60, § 3º)." };
    }
    var c = calcular({ anexo: opcoes.anexo, rbt12: opcoes.rbt12, receita: 0, impedido: opcoes.impedido });
    if (c.localFora) return { aliquota: null, regra: "Com o ICMS fora do Simples (sublimite excedido), o crédito segue o regime normal do ICMS." };
    return { aliquota: c.percentualLocal, regra: "Percentual efetivo do ICMS da faixa a que a empresa está sujeita no mês anterior ao da operação (art. 60, § 1º).", calculo: c };
  }

  return { LIMITES: LIMITES, ANEXOS: ANEXOS, NOMES_TRIBUTOS: NOMES_TRIBUTOS, calcular: calcular, faixaDe: faixaDe, efetivaFaixa: efetivaFaixa,
    rbt12InicioAtividade: rbt12InicioAtividade, fatorR: fatorR, aliquotaRetencaoIss: aliquotaRetencaoIss, creditoIcms: creditoIcms, arred: arred };
});
