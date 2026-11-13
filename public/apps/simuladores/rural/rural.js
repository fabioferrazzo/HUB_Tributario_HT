/*
 * CBS e IBS no agro — H. Teixeira.
 * Regras da LC 214/2025, com a redação da LC 227/2026 (conferidas em 13/11/2026):
 *  - produtor rural não contribuinte até R$ 3,6 milhões de receita (arts. 164 a 167);
 *  - crédito presumido de quem compra de produtor não contribuinte (art. 168) — percentuais
 *    fixados todo ano por ato conjunto do Ministro da Fazenda e do Comitê Gestor (ainda não divulgados para 2027);
 *  - alíquota zero: cesta básica nacional (art. 125, Anexo I) e hortícolas, frutas e ovos (art. 148, Anexo XV);
 *  - redução de 60%: alimentos do Anexo VII (art. 135), produtos in natura (art. 137) e insumos do Anexo IX (art. 138);
 *  - transição: CBS 0,9% e IBS 0,1% em 2026 (arts. 343 e 346); CBS menos 0,1 ponto e IBS 0,1% em 2027–2028 (arts. 344 e 347).
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.RuralHT = factory();
})(this, function () {
  "use strict";

  function arred(v) { return Math.round((v + (v >= 0 ? 1e-9 : -1e-9)) * 100) / 100; }
  function num(v) { v = Number(v); return Number.isFinite(v) && v > 0 ? v : 0; }

  var LIMITE = 3600000; // art. 164 (corrigido anualmente pelo IPCA, art. 167)
  var ANOS = [2026, 2027, 2028, 2029, 2030, 2031, 2032, 2033];
  var FRACAO_IBS = { 2029: 0.1, 2030: 0.2, 2031: 0.3, 2032: 0.4, 2033: 1 };

  var PRODUTOS = {
    cesta: { nome: "Cesta Básica Nacional (Anexo I) — arroz, feijão, leite, carnes, café, farinhas…", reducao: 100, base: "LC 214/2025, art. 125 e Anexo I" },
    horti: { nome: "Hortícolas, frutas e ovos (Anexo XV)", reducao: 100, base: "LC 214/2025, art. 148 e Anexo XV" },
    inNatura: { nome: "Produto agropecuário, aquícola, pesqueiro, florestal ou extrativista in natura", reducao: 60, base: "LC 214/2025, art. 137" },
    alimentos: { nome: "Alimentos do Anexo VII (industrializados para consumo humano)", reducao: 60, base: "LC 214/2025, art. 135 e Anexo VII" },
    insumo: { nome: "Insumo agropecuário ou aquícola do Anexo IX", reducao: 60, base: "LC 214/2025, art. 138 e Anexo IX" },
    cheio: { nome: "Demais produtos (alíquota cheia)", reducao: 0, base: "LC 214/2025, art. 14" }
  };

  function aliquotasAno(ano, ref) {
    var cbs = num(ref.cbs), ibs = num(ref.ibs);
    if (ano <= 2026) return { cbs: 0.9, ibs: 0.1, teste: true, nota: "2026 é ano de teste: CBS 0,9% e IBS 0,1% só destacados e compensados com PIS/Cofins; quem cumpre as obrigações acessórias fica dispensado do pagamento (art. 348)." };
    if (ano <= 2028) return { cbs: Math.max(0, cbs - 0.1), ibs: 0.1, nota: "2027 e 2028: CBS integral menos 0,1 ponto (art. 347) e IBS de 0,1% (art. 344)." };
    if (ano <= 2032) return { cbs: cbs, ibs: ibs * FRACAO_IBS[ano], nota: "2029 a 2032: IBS sobe aos poucos (estimativa: " + Math.round(FRACAO_IBS[ano] * 100) + "% do IBS cheio)." };
    return { cbs: cbs, ibs: ibs, nota: "A partir de 2033: CBS e IBS integrais." };
  }

  function efetivas(ano, ref, produto) {
    var a = aliquotasAno(Number(ano), ref || {}), p = PRODUTOS[produto] || PRODUTOS.cheio, f = 1 - p.reducao / 100;
    return { cbs: a.cbs * f, ibs: a.ibs * f, total: (a.cbs + a.ibs) * f, cheia: a.cbs + a.ibs, reducao: p.reducao, base: p.base, nota: a.nota, teste: !!a.teste };
  }

  // Crédito presumido (art. 168, §§ 1º e 3º): percentual aplicado sobre o valor líquido (valor pago − crédito).
  // c = p × (V − c)  ⇒  c = V × p / (1 + p)
  function creditoPresumido(valor, pct) {
    var p = num(pct) / 100;
    var c = arred(num(valor) * p / (1 + p));
    return { valorOperacao: arred(num(valor)), credito: c, valorLiquido: arred(num(valor) - c) };
  }

  // ---------- Enquadramento ----------
  // o = { receitaAnoAnterior, receitaAnoAtual, mesExcesso (1-12), mesesAtividade (início no ano, 1-12), outrasEmpresasAgro, integrado, limite }
  function enquadramento(o) {
    var limite = num(o.limite) || LIMITE, motivos = [], situacao, inicio = null;
    var meses = Math.floor(num(o.mesesAtividade));
    var limiteAno = meses > 0 && meses < 12 ? arred(limite / 12 * meses) : limite;
    var outras = num(o.outrasEmpresasAgro);
    var anterior = num(o.receitaAnoAnterior) + outras, atual = num(o.receitaAnoAtual) + outras;
    if (o.integrado) {
      situacao = "naoContribuinte";
      motivos.push("Produtor rural integrado (contrato de integração vertical) não é contribuinte, qualquer que seja a receita (art. 164, caput e § 1º).");
    } else if (anterior >= limite) {
      situacao = "contribuinte";
      motivos.push("Receita do ano anterior de " + fmt(anterior) + ", igual ou acima de " + fmt(limite) + ": é contribuinte do regime regular (art. 164).");
    } else if (atual > limiteAno) {
      var excesso = atual / limiteAno - 1;
      if (excesso > 0.2) {
        situacao = "contribuinte";
        var mes = Math.min(12, Math.max(1, Math.floor(num(o.mesExcesso)) || 1));
        var mesInicio = mes + 2;
        inicio = mesInicio > 12 ? "janeiro do ano seguinte" : NOME_MES[mesInicio - 1];
        motivos.push("A receita do ano passou do limite" + (limiteAno !== limite ? " proporcional (" + fmt(limiteAno) + ", art. 164, § 4º)" : "") + " em mais de 20%: vira contribuinte a partir do 2º mês seguinte ao do excesso — " + inicio + " (art. 164, § 2º).");
      } else {
        situacao = "contribuinteAnoSeguinte";
        motivos.push("A receita do ano passou do limite em até 20%: vira contribuinte só no ano seguinte (art. 164, § 3º).");
      }
    } else {
      situacao = "naoContribuinte";
      motivos.push("Receita abaixo de " + fmt(limiteAno) + ": não é contribuinte de CBS e IBS (art. 164), salvo se optar pelo regime regular (art. 165).");
    }
    if (outras > 0) motivos.push("Somadas as receitas das outras empresas agropecuárias em que tem participação (art. 164, § 6º).");
    return { situacao: situacao, limite: limite, limiteAno: limiteAno, receitaAnterior: anterior, receitaAtual: atual, inicio: inicio, motivos: motivos };
  }
  var NOME_MES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

  // ---------- Vale optar pelo regime regular? ----------
  // o = { vendas, pctContribuintes (0-100), produto, comprasAnexoIX, comprasOutras, pctPresumido (vazio = desconhecido), ano, ref }
  function comparar(o) {
    var V = num(o.vendas), s = Math.min(100, num(o.pctContribuintes)) / 100;
    var e = efetivas(o.ano, o.ref, o.produto);
    var cheia = e.cheia / 100;
    // IBS/CBS embutidos nas compras (insumos do Anexo IX com 60% de redução).
    var I = arred(num(o.comprasAnexoIX) * cheia * 0.4 + num(o.comprasOutras) * cheia);
    var Vs = V * s, Vn = V - Vs;
    var debito = arred(V * e.total / 100);
    var regular = { debito: debito, creditos: I, saldo: arred(debito - I) };
    var temP = o.pctPresumido !== "" && o.pctPresumido != null && Number.isFinite(Number(o.pctPresumido));
    var cp = temP ? creditoPresumido(Vs, o.pctPresumido) : null;
    // Vantagem de ficar fora (não contribuinte), mantendo o mesmo preço sem tributo:
    //  vendas a contribuintes: comprador ganha o crédito presumido (c) e o produtor perde o crédito das compras;
    //  vendas a não contribuintes: o preço não carrega CBS/IBS (Vn × t), mas o produtor arca com o tributo das compras.
    var limiar = arred(I - Vn * e.total / 100); // crédito presumido mínimo para empatar
    var pEquilibrio = null;
    if (limiar <= 0) pEquilibrio = 0;
    else if (Vs > limiar) pEquilibrio = limiar / (Vs - limiar) * 100;
    var vantagemFora = cp ? arred(cp.credito - limiar) : null;
    return { vendas: V, aliquotas: e, tributoCompras: I, vendasContribuintes: arred(Vs), vendasOutros: arred(Vn), regular: regular,
      presumido: cp, limiar: limiar, pEquilibrio: pEquilibrio, vantagemFora: vantagemFora };
  }

  // ---------- Carga na venda ----------
  // o = { valor, produto, ano, ref, vendedorContribuinte, pctPresumido }
  function venda(o) {
    var V = num(o.valor), e = efetivas(o.ano, o.ref, o.produto);
    if (!o.vendedorContribuinte) {
      var temP = o.pctPresumido !== "" && o.pctPresumido != null && Number.isFinite(Number(o.pctPresumido));
      return { valor: V, aliquotas: e, contribuinte: false, cbs: 0, ibs: 0, total: 0, totalNota: arred(V), creditoComprador: temP ? creditoPresumido(V, o.pctPresumido).credito : null };
    }
    var cbs = arred(V * e.cbs / 100), ibs = arred(V * e.ibs / 100);
    return { valor: V, aliquotas: e, contribuinte: true, cbs: cbs, ibs: ibs, total: arred(cbs + ibs), totalNota: arred(V + cbs + ibs), creditoComprador: arred(cbs + ibs) };
  }

  function fmt(v) {
    var s = arred(v).toFixed(2).split("."), i = s[0].replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    return "R$ " + i + "," + s[1];
  }

  return { LIMITE: LIMITE, ANOS: ANOS, PRODUTOS: PRODUTOS, aliquotasAno: aliquotasAno, efetivas: efetivas, creditoPresumido: creditoPresumido,
    enquadramento: enquadramento, comparar: comparar, venda: venda, arred: arred, fmt: fmt };
});
