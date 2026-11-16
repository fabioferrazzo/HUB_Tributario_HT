/* Fator R — cálculo mês a mês do monitoramento (sem tela). Usa SimplesHT (../simples-comum/simples.js). */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("../simples-comum/simples.js"));
  else root.FatorRMonitor = factory(root.SimplesHT);
})(typeof self !== "undefined" ? self : this, function (S) {
  "use strict";

  var RE = /^\d{4}-(0[1-9]|1[0-2])$/;
  function valida(c) { return RE.test(String(c || "")); }
  function idx(c) { return Number(c.slice(0, 4)) * 12 + Number(c.slice(5, 7)) - 1; }
  function deIdx(i) { var a = Math.floor(i / 12), m = i % 12 + 1; return a + "-" + (m < 10 ? "0" : "") + m; }
  function soma(c, n) { return deIdx(idx(c) + n); }
  function rotulo(c) { return valida(c) ? c.slice(5, 7) + "/" + c.slice(0, 4) : ""; }
  function atual(d) { d = d || new Date(); return deIdx(d.getFullYear() * 12 + d.getMonth()); }
  function arred(v) { return Math.round((v + Number.EPSILON) * 100) / 100; }
  function num(v) { v = Number(v); return Number.isFinite(v) && v > 0 ? v : 0; }

  /** Lista de lançamentos → mapa por competência, com a folha total (salários + pró-labore + encargos). */
  function mapa(lancamentos) {
    var m = {};
    (lancamentos || []).forEach(function (l) {
      if (!l || !valida(l.competencia)) return;
      var r = { competencia: l.competencia, receita: num(l.receita), salarios: num(l.salarios), prolabore: num(l.prolabore), encargos: num(l.encargos) };
      r.folha = arred(r.salarios + r.prolabore + r.encargos);
      m[l.competencia] = r;
    });
    return m;
  }

  /**
   * Fator R do período de apuração (PA) `pa`, a partir dos lançamentos.
   * Até 2026: folha e receita dos 12 meses anteriores ao PA (Res. CGSN 140/2018, art. 26).
   * A partir de 01/2027: dos 12 meses anteriores ao mês anterior ao PA (Res. CGSN 190/2026, art. 26, I e II).
   * Com início de atividade informado: anualização pela média quando há menos de 12 meses (art. 26, § 4º) e
   * regras do mês de início (2026: § 6º; 2027+: fator 0,28 no 1º e no 2º mês).
   */
  function calcularPA(m, pa, inicio) {
    if (!valida(pa)) throw new Error("Período de apuração inválido.");
    var ano = Number(pa.slice(0, 4)), novo = S.reforma(ano), mesPA = m[pa] || null;
    var temInicio = valida(inicio);
    var res = { pa: pa, ano: ano, novo: novo, receitaMes: mesPA ? mesPA.receita : 0, folhaMes: mesPA ? mesPA.folha : 0, faltando: [], anualizado: false, primeiraFaixa: false };
    var mesAtiv = temInicio ? idx(pa) - idx(inicio) + 1 : null;
    res.mesAtividade = mesAtiv;
    if (temInicio && mesAtiv < 1) { res.antesDoInicio = true; return res; }

    var fim = soma(pa, novo ? -2 : -1), ini = soma(fim, -11);
    if (temInicio && idx(ini) < idx(inicio)) ini = inicio;
    res.janela = [ini, fim];

    var fr;
    if (temInicio && novo && mesAtiv <= 2) {
      fr = S.fatorR({ inicioAtividade: true, ano: ano });
      res.primeiraFaixa = true; res.fs12 = 0; res.rbt12 = 0; res.janela = null;
    } else if (temInicio && !novo && mesAtiv === 1) {
      fr = S.fatorR({ inicioAtividade: true, fspa: res.folhaMes, rpar: res.receitaMes, ano: ano });
      res.fs12 = arred(res.folhaMes * 12); res.rbt12 = S.rbt12InicioAtividade(0, 0, res.receitaMes); res.janela = null;
      if (!mesPA) res.faltando.push(pa);
    } else {
      var n = idx(fim) - idx(ini) + 1, fs = 0, rb = 0;
      for (var i = idx(ini); i <= idx(fim); i++) {
        var c = deIdx(i), l = m[c];
        if (l) { fs += l.folha; rb += l.receita; } else res.faltando.push(c);
      }
      fs = arred(fs); rb = arred(rb);
      res.meses = n; res.folhaJanela = fs; res.receitaJanela = rb;
      res.semBase = res.faltando.length === n;
      if (n < 12) { res.anualizado = true; res.fs12 = arred(fs / n * 12); res.rbt12 = arred(rb / n * 12); }
      else { res.fs12 = fs; res.rbt12 = rb; }
      fr = S.fatorR({ fs12: res.fs12, rbt12r: res.rbt12 });
    }
    res.r = fr.r; res.anexo = fr.anexo; res.regra = fr.regra;
    res.folga = res.primeiraFaixa ? null : arred(res.fs12 - 0.28 * res.rbt12);
    try {
      var das = S.calcular({ anexo: fr.anexo, rbt12: res.rbt12, receita: res.receitaMes, ano: ano, primeiraFaixa: res.primeiraFaixa });
      res.das = das.das; res.aliquota = das.aliquotaTotal;
    } catch (e) { res.das = null; res.aliquota = null; }
    return res;
  }

  /** Situação do fator: abaixo (Anexo V), perto (até 2 pontos acima de 28%) ou folgado. */
  function situacao(r) {
    if (!Number.isFinite(r)) return "sem";
    if (r < 0.28) return "abaixo";
    if (r < 0.30) return "perto";
    return "ok";
  }

  /** Meses a mostrar na grade: do mais antigo entre (primeiro lançamento, início de atividade, até−14) até `ate`. */
  function meses(m, ate, inicio, minimo) {
    ate = valida(ate) ? ate : atual();
    var de = soma(ate, -(minimo || 14));
    Object.keys(m).forEach(function (c) { if (idx(c) < idx(de)) de = c; });
    if (valida(inicio) && idx(inicio) > idx(de) && idx(inicio) <= idx(ate)) de = soma(inicio, -1);
    var out = [];
    for (var i = idx(de); i <= idx(ate); i++) out.push(deIdx(i));
    Object.keys(m).forEach(function (c) { if (idx(c) > idx(ate)) out.push(c); });
    return out.sort();
  }

  /** Lê texto colado do Excel: competência (MM/AAAA ou AAAA-MM), receita, salários, pró-labore, encargos. */
  function lerColado(texto, parseBR) {
    var linhas = [], erros = [];
    String(texto || "").split(/\r?\n/).forEach(function (bruta, i) {
      var t = bruta.trim(); if (!t) return;
      var p = t.split(/\t|;/).map(function (x) { return x.trim(); });
      var c = p[0], mm = /^(\d{1,2})[\/\-.](\d{4})$/.exec(c), aa = /^(\d{4})[\/\-.](\d{1,2})$/.exec(c);
      var comp = mm ? mm[2] + "-" + ("0" + mm[1]).slice(-2) : aa ? aa[1] + "-" + ("0" + aa[2]).slice(-2) : "";
      if (!valida(comp)) { if (i === 0 && /[a-zA-Z]/.test(t)) return; erros.push("Linha " + (i + 1) + ": competência inválida (“" + c + "”)."); return; }
      var v = p.slice(1, 5).map(function (x) { var n = x === "" ? 0 : parseBR(x); return n; });
      if (v.some(function (n) { return !Number.isFinite(n) || n < 0; })) { erros.push("Linha " + (i + 1) + ": valor inválido."); return; }
      while (v.length < 4) v.push(0);
      linhas.push({ competencia: comp, receita: arred(v[0]), salarios: arred(v[1]), prolabore: arred(v[2]), encargos: arred(v[3]) });
    });
    return { linhas: linhas, erros: erros };
  }

  return { valida: valida, soma: soma, rotulo: rotulo, atual: atual, mapa: mapa, calcularPA: calcularPA, situacao: situacao, meses: meses, lerColado: lerColado, idx: idx };
});
