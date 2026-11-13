/*
 * Retenções na fonte sobre notas de serviço (NFS-e) — H. Teixeira.
 * Regras conferidas em 13/11/2026:
 *  - IRRF entre empresas: RIR/2018 (Decreto 9.580), arts. 714, 716 e 718.
 *  - PIS/Cofins/CSLL (4,65%): Lei 10.833/2003, arts. 30 a 32.
 *  - Simples Nacional: Lei 10.833, art. 32, III; IN RFB 765/2007 (IRRF).
 *  - INSS 11%: Lei 8.212/1991, art. 31; IN RFB 2.110/2022, arts. 110 a 131 e 166/167.
 *  - Órgãos federais: Lei 9.430/1996, art. 64; IN RFB 1.234/2012, art. 3º e Anexo I.
 *  - Estados, DF e municípios (só IR): IN RFB 1.234/2012, arts. 2º-A e 3º-A.
 *  - ISS retido: LC 116/2003, art. 6º; LC 123/2006, art. 21, § 4º; Res. CGSN 140/2018, art. 27.
 *  - 2027: PIS/Cofins extintos com a CBS (EC 132/2023, ADCT, art. 126, II) — projeção.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.RetencoesHT = factory();
})(this, function () {
  "use strict";

  function arred(v) { return Math.round((v + (v >= 0 ? 1e-9 : -1e-9)) * 100) / 100; }

  // Natureza do serviço quando quem paga é empresa privada.
  var NATUREZAS = {
    profissional: { nome: "Serviços profissionais (advocacia, contabilidade, consultoria, engenharia, medicina, programação, treinamento…)", ir: 1.5, irBase: "RIR/2018, art. 714", csrf: true },
    limpeza: { nome: "Limpeza, conservação, segurança, vigilância ou locação de mão de obra", ir: 1, irBase: "RIR/2018, art. 716", csrf: true },
    csrfSo: { nome: "Manutenção, transporte de valores, assessoria creditícia ou mercadológica, gestão de crédito, seleção e riscos, administração de contas a pagar e a receber", ir: 0, csrf: true },
    comissao: { nome: "Comissões, corretagem, representação comercial ou mediação de negócios", ir: 1.5, irBase: "RIR/2018, art. 718, I", csrf: false },
    propaganda: { nome: "Propaganda e publicidade", ir: 1.5, irBase: "RIR/2018, art. 718, II", csrf: false, excluiVeiculos: true },
    outros: { nome: "Outros serviços (sem retenção federal entre empresas privadas)", ir: 0, csrf: false }
  };

  // IN RFB 1.234/2012, Anexo I (alíquotas em %).
  var TABELA_IN1234 = [
    { codigo: "6190", ir: 4.8, csll: 1, cofins: 3, pis: 0.65, nome: "Demais serviços — água, telefone, correio, vigilância, limpeza, locação de mão de obra, intermediação, administração ou locação de bens, factoring, plano de saúde com valor fixo" },
    { codigo: "6147", ir: 1.2, csll: 1, cofins: 3, pis: 0.65, nome: "Serviços com emprego de materiais, construção civil por empreitada com materiais, serviços hospitalares e de diagnóstico (arts. 30 e 31), transporte de cargas, alimentação, energia elétrica, mercadorias" },
    { codigo: "6175", ir: 2.4, csll: 1, cofins: 3, pis: 0.65, nome: "Passagens e demais serviços de transporte de passageiros" },
    { codigo: "6188", ir: 2.4, csll: 1, cofins: 3, pis: 0.65, nome: "Bancos, financeiras, seguradoras, arrendamento mercantil, previdência aberta e seguro saúde" },
    { codigo: "8863", ir: 0, csll: 1, cofins: 3, pis: 0.65, nome: "Associações profissionais ou assemelhadas e cooperativas" },
    { codigo: "8767", ir: 1.2, csll: 1, cofins: 0, pis: 0, nome: "Transporte internacional de cargas por empresa nacional, estaleiros (REB) e itens com isenção ou alíquota zero de PIS/Cofins" },
    { codigo: "8850", ir: 2.4, csll: 1, cofins: 0, pis: 0, nome: "Transporte internacional de passageiros por empresa nacional" },
    { codigo: "9060", ir: 0.24, csll: 1, cofins: 3, pis: 0.65, nome: "Combustíveis adquiridos de refinarias, produtores, importadores ou distribuidores (arts. 19 a 21)" },
    { codigo: "8739", ir: 0.24, csll: 1, cofins: 0, pis: 0, nome: "Combustíveis adquiridos de distribuidores e varejistas" }
  ];
  function itemIN1234(codigo) { for (var i = 0; i < TABELA_IN1234.length; i++) if (TABELA_IN1234[i].codigo === codigo) return TABELA_IN1234[i]; return null; }

  // INSS — base mínima quando o contrato prevê material/equipamento sem valor (IN 2110, arts. 117 e 118).
  var SERVICOS_INSS = {
    geral: { nome: "Demais serviços dos arts. 111 e 112", minMaterial: 50 },
    limpeza: { nome: "Limpeza (exceto hospitalar)", minMaterial: 80 },
    limpezaHosp: { nome: "Limpeza hospitalar", minMaterial: 65 },
    transportePass: { nome: "Transporte de passageiros (combustível e manutenção pela contratada)", minMaterial: 30 },
    construcao: { nome: "Construção civil (empreitada parcial, subempreitada, serviços do Anexo VI)", minMaterial: 50 }
  };
  var EQUIP_CONSTRUCAO = {
    pavimentacao: { nome: "Pavimentação asfáltica", pct: 10 },
    terraplenagem: { nome: "Terraplenagem, aterro sanitário e dragagem", pct: 15 },
    obrasArte: { nome: "Obras de arte (pontes ou viadutos)", pct: 45 },
    drenagem: { nome: "Drenagem", pct: 50 },
    demais: { nome: "Demais serviços com equipamentos (exceto manuais)", pct: 35 }
  };
  var ADICIONAL_ESPECIAL = { 0: 0, 15: 4, 20: 3, 25: 2 };

  function num(v) { v = Number(v); return Number.isFinite(v) && v > 0 ? v : 0; }

  function baseInss(valor, cfg) {
    var mat = num(cfg.valorMateriais), base = valor, regra, pctMin = null;
    var servico = SERVICOS_INSS[cfg.servico] || SERVICOS_INSS.geral;
    switch (cfg.materiais) {
      case "discriminado":
        base = valor - mat;
        regra = "Materiais/equipamentos discriminados no contrato e na nota saem da base (IN 2110, art. 116).";
        break;
      case "semValorContrato":
        pctMin = servico.minMaterial;
        base = Math.max(valor - mat, valor * pctMin / 100);
        regra = "Contrato prevê material/equipamento sem valor, mas a nota discrimina: base mínima de " + pctMin + "% do valor bruto (IN 2110, art. 117).";
        break;
      case "equipInerente":
        if (cfg.servico === "construcao") pctMin = (EQUIP_CONSTRUCAO[cfg.tipoConstrucao] || EQUIP_CONSTRUCAO.demais).pct;
        else if (cfg.servico === "transportePass") pctMin = 30;
        else pctMin = 50;
        base = Math.max(valor - mat, valor * pctMin / 100);
        regra = "Equipamento inerente ao serviço, sem valor no contrato e discriminado na nota: base mínima de " + pctMin + "% do valor bruto (IN 2110, art. 118, II).";
        break;
      default:
        regra = "Sem material/equipamento discriminado na nota: a base é o valor bruto (IN 2110, art. 119, parágrafo único).";
    }
    var deducoes = num(cfg.deducoes);
    if (deducoes > 0) regra += " Deduzidos alimentação e vale-transporte discriminados na nota (art. 120).";
    base = Math.max(0, arred(base - deducoes));
    return { base: base, regra: regra, pctMin: pctMin };
  }

  /*
   * opcoes = {
   *   ano: 2026 | 2027, tomador: "privado" | "federal" | "estadual", valor,
   *   regime: "normal" | "simples", anexoSimples: "I".."V", tomadorSimples: bool (tomador privado optante pelo Simples),
   *   natureza (privado), valorVeiculos (propaganda), codigo (IN 1234),
   *   inss: { aplica, servico, materiais, valorMateriais, tipoConstrucao, deducoes, especial: 0|15|20|25, valorEspecial, dispensa: "" | "semEmpregados" | "profissionalSocios" },
   *   iss: { aplica, aliquota, deducoes }
   * }
   */
  function calcular(o) {
    var valor = num(o.valor), simples = o.regime === "simples", ano2027 = Number(o.ano) >= 2027;
    var linhas = [], avisos = [];
    function linha(tributo, base, aliquota, valorRet, fundamento, extra) {
      var l = { tributo: tributo, base: arred(base), aliquota: aliquota, valor: arred(valorRet), fundamento: fundamento, dispensado: false, grupo: null };
      if (extra) for (var k in extra) l[k] = extra[k];
      linhas.push(l);
      return l;
    }

    // ---------- Tributos federais ----------
    if (o.tomador === "federal") {
      var it = itemIN1234(o.codigo) || TABELA_IN1234[0];
      if (simples) {
        avisos.push({ tipo: "neutro", texto: "Prestador do Simples Nacional: o órgão federal não retém IR, CSLL, PIS e Cofins sobre as receitas próprias da empresa, desde que ela apresente a declaração do Anexo IV da IN RFB 1.234/2012 (art. 4º, XI)." });
      } else {
        var cof = ano2027 ? 0 : it.cofins, pis = ano2027 ? 0 : it.pis;
        var partes = [
          ["IR", it.ir], ["CSLL", it.csll], ["Cofins", cof], ["PIS/Pasep", pis]
        ];
        var grupo = [];
        partes.forEach(function (p) {
          if (p[1] > 0) grupo.push(linha(p[0], valor, p[1], valor * p[1] / 100, "IN RFB 1.234/2012, Anexo I — código " + it.codigo, { grupo: "in1234", codigo: it.codigo }));
        });
        var totalGrupo = grupo.reduce(function (s, l) { return s + l.valor; }, 0);
        if (totalGrupo > 0 && totalGrupo < 10) {
          grupo.forEach(function (l) { l.dispensado = true; });
          avisos.push({ tipo: "neutro", texto: "Retenção da IN 1.234 de " + fmt(totalGrupo) + ": abaixo de R$ 10,00, fica dispensada (art. 3º, § 6º), exceto quando o Darf for emitido pelo Siafi." });
        }
        if (ano2027 && (it.cofins > 0 || it.pis > 0)) avisos.push({ tipo: "aviso", texto: "2027: PIS e Cofins deixam de existir (EC 132/2023, ADCT, art. 126, II; LC 214/2025, art. 542), por isso saem da retenção; IR e CSLL continuam (Lei 9.430/1996, art. 64). A tabela da IN 1.234 ainda não foi ajustada pela Receita; confira antes de usar." });
        avisos.push({ tipo: "neutro", texto: "A retenção da IN 1.234 substitui as demais retenções federais sobre o mesmo pagamento (RIR/2018, art. 720, § 5º). Código de receita do Darf: " + it.codigo + "." });
      }
    } else if (o.tomador === "estadual") {
      var it2 = itemIN1234(o.codigo) || TABELA_IN1234[0];
      if (simples) {
        avisos.push({ tipo: "neutro", texto: "Prestador do Simples Nacional: sem retenção de IR pelo ente estadual ou municipal (IN RFB 1.234/2012, art. 4º, XI, aplicável ao art. 2º-A), mediante a declaração do Anexo IV." });
      } else if (it2.ir > 0) {
        linha("IR", valor, it2.ir, valor * it2.ir / 100, "IN RFB 1.234/2012, arts. 2º-A e 3º-A (coluna 02 do Anexo I)", { grupo: "estadual" });
        avisos.push({ tipo: "neutro", texto: "Estados, DF e municípios (com suas autarquias e fundações) retêm só o IR, pela coluna 02 do Anexo I. O IR retido fica com o próprio ente (CF, arts. 157, I, e 158, I)." });
      } else {
        avisos.push({ tipo: "neutro", texto: "Para esta natureza a coluna de IR do Anexo I é zero: não há retenção de IR pelo ente." });
      }
    } else {
      var nat = NATUREZAS[o.natureza] || NATUREZAS.outros;
      if (simples) {
        if (nat.ir > 0 || nat.csrf) avisos.push({ tipo: "neutro", texto: "Prestador do Simples Nacional: sem retenção de IR (IN RFB 765/2007) e de PIS, Cofins e CSLL (Lei 10.833/2003, art. 32, III). Peça a declaração de optante para o arquivo do tomador." });
      } else {
        if (nat.ir > 0) {
          var baseIr = valor;
          if (nat.excluiVeiculos) {
            var veic = Math.min(valor, num(o.valorVeiculos));
            baseIr = valor - veic;
            if (veic > 0) avisos.push({ tipo: "neutro", texto: "Valores repassados a rádio, TV, jornais e revistas saem da base do IR (RIR/2018, art. 718, § 1º)." });
          }
          var lir = linha("IRRF", baseIr, nat.ir, baseIr * nat.ir / 100, nat.irBase);
          if (lir.valor > 0 && lir.valor < 10) avisos.push({ tipo: "neutro", texto: "IRRF abaixo de R$ 10,00: retém normalmente, mas o Darf só é pago quando o total do código somar R$ 10,00 ou mais (RIR/2018, art. 938, §§ 4º e 5º)." });
        }
        if (nat.csrf && o.tomadorSimples) {
          avisos.push({ tipo: "neutro", texto: "Tomador optante pelo Simples Nacional não é obrigado a reter PIS, Cofins e CSLL (Lei 10.833/2003, art. 30, § 2º). O IRRF e o INSS continuam sendo retidos." });
        } else if (nat.csrf) {
          var g = [];
          g.push(linha("CSLL", valor, 1, valor * 0.01, "Lei 10.833/2003, arts. 30 e 31", { grupo: "csrf" }));
          if (!ano2027) {
            g.push(linha("Cofins", valor, 3, valor * 0.03, "Lei 10.833/2003, arts. 30 e 31", { grupo: "csrf" }));
            g.push(linha("PIS/Pasep", valor, 0.65, valor * 0.0065, "Lei 10.833/2003, arts. 30 e 31", { grupo: "csrf" }));
          } else {
            avisos.push({ tipo: "aviso", texto: "2027: PIS e Cofins deixam de existir (EC 132/2023, ADCT, art. 126, II; LC 214/2025, art. 542). Os arts. 30 a 36 da Lei 10.833/2003 não foram revogados, então sobra a retenção da CSLL de 1%. Confira se a Receita publicou ajuste antes de usar." });
          }
          var tg = g.reduce(function (s, l) { return s + l.valor; }, 0);
          if (tg > 0 && tg <= 10) {
            g.forEach(function (l) { l.dispensado = true; });
            avisos.push({ tipo: "neutro", texto: "Retenção de " + fmt(tg) + " de PIS/Cofins/CSLL: igual ou abaixo de R$ 10,00, fica dispensada (Lei 10.833/2003, art. 31, § 3º)." });
          }
        }
        if (nat.ir === 0 && !nat.csrf) avisos.push({ tipo: "neutro", texto: "Para esta natureza não há retenção federal de IR nem de PIS/Cofins/CSLL entre empresas privadas." });
      }
    }

    // ---------- INSS ----------
    var inss = o.inss || {};
    if (inss.aplica) {
      if (simples && o.anexoSimples !== "IV") {
        avisos.push({ tipo: "neutro", texto: "Prestador do Simples fora do Anexo IV não sofre a retenção de 11% do INSS (IN RFB 2.110/2022, art. 167; STJ, Súmula 425). No Anexo IV a retenção se aplica (art. 166)." });
      } else {
        var b = baseInss(valor, inss);
        var adic = ADICIONAL_ESPECIAL[Number(inss.especial) || 0] || 0;
        var v11 = b.base * 0.11;
        var lInss = linha("INSS", b.base, 11, v11, "Lei 8.212/1991, art. 31; IN RFB 2.110/2022, art. 110", { grupo: "inss", regra: b.regra });
        var lAd = null;
        if (adic > 0) {
          var baseEsp = num(inss.valorEspecial) > 0 ? Math.min(num(inss.valorEspecial), b.base) : b.base;
          lAd = linha("INSS adicional (atividade especial)", baseEsp, adic, baseEsp * adic / 100, "IN RFB 2.110/2022, art. 131", { grupo: "inss" });
        }
        var motivo = null;
        if (v11 > 0 && arred(v11) < 10) motivo = "os 11% somam menos que R$ 10,00, o mínimo para recolhimento (IN 2110, art. 115, I)";
        else if (inss.dispensa === "semEmpregados") motivo = "a contratada não tem empregados, o serviço é prestado pelo titular ou sócio e o faturamento do mês anterior não passou de 2 vezes o teto do salário de contribuição — com declaração (art. 115, II e § 1º)";
        else if (inss.dispensa === "profissionalSocios") motivo = "o serviço é profissão regulamentada (ou treinamento e ensino) prestado pessoalmente pelos sócios, sem empregados — com declaração ou registro na nota (art. 115, III e § 2º)";
        if (motivo) {
          lInss.dispensado = true; if (lAd) lAd.dispensado = true;
          avisos.push({ tipo: "neutro", texto: "Retenção do INSS dispensada: " + motivo + "." });
        } else {
          avisos.push({ tipo: "neutro", texto: "Na nota, destacar “RETENÇÃO PARA A PREVIDÊNCIA SOCIAL” logo após a descrição dos serviços (IN 2110, art. 121). O tomador recolhe até o dia 20 do mês seguinte ao da emissão (art. 123)." });
        }
      }
    }

    // ---------- ISS ----------
    var iss = o.iss || {};
    if (iss.aplica) {
      var aliq = Number(iss.aliquota), informado = Number.isFinite(aliq) && aliq > 0;
      if (simples && !informado) {
        aliq = 5;
        avisos.push({ tipo: "aviso", texto: "Prestador do Simples sem alíquota de ISS na nota: o tomador aplica 5% (LC 123/2006, art. 21, § 4º, IV)." });
      } else if (!informado) {
        aliq = NaN;
      }
      if (Number.isFinite(aliq)) {
        var baseIss = Math.max(0, valor - num(iss.deducoes));
        linha("ISS", baseIss, aliq, baseIss * aliq / 100, simples ? "LC 123/2006, art. 21, § 4º; Res. CGSN 140/2018, art. 27" : "LC 116/2003, art. 6º, e lei do município", { grupo: "iss" });
        if (!simples && (aliq < 2 || aliq > 5)) avisos.push({ tipo: "aviso", texto: "Alíquota de ISS fora da faixa de 2% a 5% da LC 116/2003 (arts. 8º, II, e 8º-A). Confira a lei do município." });
      } else {
        avisos.push({ tipo: "erro", texto: "Informe a alíquota do ISS do município." });
      }
    }

    var total = arred(linhas.reduce(function (s, l) { return s + (l.dispensado ? 0 : l.valor); }, 0));
    return { valor: valor, linhas: linhas, total: total, liquido: arred(valor - total), percentual: valor > 0 ? total / valor * 100 : 0, avisos: avisos };
  }

  function fmt(v) {
    var s = arred(v).toFixed(2).split("."), i = s[0].replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    return "R$ " + i + "," + s[1];
  }
  function pctTxt(p) { return String(Number(p).toFixed(2)).replace(".", ",") + "%"; }

  // Texto para colar no campo de informações complementares da NFS-e.
  function textoNota(r) {
    var ativas = r.linhas.filter(function (l) { return !l.dispensado && l.valor > 0; });
    if (!ativas.length) return "Sem retenções na fonte. Valor líquido: " + fmt(r.valor) + ".";
    var out = ["Retenções na fonte:"];
    ativas.forEach(function (l) {
      var nome = l.tributo === "INSS" ? "RETENÇÃO PARA A PREVIDÊNCIA SOCIAL" : l.tributo === "ISS" ? "ISS retido" : l.tributo;
      out.push(nome + " (" + pctTxt(l.aliquota) + "): " + fmt(l.valor));
    });
    out.push("Total retido: " + fmt(r.total));
    out.push("Valor líquido a pagar: " + fmt(r.liquido));
    return out.join("\n");
  }

  return { NATUREZAS: NATUREZAS, TABELA_IN1234: TABELA_IN1234, SERVICOS_INSS: SERVICOS_INSS, EQUIP_CONSTRUCAO: EQUIP_CONSTRUCAO,
    calcular: calcular, baseInss: baseInss, textoNota: textoNota, arred: arred, fmt: fmt };
});
