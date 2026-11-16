/* Fator R — aba "Monitoramento": empresas, receita e folha mês a mês e registro no Controle de Apuração. */
(function () {
  "use strict";
  var M = window.FatorRMonitor, U = window.SimUI, H = window.HubRPC;
  var $ = function (id) { return document.getElementById(id); };
  var est = { carregado: false, carregando: false, admin: false, empresas: [], apur: null, selId: null, sujo: {}, extra: 0, pa: null };

  // ---------------------------------------------------------------- utilidades
  function fmtCnpj(v) {
    var d = String(v || "").replace(/\D/g, "");
    if (d.length === 14) return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
    if (d.length === 11) return d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
    return d;
  }
  function pct(r) { return Number.isFinite(r) ? U.pct(r * 100, 2) : "—"; }
  function emp() { return est.empresas.find(function (e) { return e.id === est.selId; }) || null; }
  function abrir(d) { if (typeof d.showModal === "function") d.showModal(); else d.setAttribute("open", ""); }
  function fechar(d) { if (typeof d.close === "function") d.close(); else d.removeAttribute("open"); }
  function erroEm(el, msg) { el.textContent = msg || ""; el.classList.toggle("oculto", !msg); }
  function temSujo() { return Object.keys(est.sujo).length > 0; }

  /** Lançamentos da empresa com as alterações ainda não salvas por cima. */
  function lancamentosAtuais(e) {
    var m = M.mapa(e.lancamentos), k;
    for (k in est.sujo) {
      var s = est.sujo[k], l = { competencia: k, receita: s.receita, salarios: s.salarios, prolabore: s.prolabore, encargos: s.encargos };
      if (!l.receita && !l.salarios && !l.prolabore && !l.encargos) delete m[k];
      else m[k] = M.mapa([l])[k];
    }
    return m;
  }

  // ---------------------------------------------------------------- carga
  async function carregar(manterSel) {
    if (est.carregando) return;
    est.carregando = true;
    $("monVazioTxt").textContent = "Carregando…";
    try {
      var r = await H.rpc("fr_listar");
      est.admin = !!r.admin; est.empresas = r.empresas || []; est.carregado = true;
      $("monSessao").classList.add("oculto"); $("monCorpo").classList.remove("oculto");
      if (!manterSel || !emp()) est.selId = null;
      renderLista(); renderEmpresa();
    } catch (err) {
      $("monSessao").textContent = err.message;
      $("monSessao").className = "aviso" + (err.semSessao ? "" : " erro");
      if (err.semSessao) $("monCorpo").classList.add("oculto");
      $("monVazioTxt").textContent = err.message;
    } finally { est.carregando = false; }
  }
  async function apurEmpresas() {
    if (est.apur) return est.apur;
    try { est.apur = await H.rpc("fr_apur_empresas"); } catch (e) { est.apur = []; }
    return est.apur;
  }

  // ---------------------------------------------------------------- lista
  function fatorAtual(e) {
    try { return M.calcularPA(M.mapa(e.lancamentos), M.atual(), e.inicio_atividade); } catch (x) { return null; }
  }
  function renderLista() {
    var q = $("busca").value.trim().toLowerCase(), inat = $("verInativas").checked;
    var qd = q.replace(/\D/g, "");
    var itens = est.empresas.filter(function (e) {
      if (!inat && !e.ativo) return false;
      if (!q) return true;
      return e.nome.toLowerCase().indexOf(q) >= 0 || (qd && e.cnpj.indexOf(qd) >= 0) || (e.cnae || "").toLowerCase().indexOf(q) >= 0;
    });
    $("lista").innerHTML = itens.map(function (e) {
      var r = fatorAtual(e), sit = r && !r.antesDoInicio && !r.semBase ? M.situacao(r.r) : "sem";
      var chip = sit === "sem" ? "" : '<span class="chip ' + sit + '" title="Fator R do PA ' + M.rotulo(M.atual()) + '">' + pct(r.r) + "</span>";
      return '<li><button type="button" data-id="' + e.id + '" class="' + (e.id === est.selId ? "sel" : "") + (e.ativo ? "" : " inativa") + '">' +
        '<span class="nm">' + U.esc(e.nome) + "</span>" + chip +
        '<span class="sb">' + U.esc([fmtCnpj(e.cnpj), e.cnae, est.admin && e.owner_nome ? e.owner_nome : ""].filter(Boolean).join(" · ") || "sem CNPJ") + "</span></button></li>";
    }).join("") || '<li class="dica" style="padding:6px 2px">' + (est.empresas.length ? "Nenhuma empresa encontrada." : "Nenhuma empresa cadastrada. Use “+ Nova”.") + "</li>";
    $("listaRodape").textContent = est.empresas.length ? itens.length + " de " + est.empresas.length + " empresa(s)" : "";
  }

  // ---------------------------------------------------------------- empresa
  function renderEmpresa() {
    var e = emp();
    $("monEmpresa").classList.toggle("oculto", !e);
    $("monVazio").classList.toggle("oculto", !!e);
    if (!e) {
      $("monVazioTxt").textContent = est.empresas.length ? "Escolha uma empresa na lista para ver e atualizar o fator R mês a mês." :
        "Cadastre a primeira empresa em “+ Nova”: informe CNAE, início de atividade (se recente) e a receita e a folha dos últimos 12 meses. Depois é só lançar mês a mês.";
      return;
    }
    $("empNome").textContent = e.nome + (e.ativo ? "" : " (inativa)");
    $("empMeta").textContent = [fmtCnpj(e.cnpj) || "sem CNPJ", e.cnae ? "CNAE " + e.cnae : "", e.inicio_atividade ? "início " + M.rotulo(e.inicio_atividade) : "",
      e.apur_nome ? "Controle: " + e.apur_nome : "sem vínculo com o Controle de Apuração", est.admin && e.owner_nome ? "responsável: " + e.owner_nome : ""].filter(Boolean).join(" · ");
    $("btnRegistrar").disabled = !e.apur_company_id;
    $("btnRegistrar").title = e.apur_company_id ? "Grava o fator R na coluna “Pendência / obs. do mês” do Controle de Apuração" : "Vincule a empresa a uma linha do Controle de Apuração (Editar) para registrar.";
    renderGrade();
    renderHistorico(e);
  }

  function mesesDaGrade(e, m) {
    var lista = M.meses(m, M.atual(), e.inicio_atividade, 14 + est.extra);
    return lista;
  }

  function renderGrade() {
    var e = emp(); if (!e) return;
    var m = lancamentosAtuais(e), meses = mesesDaGrade(e, m), hoje = M.atual();
    if (!est.pa || meses.indexOf(est.pa) < 0) est.pa = meses.indexOf(hoje) >= 0 ? hoje : meses[meses.length - 1];
    var calc = {};
    meses.forEach(function (c) { calc[c] = M.calcularPA(m, c, e.inicio_atividade); });
    // linhas (mais recente em cima)
    var html = meses.slice().reverse().map(function (c) {
      var l = m[c] || { receita: 0, salarios: 0, prolabore: 0, encargos: 0, folha: 0 }, r = calc[c], sujo = est.sujo[c] ? " sujo" : "";
      var cel = function (campo) {
        var v = est.sujo[c] ? est.sujo[c][campo] : l[campo];
        return '<td><input class="num moeda' + sujo + '" data-c="' + c + '" data-k="' + campo + '" value="' + (v ? U.numero(v, 2) : "") + '" placeholder="0,00" aria-label="' + campo + " " + M.rotulo(c) + '"></td>';
      };
      var fr = "—", anexo = "", das = "", r12 = "", f12 = "", sit = "";
      if (r && r.semBase) fr = '<span class="dica" title="Sem lançamentos nos meses da base (' + M.rotulo(r.janela[0]) + ' a ' + M.rotulo(r.janela[1]) + ')">sem base</span>';
      else if (r && !r.antesDoInicio) {
        sit = M.situacao(r.r);
        fr = '<span class="chip ' + sit + '"' + (r.faltando.length ? ' title="Faltam lançamentos: ' + r.faltando.map(M.rotulo).join(", ") + '"' : "") + ">" + pct(r.r) + (r.faltando.length ? "*" : "") + "</span>";
        anexo = r.anexo; das = r.das != null ? U.moeda(r.das) : "—";
        r12 = r.primeiraFaixa ? "1ª faixa" : U.moeda(r.rbt12); f12 = r.primeiraFaixa ? "—" : U.moeda(r.fs12);
      }
      return '<tr class="' + (c === est.pa ? "atual" : "") + '"><td>' + M.rotulo(c) + (c === hoje ? ' <span class="dica">(atual)</span>' : "") + "</td>" +
        cel("receita") + cel("salarios") + cel("prolabore") + cel("encargos") +
        "<td>" + U.moeda(l.folha || 0) + "</td><td>" + r12 + "</td><td>" + f12 + "</td><td>" + fr + "</td><td>" + anexo + "</td><td>" + das + "</td></tr>";
    }).join("");
    $("grade").innerHTML = html;
    // seletor do PA
    var opts = meses.slice().reverse().map(function (c) { return '<option value="' + c + '"' + (c === est.pa ? " selected" : "") + ">" + M.rotulo(c) + (c === hoje ? " (mês atual)" : "") + "</option>"; }).join("");
    $("monPA").innerHTML = opts;
    renderKpis(calc[est.pa]);
    renderGrafico(meses, calc);
    $("btnSalvar").disabled = !temSujo();
    $("salvarStatus").textContent = temSujo() ? Object.keys(est.sujo).length + " mês(es) alterado(s) sem salvar" : "";
  }

  function renderKpis(r) {
    var av = [];
    $("mkFatorRot").textContent = "Fator R · PA " + M.rotulo(est.pa);
    if (!r || r.antesDoInicio || r.semBase) {
      ["mkFator", "mkAnexo", "mkMeta", "mkDas"].forEach(function (id) { $(id).textContent = "—"; });
      $("mkFatorSub").textContent = r && r.antesDoInicio ? "antes do início de atividade" : r && r.semBase ? "sem lançamentos de " + M.rotulo(r.janela[0]) + " a " + M.rotulo(r.janela[1]) : "—";
      $("mkAnexoSub").textContent = $("mkMetaSub").textContent = $("mkDasSub").textContent = "—";
      $("monJanela").textContent = ""; $("monAvisos").innerHTML = ""; return;
    }
    var sit = M.situacao(r.r);
    $("mkFator").textContent = pct(r.r);
    $("mkFatorSub").textContent = r.r >= 0.28 ? "igual ou acima de 28%" : "abaixo de 28%";
    $("mkAnexo").textContent = "Anexo " + r.anexo;
    $("mkAnexoSub").textContent = r.anexo === "III" ? "fator “r” ≥ 28%" : "fator “r” < 28%";
    if (r.folga == null) { $("mkMetaRot").textContent = "Início de atividade"; $("mkMeta").textContent = "—"; $("mkMetaSub").textContent = "fator “r” fixo em 0,28"; }
    else if (r.folga >= 0) { $("mkMetaRot").textContent = "Folga sobre 28%"; $("mkMeta").textContent = U.moeda(r.folga); $("mkMetaSub").textContent = "folha 12m acima do mínimo"; }
    else { $("mkMetaRot").textContent = "Para chegar a 28%"; $("mkMeta").textContent = U.moeda(-r.folga); $("mkMetaSub").textContent = "a mais de folha em 12 meses (≈ " + U.moeda(-r.folga / 12) + "/mês)"; }
    $("mkDas").textContent = r.das != null ? U.moeda(r.das) : "—";
    $("mkDasSub").textContent = r.das != null ? "receita do mês " + U.moeda(r.receitaMes) + " · alíquota " + U.pct(r.aliquota, 2) : "—";
    $("monJanela").textContent = r.janela ? "Base: " + M.rotulo(r.janela[0]) + " a " + M.rotulo(r.janela[1]) + (r.anualizado ? " (" + r.meses + " mês(es), anualizado)" : "") + (r.novo ? " · regra de 2027 (Res. CGSN 190/2026, art. 26)" : " · Res. CGSN 140/2018, art. 26") : r.regra;
    if (sit === "abaixo") av.push(["erro", "Fator R abaixo de 28%: o PA " + M.rotulo(est.pa) + " é tributado pelo Anexo V. Seriam necessários " + U.moeda(-r.folga) + " a mais de folha nos 12 meses da base."]);
    else if (sit === "perto") av.push(["", "Atenção: fator R a menos de 2 pontos de 28%. Folga de " + U.moeda(r.folga) + " na folha dos 12 meses — uma redução de pró-labore ou um mês de receita alta pode levar ao Anexo V."]);
    if (r.faltando.length) av.push(["neutro", "Faltam lançamentos na base de cálculo: " + r.faltando.map(M.rotulo).join(", ") + ". Esses meses contam como zero."]);
    if (r.anualizado) av.push(["neutro", "Menos de 12 meses de atividade na base: folha e receita anualizadas pela média (" + U.moeda(r.folhaJanela) + " e " + U.moeda(r.receitaJanela) + " em " + r.meses + " mês(es) × 12)."]);
    if (r.primeiraFaixa || (r.mesAtividade === 1)) av.push(["neutro", r.regra]);
    if (r.rbt12 > 4800000) av.push(["erro", "Receita dos 12 meses acima de R$ 4,8 milhões: confira a exclusão do Simples Nacional."]);
    $("monAvisos").innerHTML = av.map(function (a) { return '<div class="aviso ' + a[0] + '">' + U.esc(a[1]) + "</div>"; }).join("");
  }

  function renderGrafico(meses, calc) {
    est.gm = meses; est.gc = calc;
    var pts = meses.map(function (c, i) { var r = calc[c]; return r && !r.antesDoInicio && !r.semBase ? { i: i, c: c, r: r.r, falta: r.faltando.length > 0 } : null; }).filter(Boolean);
    if (!pts.length) { $("grafico").innerHTML = '<div class="dica">Sem dados.</div>'; return; }
    var W = Math.max(320, Math.round($("grafico").clientWidth || 640)), Hh = 150, pl = 40, pr = 20, pt = 10, pb = 24, max = Math.max(0.45, Math.min(1.5, Math.max.apply(null, pts.map(function (p) { return p.r; })) * 1.1));
    var x = function (i) { return pl + (meses.length === 1 ? (W - pl - pr) / 2 : i * (W - pl - pr) / (meses.length - 1)); };
    var y = function (v) { return pt + (1 - Math.min(v, max) / max) * (Hh - pt - pb); };
    var s = '<svg viewBox="0 0 ' + W + " " + Hh + '">';
    [0, 0.14, 0.28, 0.42].filter(function (v) { return v <= max; }).forEach(function (v) {
      s += '<line x1="' + pl + '" x2="' + (W - pr) + '" y1="' + y(v) + '" y2="' + y(v) + '" class="' + (v === 0.28 ? "lim" : "eixo") + '"/>' +
        '<text x="' + (pl - 6) + '" y="' + (y(v) + 3.5) + '" text-anchor="end">' + Math.round(v * 100) + "%</text>";
    });
    s += '<polyline points="' + pts.map(function (p) { return x(p.i) + "," + y(p.r); }).join(" ") + '" class="linha"/>';
    pts.forEach(function (p) {
      s += '<circle cx="' + x(p.i) + '" cy="' + y(p.r) + '" r="3.6" class="pt ' + M.situacao(p.r) + (p.falta ? " falta" : "") + (p.c === est.pa ? " sel" : "") + '"><title>' + M.rotulo(p.c) + ": " + pct(p.r) + (p.falta ? " (faltam meses)" : "") + "</title></circle>";
    });
    var passo = Math.max(1, Math.ceil(meses.length / 8));
    meses.forEach(function (c, i) { if (i % passo === 0 || i === meses.length - 1) s += '<text x="' + x(i) + '" y="' + (Hh - 6) + '" text-anchor="middle">' + M.rotulo(c).replace("/20", "/") + "</text>"; });
    $("grafico").innerHTML = s + "</svg>";
  }

  function renderHistorico(e) {
    var r = e.registros || [];
    $("historico").innerHTML = r.length ? '<table><thead><tr><th>Registrado em</th><th>Competência</th><th>PA</th><th>Fator R</th><th>Anexo</th></tr></thead><tbody>' + r.map(function (x) {
      return "<tr><td>" + new Date(x.created_at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) + "</td><td>" + M.rotulo(x.competencia) + "</td><td>" + M.rotulo(x.pa) + "</td><td>" + pct(Number(x.fator)) + "</td><td>" + U.esc(x.anexo) + "</td></tr>";
    }).join("") + "</tbody></table>" : "Nenhum registro ainda.";
  }

  // ---------------------------------------------------------------- edição da grade
  function editar(ev) {
    var el = ev.target; if (!el.matches || !el.matches("input[data-c]")) return;
    var e = emp(), c = el.dataset.c, k = el.dataset.k, v = el.value.trim() === "" ? 0 : U.parseBR(el.value);
    if (!Number.isFinite(v) || v < 0) { el.classList.add("invalido"); return; }
    el.classList.remove("invalido");
    var base = M.mapa(e.lancamentos)[c] || { receita: 0, salarios: 0, prolabore: 0, encargos: 0 };
    var atual = est.sujo[c] || { receita: base.receita, salarios: base.salarios, prolabore: base.prolabore, encargos: base.encargos };
    atual[k] = Math.round(v * 100) / 100;
    if (atual.receita === base.receita && atual.salarios === base.salarios && atual.prolabore === base.prolabore && atual.encargos === base.encargos) delete est.sujo[c];
    else est.sujo[c] = atual;
    if (ev.type === "change") {
      // recalcula depois que o foco já passou ao próximo campo e devolve o foco a ele
      setTimeout(function () {
        var a = document.activeElement, fc = a && a.dataset ? a.dataset.c : null, fk = a && a.dataset ? a.dataset.k : null;
        renderGrade(); renderLista();
        if (fc && fk) { var n = document.querySelector('#grade input[data-c="' + fc + '"][data-k="' + fk + '"]'); if (n) { n.focus(); try { n.select(); } catch (x) { /* sem seleção */ } } }
      }, 0);
    } else { $("btnSalvar").disabled = !temSujo(); $("salvarStatus").textContent = temSujo() ? Object.keys(est.sujo).length + " mês(es) alterado(s) sem salvar" : ""; }
  }
  async function salvar() {
    var e = emp(); if (!e || !temSujo()) return true;
    var linhas = Object.keys(est.sujo).map(function (c) { var s = est.sujo[c]; return { competencia: c, receita: s.receita, salarios: s.salarios, prolabore: s.prolabore, encargos: s.encargos }; });
    $("btnSalvar").disabled = true; $("salvarStatus").textContent = "Salvando…";
    try {
      await H.rpc("fr_lancamentos_salvar", { p_empresa: e.id, p_linhas: linhas });
      est.sujo = {};
      await carregar(true);
      $("salvarStatus").textContent = "Salvo.";
      setTimeout(function () { if (!temSujo()) $("salvarStatus").textContent = ""; }, 2500);
      return true;
    } catch (err) {
      $("btnSalvar").disabled = false; $("salvarStatus").textContent = "Não salvou: " + err.message;
      return false;
    }
  }
  function confirmarDescarte() { return !temSujo() || confirm("Há meses alterados sem salvar nesta empresa. Descartar as alterações?"); }

  // ---------------------------------------------------------------- cadastro
  async function abrirCadastro(nova) {
    var e = nova ? null : emp();
    if (!nova && !e) return;
    $("dlgEmpTit").textContent = nova ? "Nova empresa" : "Editar empresa";
    $("fNome").value = e ? e.nome : ""; $("fCnpj").value = e ? fmtCnpj(e.cnpj) : ""; $("fCnae").value = e ? e.cnae : "";
    $("fInicio").value = e ? e.inicio_atividade : ""; $("fObs").value = e ? e.observacoes : ""; $("fAtivo").checked = e ? e.ativo : true;
    $("btnExcluir").classList.toggle("oculto", nova);
    erroEm($("fErro"), "");
    $("fVinculo").innerHTML = '<option value="">Carregando…</option>';
    abrir($("dlgEmpresa"));
    var lista = await apurEmpresas();
    var usados = {}; est.empresas.forEach(function (x) { if (x.apur_company_id && (!e || x.id !== e.id)) usados[x.apur_company_id] = x.nome; });
    $("fVinculo").innerHTML = '<option value="">Sem vínculo</option>' + lista.map(function (c) {
      return '<option value="' + c.id + '"' + (e && e.apur_company_id === c.id ? " selected" : "") + ">" + U.esc(c.nome + (c.cnpj ? " — " + fmtCnpj(c.cnpj) : "") + (c.regime ? " · " + c.regime : "") + (est.admin && c.owner_nome ? " · " + c.owner_nome : "") + (usados[c.id] ? " (já vinculada)" : "")) + "</option>";
    }).join("");
    if (e && e.apur_company_id && !lista.some(function (c) { return c.id === e.apur_company_id; })) $("fVinculo").insertAdjacentHTML("beforeend", '<option value="' + e.apur_company_id + '" selected>' + U.esc(e.apur_nome || "Empresa vinculada") + "</option>");
  }
  function aoEscolherVinculo() {
    var c = (est.apur || []).find(function (x) { return x.id === $("fVinculo").value; });
    if (!c) return;
    if (!$("fNome").value.trim()) $("fNome").value = c.nome;
    if (!$("fCnpj").value.trim() && c.cnpj) $("fCnpj").value = fmtCnpj(c.cnpj);
  }
  async function salvarCadastro(ev) {
    ev.preventDefault();
    var e = $("dlgEmpTit").textContent === "Nova empresa" ? null : emp();
    var dados = { nome: $("fNome").value, cnpj: $("fCnpj").value, cnae: $("fCnae").value, inicio_atividade: $("fInicio").value || "", observacoes: $("fObs").value, ativo: $("fAtivo").checked, apur_company_id: $("fVinculo").value || "" };
    if (e) dados.id = e.id;
    var d = dados.cnpj.replace(/\D/g, "");
    if (!dados.nome.trim()) return erroEm($("fErro"), "Informe o nome da empresa.");
    if (d && d.length !== 14 && d.length !== 11) return erroEm($("fErro"), "CNPJ com 14 dígitos (ou CPF com 11).");
    $("btnSalvarEmp").disabled = true;
    try {
      var r = await H.rpc("fr_empresa_salvar", { p_dados: dados });
      fechar($("dlgEmpresa"));
      if (!e) { est.selId = r.id; est.sujo = {}; est.pa = null; est.extra = 0; }
      await carregar(true);
    } catch (err) { erroEm($("fErro"), err.message); }
    finally { $("btnSalvarEmp").disabled = false; }
  }
  async function excluir() {
    var e = emp(); if (!e) return;
    if (!confirm("Excluir “" + e.nome + "” e todos os " + e.lancamentos.length + " mês(es) lançados do monitoramento?\n\nIsto não pode ser desfeito. O Controle de Apuração não é alterado.")) return;
    try {
      await H.rpc("fr_empresa_excluir", { p_empresa: e.id });
      fechar($("dlgEmpresa")); est.selId = null; est.sujo = {};
      await carregar(false);
    } catch (err) { erroEm($("fErro"), err.message); }
  }

  // ---------------------------------------------------------------- colar
  function aplicarColado(ev) {
    ev.preventDefault();
    var e = emp(), res = M.lerColado($("txtColar").value, U.parseBR);
    if (res.erros.length) return erroEm($("colarErro"), res.erros.slice(0, 6).join(" "));
    if (!res.linhas.length) return erroEm($("colarErro"), "Nada para lançar.");
    res.linhas.forEach(function (l) { est.sujo[l.competencia] = { receita: l.receita, salarios: l.salarios, prolabore: l.prolabore, encargos: l.encargos }; });
    var m = M.mapa(e.lancamentos), primeiro = res.linhas.map(function (l) { return l.competencia; }).sort()[0];
    var precisa = M.idx(M.atual()) - M.idx(primeiro) - 14; if (precisa > est.extra) est.extra = precisa;
    fechar($("dlgColar")); $("txtColar").value = "";
    renderGrade();
    $("salvarStatus").textContent = res.linhas.length + " mês(es) lançados na grade — confira e clique em “Salvar alterações”.";
    void m;
  }

  // ---------------------------------------------------------------- registrar
  function linhaPrevia(r, pa) {
    var t = "Fator R (PA " + M.rotulo(pa) + "): " + U.numero(r.r * 100, 2) + "% — Anexo " + (r.r >= 0.28 ? "III" : "V");
    if (r.fs12 > 0 || r.rbt12 > 0) t += " (folha 12m " + U.moeda(r.fs12).replace(/\s/g, " ") + " ÷ receita 12m " + U.moeda(r.rbt12).replace(/\s/g, " ") + ")";
    return t + " · registrado em " + new Date().toLocaleDateString("pt-BR");
  }
  function atualizarPrevia() {
    var e = emp(), pa = $("rPA").value, r = null;
    try { r = M.calcularPA(lancamentosAtuais(e), pa, e.inicio_atividade); } catch (x) { r = null; }
    if (!r || r.antesDoInicio || r.semBase) { $("rPrevia").textContent = r && r.semBase ? "Sem lançamentos na base deste PA." : "PA antes do início de atividade."; $("btnConfRegistrar").disabled = true; return; }
    $("btnConfRegistrar").disabled = false;
    $("rPrevia").textContent = linhaPrevia(r, pa);
    erroEm($("rErro"), r.faltando.length ? "Atenção: faltam lançamentos de " + r.faltando.map(M.rotulo).join(", ") + " na base deste PA (contam como zero)." : "");
    $("rErro").className = r.faltando.length ? "aviso" : "aviso erro oculto";
  }
  async function abrirRegistrar() {
    var e = emp(); if (!e || !e.apur_company_id) return;
    if (temSujo() && !(await salvar())) return;
    var lista = await apurEmpresas(), c = lista.find(function (x) { return x.id === e.apur_company_id; });
    var comp = (c && c.competencia_aberta) || M.atual();
    $("rComp").value = comp;
    var opts = mesesDaGrade(e, lancamentosAtuais(e)).slice().reverse();
    if (opts.indexOf(comp) < 0) opts.unshift(comp);
    $("rPA").innerHTML = opts.map(function (x) { return '<option value="' + x + '">' + M.rotulo(x) + "</option>"; }).join("");
    $("rPA").value = comp;
    $("rDestino").textContent = "Empresa no Controle: " + (e.apur_nome || "—") + (c && c.competencia_aberta ? " · competência em aberto mais antiga: " + M.rotulo(c.competencia_aberta) : "");
    atualizarPrevia();
    abrir($("dlgRegistrar"));
  }
  async function registrar(ev) {
    ev.preventDefault();
    var e = emp(), comp = $("rComp").value, pa = $("rPA").value;
    if (!M.valida(comp)) return erroEm($("rErro"), "Informe a competência (mês/ano).");
    var r = M.calcularPA(lancamentosAtuais(e), pa, e.inicio_atividade);
    $("btnConfRegistrar").disabled = true;
    try {
      var res = await H.rpc("fr_registrar_apuracao", { p_empresa: e.id, p_competencia: comp, p_pa: pa, p_fator: Math.round(r.r * 1e6) / 1e6, p_folha12: r.primeiraFaixa ? 0 : r.fs12, p_receita12: r.primeiraFaixa ? 0 : r.rbt12 });
      fechar($("dlgRegistrar"));
      await carregar(true);
      $("monAvisos").insertAdjacentHTML("afterbegin", '<div class="aviso neutro">Registrado no Controle de Apuração (' + U.esc(e.apur_nome || "") + ", " + M.rotulo(comp) + "): " + U.esc(res.linha) + "</div>");
    } catch (err) {
      erroEm($("rErro"), err.message); $("rErro").className = "aviso erro";
    } finally { $("btnConfRegistrar").disabled = false; }
  }

  // ---------------------------------------------------------------- eventos
  $("busca").addEventListener("input", renderLista);
  $("verInativas").addEventListener("change", renderLista);
  $("lista").addEventListener("click", function (ev) {
    var b = ev.target.closest("button[data-id]"); if (!b || b.dataset.id === est.selId) return;
    if (!confirmarDescarte()) return;
    est.selId = b.dataset.id; est.sujo = {}; est.pa = null; est.extra = 0;
    renderLista(); renderEmpresa();
    if (window.matchMedia("(max-width: 900px)").matches) $("monEmpresa").scrollIntoView({ behavior: "smooth", block: "start" });
  });
  $("btnNova").addEventListener("click", function () { if (confirmarDescarte()) { est.sujo = {}; abrirCadastro(true); } });
  $("btnEditar").addEventListener("click", function () { abrirCadastro(false); });
  $("fVinculo").addEventListener("change", aoEscolherVinculo);
  $("formEmpresa").addEventListener("submit", salvarCadastro);
  $("btnExcluir").addEventListener("click", excluir);
  $("grade").addEventListener("input", editar);
  $("grade").addEventListener("change", editar);
  $("grade").addEventListener("focusout", function (ev) { var el = ev.target; if (el.matches && el.matches("input.moeda") && !el.classList.contains("invalido")) { var v = U.parseBR(el.value); if (Number.isFinite(v) && v > 0) el.value = U.numero(Math.round(v * 100) / 100, 2); else if (v === 0) el.value = ""; } });
  $("grade").addEventListener("keydown", function (ev) {
    if (ev.key !== "Enter" || !ev.target.matches("input[data-c]")) return;
    ev.preventDefault();
    var ins = Array.prototype.slice.call(document.querySelectorAll("#grade input[data-k='" + ev.target.dataset.k + "']")), i = ins.indexOf(ev.target);
    var prox = ins[ev.shiftKey ? i - 1 : i + 1]; if (prox) { prox.focus(); prox.select(); }
  });
  $("btnSalvar").addEventListener("click", salvar);
  $("btnColar").addEventListener("click", function () { erroEm($("colarErro"), ""); abrir($("dlgColar")); setTimeout(function () { $("txtColar").focus(); }, 30); });
  $("formColar").addEventListener("submit", aplicarColado);
  $("btnMaisMeses").addEventListener("click", function () { est.extra += 12; renderGrade(); });
  $("monPA").addEventListener("change", function () { est.pa = $("monPA").value; renderGrade(); });
  $("btnRegistrar").addEventListener("click", abrirRegistrar);
  $("rPA").addEventListener("change", atualizarPrevia);
  $("formRegistrar").addEventListener("submit", registrar);
  Array.prototype.forEach.call(document.querySelectorAll(".dlg [data-fechar]"), function (b) { b.addEventListener("click", function () { fechar(b.closest("dialog")); }); });
  var tmr = null; window.addEventListener("resize", function () { clearTimeout(tmr); tmr = setTimeout(function () { if (est.gm && emp() && !$("abaMon").classList.contains("oculto")) renderGrafico(est.gm, est.gc); }, 200); });
  window.addEventListener("beforeunload", function (ev) { if (temSujo()) { ev.preventDefault(); ev.returnValue = ""; } });

  window.FatorRMonitorUI = { abrir: function () { if (!est.carregado) carregar(false); } };
})();
