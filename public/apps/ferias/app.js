'use strict';
/* H. Teixeira - Controle de Férias (front-end) — versão do HUB: login, usuários e dados vêm do HUB (hub-ferias.js). */

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const DSEM = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const ICONE_BAIXAR = '<svg class="ic" viewBox="0 0 24 24"><path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M4.5 19.5h15"/></svg>';
const CORES = ['#0eb1a2', '#4f6bd8', '#e0803a', '#c2477a', '#6a9e2f', '#8a5cc7', '#d4a017', '#2f8fb8', '#b5523b', '#3d9970', '#7a6f5a', '#d65f9a'];

const st = {
  dados: null,
  view: 'painel',
  cal: { modo: 'mes', ano: 0, mes: 0, semestre: '', usuario: '' },
  filtro: { busca: '', usuario: '', semestre: '', situacao: '', ano: '' },
  filtroAus: { busca: '', usuario: '', mes: '', situacao: '' },
};

/* ---------------------------------------------------------------- utilidades */
function hojeExtenso() {
  const d = dataDe(st.dados.hoje);
  return `${['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'][d.getDay()]}, ${d.getDate()} de ${MESES[d.getMonth()]} de ${d.getFullYear()}`;
}
function fmtDH(txt) { return txt ? `${fmt(txt.slice(0, 10))} ${txt.slice(11, 16)}` : ''; }
function fmt(iso) { return iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : ''; }
function isoDe(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function dataDe(iso) { const [a, m, d] = iso.split('-').map(Number); return new Date(a, m - 1, d); }
function somaDias(iso, n) { const d = dataDe(iso); d.setDate(d.getDate() + n); return isoDe(d); }
function diffDias(a, b) { return Math.round((dataDe(b) - dataDe(a)) / 86400000); }
function num(v) { const n = Number(v) || 0; return Number.isInteger(n) ? String(n) : n.toFixed(1).replace('.', ','); }
function plural(n, s, p) { return `${num(n)} ${Math.abs(n) === 1 ? s : p}`; }
function modoTxt(m) { return m === 'uteis' ? 'dias úteis' : 'dias corridos'; }
function semRotulo(chave) {
  const s = st.dados?.semestres.find((x) => x.chave === chave);
  if (s) return s.rotulo;
  const [a, t] = chave.split('-');
  return t === 'V' ? `Verão ${a}/${String(+a + 1).slice(-2)}` : `Inverno ${a}`;
}
function semestreDe(iso) {
  const d = dataDe(iso); const m = d.getMonth() + 1; const a = d.getFullYear();
  if (m >= 5 && m <= 10) return `${a}-I`;
  return m >= 11 ? `${a}-V` : `${a - 1}-V`;
}
function periodoSemestre(chave) {
  const [a, t] = chave.split('-'); const ano = +a;
  return t === 'V' ? [`${ano}-11-01`, `${ano + 1}-04-30`] : [`${ano}-05-01`, `${ano}-10-31`];
}
function semestreVizinho(chave, passo) {
  const [a, t] = chave.split('-'); let idx = (+a) * 2 + (t === 'V' ? 1 : 0) + passo;
  return `${Math.floor(idx / 2)}-${idx % 2 ? 'V' : 'I'}`;
}
const isAdm = () => st.dados?.me.papel === 'ADM';
const usuario = (id) => st.dados.usuarios.find((u) => u.id === id) || { nome: `#${id}`, cor: '#888' };
const feriadoMap = () => new Map(st.dados.feriados.filter((f) => f.ativo).map((f) => [f.data, f.descricao]));

function toast(msg, tipo = '') {
  const el = document.createElement('div');
  el.className = `toast ${tipo}`; el.textContent = msg;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), tipo === 'erro' ? 7000 : 4500);
}

async function api(caminho, corpo) {
  const opt = corpo === undefined ? { credentials: 'same-origin' } : {
    method: 'POST', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'htferias' },
    body: JSON.stringify(corpo),
  };
  let r;
  try { r = await fetch(caminho, opt); } catch { throw new Error('Sem conexão com o servidor. Verifique a rede.'); }
  const j = await r.json().catch(() => ({}));
  if (r.status === 401 && !caminho.includes('/api/login')) { mostrarLogin(); throw new Error(j.erro || 'Sessão expirada.'); }
  if (!r.ok) throw new Error(j.erro || `Erro ${r.status}`);
  return j;
}

/* ---------------------------------------------------------------- tema claro / escuro */
const TEMA_CHAVE = 'htferias-tema';
const TEMAS = {
  auto: { rot: 'Tema automático (segue o Windows)', ic: '<svg class="ic" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path class="cheio" d="M12 3.5v17a8.5 8.5 0 0 0 0-17z"/></svg>' },
  claro: { rot: 'Tema claro', ic: '<svg class="ic" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4L6 18M18 6l1.4-1.4"/></svg>' },
  escuro: { rot: 'Tema escuro', ic: '<svg class="ic" viewBox="0 0 24 24"><path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z"/></svg>' },
};
const temaAtual = () => document.documentElement.dataset.tema || 'auto';
function desenharBotoesTema() {
  const t = TEMAS[temaAtual()];
  $$('[data-acao="tema"]').forEach((b) => { b.innerHTML = t.ic; b.title = `${t.rot} — clique para trocar`; b.setAttribute('aria-label', t.rot); });
}
function trocarTema() {
  const proximo = { auto: 'claro', claro: 'escuro', escuro: 'auto' }[temaAtual()];
  if (proximo === 'auto') delete document.documentElement.dataset.tema; else document.documentElement.dataset.tema = proximo;
  try { if (proximo === 'auto') localStorage.removeItem(TEMA_CHAVE); else localStorage.setItem(TEMA_CHAVE, proximo); } catch { /* só nesta sessão */ }
  desenharBotoesTema();
  toast(TEMAS[proximo].rot);
}
desenharBotoesTema();

// O painel ocupa "a tela que sobra": a altura real do topo (que pode quebrar em 2 linhas) vai para --h-topo.
// Medido na hora (render e resize); o ResizeObserver sozinho não dispara com a janela em segundo plano.
function medirTopo() {
  const h = $('.topo').getBoundingClientRect().height;
  if (h) document.documentElement.style.setProperty('--h-topo', `${Math.ceil(h)}px`);
}
window.addEventListener('resize', medirTopo);

/* ---------------------------------------------------------------- sessão */
function mostrarLogin() {
  window.hubFeriasSessao();
}

async function iniciar() {
  try {
    const me = await api('/api/me');
    if (!me.logado) return mostrarLogin();
    if (me.troca_senha) return mostrarTrocaObrigatoria();
    await carregar();
  } catch (e) { toast(e.message, 'erro'); }
}

function mostrarTrocaObrigatoria() {
  $('#telaLogin').hidden = true; $('#app').hidden = true; $('#telaSenha').hidden = false;
  $('#formSenhaObrig [name=atual]').focus();
}

$('#formLogin').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const f = ev.target; $('#erroLogin').textContent = '';
  try {
    const r = await api('/api/login', { login: f.login.value, senha: f.senha.value });
    f.senha.value = '';
    if (r.troca_senha) return mostrarTrocaObrigatoria();
    $('#telaLogin').hidden = true;
    await carregar();
  } catch (e) { $('#erroLogin').textContent = e.message; }
});

$('#formSenhaObrig').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const f = ev.target; $('#erroSenhaObrig').textContent = '';
  if (f.nova.value !== f.nova2.value) { $('#erroSenhaObrig').textContent = 'As novas senhas não conferem.'; return; }
  try {
    await api('/api/senha', { atual: f.atual.value, nova: f.nova.value });
    f.reset(); $('#telaSenha').hidden = true;
    toast('Senha definida.');
    await carregar();
  } catch (e) { $('#erroSenhaObrig').textContent = e.message; }
});

async function sair() {
  try { await api('/api/logout', {}); } catch { /* segue */ }
  st.dados = null; mostrarLogin();
}

async function carregar() {
  st.dados = await api('/api/dados');
  const d = st.dados;
  if (!st.cal.ano) {
    const h = dataDe(d.hoje); st.cal.ano = h.getFullYear(); st.cal.mes = h.getMonth(); st.cal.semestre = d.semestre_atual.chave;
  }
  $('#app').hidden = false; $('#telaLogin').hidden = true; $('#telaSenha').hidden = true;
  $('#nomeUsuario').textContent = d.me.nome;
  $('#avatarUsuario').textContent = d.me.nome.split(/\s+/).filter(Boolean).map((p) => p[0]).filter((_, i, a) => i === 0 || i === a.length - 1).join('').toUpperCase();
  $('#papelUsuario').textContent = `${d.me.login} · ${d.me.papel === 'ADM' ? 'ADM (administrador ou gestor do HUB)' : 'Usuário'}`;
  $('#semestreTopo').textContent = d.semestre_atual.rotulo;
  $('#semestreTopo').title = `${fmt(d.semestre_atual.inicio)} a ${fmt(d.semestre_atual.fim)}`;
  $('#papelUsuario').textContent += ` · versão ${d.build}`;
  $$('[data-adm]').forEach((el) => { el.hidden = !isAdm(); });
  $('#btnNovaTopo').hidden = !(isAdm() || d.me.participa);
  if (st.view === 'usuarios' && !isAdm()) st.view = 'painel';
  render();
}

/* ---------------------------------------------------------------- navegação */
$('#abas').addEventListener('click', (ev) => {
  const b = ev.target.closest('button[data-view]'); if (!b) return;
  st.view = b.dataset.view; render();
});

document.addEventListener('click', (ev) => {
  const a = ev.target.closest('[data-acao]'); if (!a) return;
  const acao = a.dataset.acao;
  if (acao === 'sair') sair();
  else if (acao === 'tema') trocarTema();
  else if (acao === 'nova-ferias') abrirFerias(null, a.dataset.data || '');
  else if (acao === 'nova-ausencia') abrirAusencia(null, a.dataset.data ? [a.dataset.data] : []);
  else if (acao === 'backup') { window.hubFeriasExportar(''); toast('Gerando backup em XLSX…'); }
  else if (acao === 'trocar-senha') abrirTrocaSenha();
  if (a.closest('.menu-usuario')) a.closest('details').open = false;
});
document.addEventListener('click', (ev) => {
  const m = $('.menu-usuario'); if (m && m.open && !m.contains(ev.target)) m.open = false;
});

function render() {
  $$('#abas button').forEach((b) => b.classList.toggle('ativa', b.dataset.view === st.view));
  $$('.view').forEach((v) => { v.hidden = v.id !== `view-${st.view}`; });
  medirTopo();
  ({ painel: renderPainel, calendario: renderCalendario, lista: renderLista, ausencias: renderAusencias, usuarios: renderUsuarios, feriados: renderFeriados })[st.view]();
}

/* ---------------------------------------------------------------- painel */
function diasNoIntervalo(f, a, b) {
  const ini = f.inicio > a ? f.inicio : a; const fim = f.fim < b ? f.fim : b;
  return fim < ini ? 0 : diffDias(ini, fim) + 1;
}

function renderPainel() {
  const d = st.dados; const hoje = d.hoje;
  const ativos = new Set(d.usuarios.filter((u) => u.ativo).map((u) => u.id));
  const fer = d.ferias.filter((f) => ativos.has(f.usuario_id));
  const aus = d.ausencias.filter((a) => ativos.has(a.usuario_id));
  const deFerias = fer.filter((f) => f.inicio <= hoje && f.fim >= hoje);
  const prox30 = fer.filter((f) => f.inicio > hoje && f.inicio <= somaDias(hoje, 30));
  const sa = d.semestre_atual;
  const diasSem = fer.reduce((t, f) => t + diasNoIntervalo(f, sa.inicio, sa.fim), 0);
  const meu = d.resumos[d.me.id];
  const ausHoje = aus.filter((a) => a.dias.includes(hoje));
  const mesAtual = hoje.slice(0, 7);
  const ausMesDias = aus.reduce((t, a) => t + a.dias.filter((x) => x.startsWith(mesAtual)).length, 0);
  const ausMesPessoas = new Set(aus.filter((a) => a.dias.some((x) => x.startsWith(mesAtual))).map((a) => a.usuario_id)).size;
  const nomes = (lista) => lista.map((x) => esc(usuario(x.usuario_id).nome.split(' ')[0])).join(', ');

  const kpi = (cls, rot, valor, unid, det) => `<div class="kpi ${cls}"><div class="rot">${rot}</div>
    <div class="linha-kpi"><span class="valor">${valor}${unid ? ` <small>${unid}</small>` : ''}</span><span class="det" title="${esc(det.replace(/<[^>]+>/g, ''))}">${det}</span></div></div>`;
  const kpiMeu = meu
    ? kpi('marinho', `Meu saldo · ${meu.modo === 'uteis' ? 'úteis' : 'corridos'}`, `<span class="${meu.saldo < 0 ? 'negativo' : ''}">${num(meu.saldo)}</span>`, 'dias',
      `acum. ${num(meu.direito)} · goz. ${num(meu.gozado)} · agend. ${num(meu.agendado)}`)
    : kpi('marinho', 'Equipe no controle', d.usuarios.filter((u) => u.ativo && u.participa).length, 'usuários', 'saldos ao lado');

  // saldos
  const linhasSaldo = d.usuarios.filter((u) => u.ativo && d.resumos[u.id]).map((u) => {
    const r = d.resumos[u.id];
    const p = r.proxima ? `${fmt(r.proxima.inicio)} a ${fmt(r.proxima.fim)}` : '<span class="muted">—</span>';
    return `<tr class="clicavel" data-saldo="${u.id}"><td class="nw"><span class="ponto" style="background:${esc(u.cor)}"></span> ${esc(u.nome)}</td>
      <td>${r.modo === 'uteis' ? 'úteis' : 'corridos'}</td><td class="num">${num(r.direito)}</td><td class="num">${num(r.gozado)}</td>
      <td class="num">${num(r.agendado)}</td><td class="num"><b class="${r.saldo < 0 ? 'negativo' : ''}">${num(r.saldo)}</b></td><td class="nw">${p}</td></tr>`;
  }).join('');

  // barras por semestre (dias corridos de férias da equipe)
  const chaves = [-2, -1, 0, 1, 2].map((p) => semestreVizinho(sa.chave, p));
  const totais = chaves.map((c) => { const [a, b] = periodoSemestre(c); return fer.reduce((t, f) => t + diasNoIntervalo(f, a, b), 0); });
  const max = Math.max(1, ...totais);
  const barras = chaves.map((c, i) => `<div class="barra ${c === sa.chave ? 'atual' : ''}"><span>${semRotulo(c)}</span>
    <div class="trilho"><div class="preench" style="width:${(totais[i] / max) * 100}%"></div></div><span class="num">${totais[i]} d</span></div>`).join('');

  // próximas férias + ausências (mesmo quadro)
  const fProx = fer.filter((f) => f.fim >= hoje);
  const aProx = aus.filter((a) => a.dias[a.dias.length - 1] >= hoje);
  const diasF = fProx.reduce((t, f) => t + diasNoIntervalo(f, hoje, f.fim), 0);
  const diasA = aProx.reduce((t, a) => t + a.dias.filter((x) => x >= hoje).length, 0);
  const filtro = st.painelFiltro || 'tudo';

  $('#view-painel').innerHTML = `
    <div class="painel">
    <div class="cabecalho-view compacto"><div class="titulo"><h2>Olá, ${esc(d.me.nome.split(' ')[0])}</h2>
      <p class="sub">${hojeExtenso()} · visão geral da equipe</p></div><span class="selo-semestre ${sa.chave.slice(-1)}" title="${fmt(sa.inicio)} a ${fmt(sa.fim)}">${esc(sa.rotulo)}</span></div>
    <div class="grade-kpi">
      ${kpi('', 'De férias hoje', deFerias.length, '', deFerias.length ? nomes(deFerias) : 'ninguém')}
      ${kpi('ausencia', 'Ausências hoje', ausHoje.length, '', ausHoje.length ? nomes(ausHoje) : 'ninguém ausente')}
      ${kpi('ausencia', `Ausências em ${MESES[+mesAtual.slice(5) - 1]}`, ausMesDias, ausMesDias === 1 ? 'dia' : 'dias', `${plural(ausMesPessoas, 'pessoa', 'pessoas')}`)}
      ${kpi('alerta', 'Saem em 30 dias', prox30.length, '', prox30.length ? prox30.map((f) => `${esc(usuario(f.usuario_id).nome.split(' ')[0])} ${fmt(f.inicio).slice(0, 5)}`).join(', ') : 'nenhuma saída')}
      ${kpi('', esc(sa.rotulo), diasSem, 'dias', 'férias da equipe')}
      ${kpiMeu}
    </div>
    <div class="painel-grade">
      <section class="caixa rolavel">
        <div class="caixa-topo"><h3>Próximas férias e ausências</h3>
          <div class="alternador mini" id="filtroProx">${[['tudo', 'Tudo'], ['ferias', 'Férias'], ['ausencias', 'Ausências']].map(([k, r]) => `<button data-f="${k}" class="${filtro === k ? 'ativa' : ''}">${r}</button>`).join('')}</div></div>
        <div class="totais">
          <div class="tot"><i class="ponto" style="background:var(--acento)"></i><b>${fProx.length}</b> férias<span>· ${plural(diasF, 'dia', 'dias')} a gozar</span></div>
          <div class="tot"><i class="ponto anel" style="border-color:var(--ausencia)"></i><b>${aProx.length}</b> ausências<span>· ${plural(diasA, 'dia', 'dias')}</span></div>
        </div>
        <ul class="lista-proximas corpo" id="listaProx"></ul>
      </section>
      <div class="col-dir">
        <section class="caixa rolavel"><div class="caixa-topo"><h3>${isAdm() ? 'Saldo por usuário' : 'Meu saldo'}</h3>
          <span class="nota">clique na linha para ver por semestre · saldo = acumulado − gozado − agendado</span></div>
          ${linhasSaldo ? `<div class="tabela-wrap corpo"><table><thead><tr><th>Usuário</th><th>Contagem</th><th class="num">Acumulado</th><th class="num">Gozado</th><th class="num">Agendado</th><th class="num">Saldo</th><th>Próximas férias</th></tr></thead><tbody>${linhasSaldo}</tbody></table></div>`
            : `<p class="vazio">${isAdm() ? 'Cadastre os usuários na aba Usuários.' : 'Seu usuário não participa do controle de saldo.'}</p>`}</section>
        <section class="caixa"><div class="caixa-topo"><h3>Férias da equipe por semestre</h3><span class="nota">dias corridos</span></div><div class="barras">${barras}</div></section>
      </div>
    </div>
    </div>`;

  const desenharLista = () => {
    const f = st.painelFiltro || 'tudo';
    const itens = [
      ...(f === 'ausencias' ? [] : fProx.map((x) => ({ tipo: 'f', x, chave: x.inicio > hoje ? x.inicio : hoje }))),
      ...(f === 'ferias' ? [] : aProx.map((x) => ({ tipo: 'a', x, chave: x.dias.find((y) => y >= hoje) }))),
    ].sort((a, b) => a.chave.localeCompare(b.chave));
    $('#listaProx').innerHTML = itens.map(({ tipo, x, chave }) => {
      const u = usuario(x.usuario_id);
      if (tipo === 'a') {
        const quando = x.dias.includes(hoje) ? '<b>ausente hoje</b>' : `em ${plural(diffDias(hoje, chave), 'dia', 'dias')}`;
        return `<li data-ausencia="${x.id}"><i class="ponto anel" style="border-color:${esc(u.cor)}"></i>
          <div class="txt"><b>${esc(u.nome)}</b> <span class="etq aus">ausência</span><span class="muted">${fmtDias(x.dias)} · ${plural(x.dias.length, 'dia', 'dias')}</span>
            ${x.justificativa ? `<span class="obs" title="${esc(x.justificativa)}">${esc(x.justificativa)}</span>` : ''}</div>
          <span class="quando">${quando}</span></li>`;
      }
      const quando = x.inicio <= hoje ? `<b>em andamento</b> · volta ${fmt(somaDias(x.fim, 1)).slice(0, 5)}` : `em ${plural(diffDias(hoje, x.inicio), 'dia', 'dias')}`;
      return `<li data-ferias="${x.id}"><span class="ponto" style="background:${esc(u.cor)}"></span>
        <div class="txt"><b>${esc(u.nome)}</b> <span class="etq">férias</span><span class="muted">${fmt(x.inicio)} a ${fmt(x.fim)} · ${x.dias_corridos} corr. / ${x.dias_uteis} úteis${x.motivo ? ' · ' + esc(x.motivo) : ''}</span>
          ${x.observacao ? `<span class="obs" title="${esc(x.observacao)}">${esc(x.observacao)}</span>` : ''}</div>
        <span class="quando">${quando}</span></li>`;
    }).join('') || `<li class="vazio">${f === 'ausencias' ? 'Nenhuma ausência prevista.' : f === 'ferias' ? 'Nenhuma férias agendada.' : 'Nada previsto.'}</li>`;
    $$('#listaProx [data-ferias]').forEach((el) => el.addEventListener('click', () => abrirFerias(+el.dataset.ferias)));
    $$('#listaProx [data-ausencia]').forEach((el) => el.addEventListener('click', () => abrirAusencia(+el.dataset.ausencia)));
  };
  $$('#filtroProx button').forEach((b) => b.addEventListener('click', () => {
    st.painelFiltro = b.dataset.f;
    $$('#filtroProx button').forEach((x) => x.classList.toggle('ativa', x === b));
    desenharLista();
  }));
  desenharLista();
  $$('#view-painel [data-saldo]').forEach((el) => el.addEventListener('click', () => abrirDetalheSaldo(+el.dataset.saldo)));
}

function abrirDetalheSaldo(uid) {
  const u = usuario(uid); const r = st.dados.resumos[uid]; if (!r) return;
  const linhas = r.semestres.map((s) => `<tr${s.atual ? ' style="font-weight:600"' : ''}><td>${esc(s.rotulo)}${s.atual ? ' (atual)' : s.futuro ? ' <span class="muted">(futuro)</span>' : ''}</td>
    <td class="num">${num(s.direito)}</td><td class="num">${s.corridos}</td><td class="num">${s.uteis}</td>
    <td class="num ${s.saldo_acumulado < 0 ? 'negativo' : ''}">${num(s.saldo_acumulado)}</td></tr>`).join('');
  const ferU = st.dados.ferias.filter((f) => f.usuario_id === uid).sort((a, b) => b.inicio.localeCompare(a.inicio));
  const ausU = st.dados.ausencias.filter((a) => a.usuario_id === uid).sort((a, b) => b.dias[0].localeCompare(a.dias[0]));
  abrirModal(`${u.nome} · saldo, férias e ausências`, `
    <div class="kpis-modal">
      <div class="kpi"><div class="rot">Acumulado</div><div class="valor">${num(r.direito)}</div><div class="det">${plural(r.semestres_contados, 'semestre', 'semestres')} × ${num(r.dias_semestre)}${u.saldo_inicial ? ` + saldo inicial ${num(u.saldo_inicial)}` : ''}</div></div>
      <div class="kpi marinho"><div class="rot">Saldo (${modoTxt(r.modo)})</div><div class="valor ${r.saldo < 0 ? 'negativo' : ''}">${num(r.saldo)}</div><div class="det">gozado ${num(r.gozado)} · agendado ${num(r.agendado)}</div></div>
    </div>
    <div class="tabela-wrap"><table><thead><tr><th>Semestre</th><th class="num">Direito</th><th class="num">Corridos</th><th class="num">Úteis</th><th class="num">Saldo acumulado</th></tr></thead><tbody>${linhas}</tbody></table></div>
    <p class="nota">O direito entra no início de cada semestre (Inverno: mai–out · Verão: nov–abr). O saldo acumulado considera os dias em ${modoTxt(r.modo)}.</p>
    <h4>Férias (${ferU.length})</h4>
    <ul class="lista-detalhe">${ferU.map((f) => `<li data-ferias="${f.id}"><div class="det-topo"><b>${fmt(f.inicio)} a ${fmt(f.fim)}</b> <span class="selo ${f.situacao.replace(' ', '-')}">${f.situacao}</span>
      <span class="muted">${f.dias_corridos} corridos / ${f.dias_uteis} úteis${f.motivo ? ' · ' + esc(f.motivo) : ''}</span></div>
      ${f.observacao ? `<p class="obs">${esc(f.observacao)}</p>` : ''}</li>`).join('') || '<li class="vazio">Nenhuma férias lançada.</li>'}</ul>
    <h4>Ausências (${ausU.length})</h4>
    <ul class="lista-detalhe">${ausU.map((a) => `<li data-ausencia="${a.id}"><div class="det-topo"><b>${fmtDias(a.dias)}</b> <span class="selo ${situacaoAus(a).replace(' ', '-')}">${situacaoAus(a)}</span>
      <span class="muted">${plural(a.dias.length, 'dia', 'dias')}</span></div>
      ${a.justificativa ? `<p class="obs">${esc(a.justificativa)}</p>` : ''}</li>`).join('') || '<li class="vazio">Nenhuma ausência registrada.</li>'}</ul>`,
  `<span class="espaco"></span><button class="btn" data-fechar>Fechar</button>`);
  $$('#modalCorpo [data-ferias]').forEach((el) => el.addEventListener('click', () => abrirFerias(+el.dataset.ferias)));
  $$('#modalCorpo [data-ausencia]').forEach((el) => el.addEventListener('click', () => abrirAusencia(+el.dataset.ausencia)));
}

/* ---------------------------------------------------------------- calendário */
function feriasFiltradasCal() {
  const ativos = new Set(st.dados.usuarios.filter((u) => u.ativo).map((u) => u.id));
  return st.dados.ferias.filter((f) => ativos.has(f.usuario_id) && (!st.cal.usuario || f.usuario_id === +st.cal.usuario));
}

function opcoesUsuarios(sel, soParticipa = false, rotTodos = 'Todos os usuários', comInativos = false) {
  // comInativos: filtros de pesquisa precisam achar o histórico de quem saiu
  const us = st.dados.usuarios.filter((u) => (u.ativo || comInativos) && (!soParticipa || u.participa))
    .sort((a, b) => (b.ativo - a.ativo) || a.nome.localeCompare(b.nome));
  return `${rotTodos !== null ? `<option value="">${rotTodos}</option>` : ''}${us.map((u) => `<option value="${u.id}" ${String(sel) === String(u.id) ? 'selected' : ''}>${esc(u.nome)}${u.ativo ? '' : ' (inativo)'}</option>`).join('')}`;
}

function renderCalendario() {
  const c = st.cal; const d = st.dados;
  let titulo; let corpo; let semChave;
  if (c.modo === 'mes') {
    titulo = `${MESES[c.mes]} ${c.ano}`;
    semChave = semestreDe(isoDe(new Date(c.ano, c.mes, 15)));
    corpo = calMes(c.ano, c.mes);
  } else {
    semChave = c.semestre;
    titulo = semRotulo(semChave);
    corpo = calSemestre(semChave);
  }
  const usuariosLeg = d.usuarios.filter((u) => u.ativo && u.participa && (!c.usuario || u.id === +c.usuario));
  $('#view-calendario').innerHTML = `
    <div class="barra-cal">
      <div class="grupo-nav"><button class="btn icone" data-cal="ant" title="Anterior" aria-label="Anterior"><svg class="ic" viewBox="0 0 24 24"><path d="M14.5 6l-6 6 6 6"/></svg></button>
        <button class="btn" data-cal="hoje">Hoje</button>
        <button class="btn icone" data-cal="prox" title="Próximo" aria-label="Próximo"><svg class="ic" viewBox="0 0 24 24"><path d="M9.5 6l6 6-6 6"/></svg></button></div>
      <span class="titulo-mes">${esc(titulo)}</span>
      <span class="selo-semestre ${semChave.slice(-1)}">${esc(semRotulo(semChave))}</span>
      <span class="espaco"></span>
      <select id="calUsuario">${opcoesUsuarios(c.usuario)}</select>
      <div class="alternador"><button data-modo="mes" class="${c.modo === 'mes' ? 'ativa' : ''}">Mês</button><button data-modo="semestre" class="${c.modo === 'semestre' ? 'ativa' : ''}">Semestre</button></div>
    </div>
    ${corpo}
    <div class="legenda">${usuariosLeg.map((u) => `<span><i class="ponto" style="background:${esc(u.cor)}"></i>${esc(u.nome)}</span>`).join('')}
      <span><i class="ponto" style="background:var(--feriado);outline:1px solid var(--feriado-t)"></i>Feriado</span>
      <span><i class="ponto anel"></i>Ausência</span>
      <span class="dica">Clique num dia para lançar férias ou registrar ausência</span></div>`;

  const v = $('#view-calendario');
  $$('[data-cal]', v).forEach((b) => b.addEventListener('click', () => navegarCal(b.dataset.cal)));
  $$('[data-modo]', v).forEach((b) => b.addEventListener('click', () => {
    c.modo = b.dataset.modo;
    if (c.modo === 'semestre') c.semestre = semestreDe(isoDe(new Date(c.ano, c.mes, 15)));
    renderCalendario();
  }));
  $('#calUsuario').addEventListener('change', (e) => { c.usuario = e.target.value; renderCalendario(); });
  $$('.chip[data-ferias]', v).forEach((el) => el.addEventListener('click', (e) => { e.stopPropagation(); abrirFerias(+el.dataset.ferias); }));
  $$('.chip[data-ausencia]', v).forEach((el) => el.addEventListener('click', (e) => { e.stopPropagation(); abrirAusencia(+el.dataset.ausencia); }));
  $$('.cal-dia[data-dia]', v).forEach((el) => el.addEventListener('click', () => escolherLancamento(el.dataset.dia)));
  $$('[data-irmes]', v).forEach((el) => el.addEventListener('click', () => {
    const [a, m] = el.dataset.irmes.split('-').map(Number); c.ano = a; c.mes = m; c.modo = 'mes'; renderCalendario();
  }));
}

function navegarCal(dir) {
  const c = st.cal;
  if (dir === 'hoje') {
    const h = dataDe(st.dados.hoje); c.ano = h.getFullYear(); c.mes = h.getMonth(); c.semestre = st.dados.semestre_atual.chave;
  } else if (c.modo === 'mes') {
    const d = new Date(c.ano, c.mes + (dir === 'prox' ? 1 : -1), 1); c.ano = d.getFullYear(); c.mes = d.getMonth();
  } else {
    c.semestre = semestreVizinho(c.semestre, dir === 'prox' ? 1 : -1);
  }
  renderCalendario();
}

function ausenciasFiltradasCal() {
  const ativos = new Set(st.dados.usuarios.filter((u) => u.ativo).map((u) => u.id));
  return st.dados.ausencias.filter((a) => ativos.has(a.usuario_id) && (!st.cal.usuario || a.usuario_id === +st.cal.usuario));
}

function calMes(ano, mes) {
  const fer = feriasFiltradasCal(); const aus = ausenciasFiltradasCal(); const ferMap = feriadoMap(); const hoje = st.dados.hoje;
  const ini = new Date(ano, mes, 1); const deslocamento = ini.getDay(); ini.setDate(1 - deslocamento);
  const celulas = Math.ceil((deslocamento + new Date(ano, mes + 1, 0).getDate()) / 7) * 7;   // 5 ou 6 semanas completas
  let html = DSEM.map((s) => `<div class="dsem">${s}</div>`).join('');
  for (let i = 0; i < celulas; i++) {
    const dt = new Date(ini); dt.setDate(ini.getDate() + i);
    const iso = isoDe(dt);
    const porNome = (a, b) => usuario(a.usuario_id).nome.localeCompare(usuario(b.usuario_id).nome);
    const doDia = [
      ...fer.filter((f) => f.inicio <= iso && f.fim >= iso).sort(porNome).map((f) => ({ tipo: 'f', x: f })),
      ...aus.filter((a) => a.dias.includes(iso)).sort(porNome).map((a) => ({ tipo: 'a', x: a })),
    ];
    const cls = ['cal-dia', dt.getMonth() !== mes ? 'fora' : '', dt.getDay() % 6 === 0 ? 'fds' : '', ferMap.has(iso) ? 'feriado' : '', iso === hoje ? 'hoje' : ''].join(' ');
    const max = 4;
    const chips = doDia.slice(0, max).map(({ tipo, x }) => {
      const u = usuario(x.usuario_id);
      if (tipo === 'a') {
        const tit = `Ausência · ${u.nome}${x.justificativa ? '\n' + x.justificativa : ''}\n(clique para ver)`;
        return `<div class="chip aus" data-ausencia="${x.id}" style="--c:${esc(u.cor)}" title="${esc(tit)}">${esc(u.nome.split(' ')[0])} · ausência</div>`;
      }
      const tit = `Férias · ${u.nome}: ${fmt(x.inicio)} a ${fmt(x.fim)}${x.motivo ? ' · ' + x.motivo : ''}${x.observacao ? '\nObs.: ' + x.observacao : ''}\n(clique para ver)`;
      return `<div class="chip" data-ferias="${x.id}" style="--c:${esc(u.cor)}" title="${esc(tit)}">${esc(u.nome.split(' ')[0])}</div>`;
    }).join('') + (doDia.length > max ? `<div class="chip mais" title="${esc(doDia.slice(max).map(({ tipo, x }) => `${usuario(x.usuario_id).nome}${tipo === 'a' ? ' (ausência)' : ''}`).join(', '))}">+${doDia.length - max}</div>` : '');
    html += `<div class="${cls}" data-dia="${iso}"><div class="num"><span>${dt.getDate()}</span></div>
      ${ferMap.has(iso) ? `<div class="fer">${esc(ferMap.get(iso))}</div>` : ''}${chips}</div>`;
  }
  return `<div class="cal-mes">${html}</div>`;
}

function calSemestre(chave) {
  const [a] = periodoSemestre(chave); const d0 = dataDe(a);
  const fer = feriasFiltradasCal(); const aus = ausenciasFiltradasCal(); const ferMap = feriadoMap(); const hoje = st.dados.hoje;
  let html = '';
  for (let k = 0; k < 6; k++) {
    const ano = new Date(d0.getFullYear(), d0.getMonth() + k, 1).getFullYear();
    const mes = new Date(d0.getFullYear(), d0.getMonth() + k, 1).getMonth();
    const primeiro = new Date(ano, mes, 1); const nDias = new Date(ano, mes + 1, 0).getDate();
    let g = DSEM.map((s) => `<div class="dsem">${s[0]}</div>`).join('');
    for (let i = 0; i < primeiro.getDay(); i++) g += '<div></div>';
    for (let dia = 1; dia <= nDias; dia++) {
      const dt = new Date(ano, mes, dia); const iso = isoDe(dt);
      const doDia = fer.filter((f) => f.inicio <= iso && f.fim >= iso);
      const cls = ['mini-dia', dt.getDay() % 6 === 0 ? 'fds' : '', ferMap.has(iso) ? 'feriado' : '', iso === hoje ? 'hoje' : '', doDia.length ? 'ocupado' : ''].join(' ');
      const ausDia = aus.filter((a) => a.dias.includes(iso));
      const nomes = doDia.map((f) => usuario(f.usuario_id).nome);
      const nomesAus = ausDia.map((a) => usuario(a.usuario_id).nome);
      const tit = [fmt(iso), ferMap.get(iso), nomes.length ? `De férias: ${nomes.join(', ')}` : '', nomesAus.length ? `Ausência: ${nomesAus.join(', ')}` : ''].filter(Boolean).join('\n');
      const pts = doDia.slice(0, 4).map((f) => `<i style="background:${esc(usuario(f.usuario_id).cor)}"></i>`).join('')
        + ausDia.slice(0, 2).map((a) => `<i class="anel" style="border-color:${esc(usuario(a.usuario_id).cor)}"></i>`).join('');
      g += `<div class="${cls}" title="${esc(tit)}" data-irmes="${ano}-${mes}">${dia}${pts ? `<span class="pts">${pts}</span>` : ''}</div>`;
    }
    html += `<div class="caixa mini-mes"><h4 data-irmes="${ano}-${mes}">${MESES[mes]} ${ano}</h4><div class="mini-grade">${g}</div></div>`;
  }
  return `<div class="cal-semestre">${html}</div>`;
}

/* ---------------------------------------------------------------- lista de férias */
function feriasFiltradas() {
  const fl = st.filtro; const b = fl.busca.trim().toLowerCase();
  return st.dados.ferias.filter((f) => {
    if (fl.usuario && f.usuario_id !== +fl.usuario) return false;
    if (fl.semestre && !f.semestres.includes(fl.semestre)) return false;
    if (fl.situacao && f.situacao !== fl.situacao) return false;
    if (fl.ano && f.inicio.slice(0, 4) !== fl.ano && f.fim.slice(0, 4) !== fl.ano) return false;
    if (b) {
      const alvo = `${usuario(f.usuario_id).nome} ${f.motivo} ${f.observacao} ${fmt(f.inicio)} ${fmt(f.fim)}`.toLowerCase();
      if (!alvo.includes(b)) return false;
    }
    return true;
  }).sort((x, y) => y.inicio.localeCompare(x.inicio) || usuario(x.usuario_id).nome.localeCompare(usuario(y.usuario_id).nome));
}

function renderLista() {
  const d = st.dados; const fl = st.filtro;
  const anos = [...new Set(d.ferias.flatMap((f) => [f.inicio.slice(0, 4), f.fim.slice(0, 4)]))].sort().reverse();
  const sems = [...d.semestres].reverse();
  $('#view-lista').innerHTML = `
    <div class="cabecalho-view"><div class="titulo"><h2>Férias</h2><p class="sub">Todos os períodos lançados, com pesquisa e filtros</p></div>
      <button class="btn" id="btnExportarLista" title="Exporta a lista filtrada para Excel">${ICONE_BAIXAR}Exportar XLSX</button>
      ${isAdm() || d.me.participa ? '<button class="btn primario" data-acao="nova-ferias">+ Lançar férias</button>' : ''}</div>
    <div class="caixa">
      <div class="filtros">
        <label>Pesquisar<input id="fBusca" type="search" placeholder="Nome, motivo, observação ou data…" value="${esc(fl.busca)}"></label>
        <label>Usuário<select id="fUsuario">${opcoesUsuarios(fl.usuario, false, 'Todos', true)}</select></label>
        <label>Semestre<select id="fSemestre"><option value="">Todos</option>${sems.map((s) => `<option value="${s.chave}" ${fl.semestre === s.chave ? 'selected' : ''}>${esc(s.rotulo)}</option>`).join('')}</select></label>
        <label>Situação<select id="fSituacao"><option value="">Todas</option>${['Agendada', 'Em andamento', 'Gozada'].map((s) => `<option ${fl.situacao === s ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
        <label>Ano<select id="fAno"><option value="">Todos</option>${anos.map((a) => `<option ${fl.ano === a ? 'selected' : ''}>${a}</option>`).join('')}</select></label>
        <button class="btn" id="fLimpar">Limpar</button>
      </div>
      <div class="resumo-filtro" id="resumoFiltro"></div>
      <div class="tabela-wrap"><table><thead><tr><th>Usuário</th><th>Período</th><th class="num">Corridos</th><th class="num">Úteis</th><th>Semestre</th><th>Situação</th><th>Motivo</th><th>Observação</th><th></th></tr></thead>
        <tbody id="corpoLista"></tbody></table></div>
    </div>`;
  const atualizar = () => {
    const lista = feriasFiltradas();
    $('#corpoLista').innerHTML = lista.map((f) => {
      const u = usuario(f.usuario_id);
      return `<tr class="clicavel" data-ferias="${f.id}"><td><span class="ponto" style="background:${esc(u.cor)}"></span> ${esc(u.nome)}</td>
        <td class="nw">${fmt(f.inicio)} a ${fmt(f.fim)}</td><td class="num">${f.dias_corridos}</td><td class="num">${f.dias_uteis}</td>
        <td>${f.semestres.map(semRotulo).join('<br>')}</td><td><span class="selo ${f.situacao.replace(' ', '-')}">${f.situacao}</span></td>
        <td>${f.oculto ? '<span class="muted">—</span>' : esc(f.motivo)}</td><td class="texto-longo">${f.oculto ? '' : esc(f.observacao)}</td>
        <td>${f.pode_editar ? '<button class="btn mini">Editar</button>' : ''}</td></tr>`;
    }).join('') || '<tr><td colspan="9" class="vazio">Nenhum lançamento encontrado.</td></tr>';
    const tc = lista.reduce((t, f) => t + f.dias_corridos, 0); const tu = lista.reduce((t, f) => t + f.dias_uteis, 0);
    $('#resumoFiltro').innerHTML = `<span><b>${lista.length}</b> lançamento(s)</span><span><b>${tc}</b> dias corridos</span><span><b>${tu}</b> dias úteis</span>`;
    $$('#corpoLista [data-ferias]').forEach((el) => el.addEventListener('click', () => abrirFerias(+el.dataset.ferias)));
  };
  const liga = (id, campo, evento = 'change') => $(id).addEventListener(evento, (e) => { fl[campo] = e.target.value; atualizar(); });
  liga('#fBusca', 'busca', 'input'); liga('#fUsuario', 'usuario'); liga('#fSemestre', 'semestre'); liga('#fSituacao', 'situacao'); liga('#fAno', 'ano');
  $('#fLimpar').addEventListener('click', () => { Object.assign(fl, { busca: '', usuario: '', semestre: '', situacao: '', ano: '' }); renderLista(); });
  $('#btnExportarLista').addEventListener('click', () => {
    const ids = feriasFiltradas().map((f) => f.id);
    if (!ids.length) return toast('Nada para exportar com esse filtro.', 'aviso');
    window.hubFeriasExportar(`ids=${ids.join(',')}`);
  });
  atualizar();
}

/* ---------------------------------------------------------------- modal genérico */
function abrirModal(titulo, corpo, rodape) {
  const m = $('#modal');
  $('#modalCorpo').innerHTML = `<div class="modal-topo"><h3>${esc(titulo)}</h3><button class="fechar" data-fechar aria-label="Fechar">×</button></div>
    <div class="modal-corpo">${corpo}</div>${rodape ? `<div class="modal-rodape">${rodape}</div>` : ''}`;
  $$('#modalCorpo [data-fechar]').forEach((b) => b.addEventListener('click', () => m.close()));
  if (!m.open) m.showModal();
}
$('#modal').addEventListener('click', (e) => { if (e.target === e.currentTarget) e.currentTarget.close(); });

/* ---------------------------------------------------------------- formulário de férias */
function abrirFerias(id, dataInicial = '') {
  const d = st.dados;
  const f = id ? d.ferias.find((x) => x.id === id) : null;
  if (id && !f) return;
  if (f && !f.pode_editar) return verFerias(f);
  if (!f && !isAdm() && !d.me.participa) return toast('Seu usuário não participa do controle de férias.', 'aviso');
  let inicio = f?.inicio || dataInicial || '';
  if (!f && !isAdm() && inicio && inicio <= d.hoje) inicio = '';
  const uid = f?.usuario_id || (d.me.participa ? d.me.id : (+st.cal.usuario || ''));
  const campoUsuario = isAdm()
    ? `<label>Usuário<select name="usuario_id" required>${opcoesUsuarios(uid, true, 'Selecione…')}</select></label>`
    : `<label>Usuário<input value="${esc(d.me.nome)}" disabled></label><input type="hidden" name="usuario_id" value="${d.me.id}">`;
  abrirModal(f ? 'Editar férias' : 'Lançar férias', `
    <form id="formFerias" autocomplete="off">
      <div class="pilha">
        ${campoUsuario}
        <div class="linha">
          <label>Início<input type="date" name="inicio" required value="${esc(inicio)}" ${!isAdm() ? `min="${somaDias(d.hoje, 1)}"` : ''}></label>
          <label>Fim<input type="date" name="fim" required value="${esc(f?.fim || '')}"></label>
        </div>
        <div class="atalhos">Duração rápida (corridos): ${[5, 10, 15, 20, 30].map((n) => `<button type="button" class="btn mini" data-dur="${n}">${n} dias</button>`).join('')}</div>
        <div class="previa" id="previa"><span class="muted">Informe início e fim para ver a contagem de dias.</span></div>
        <label>Motivo<input name="motivo" list="listaMotivos" maxlength="200" placeholder="Ex.: Férias regulares, viagem…" value="${esc(f?.motivo || '')}"></label>
        <datalist id="listaMotivos">${d.motivos.map((m) => `<option value="${esc(m)}">`).join('')}</datalist>
        <label>Observação<textarea name="observacao" maxlength="4000" placeholder="Combinações, quem cobre as tarefas, contatos…">${esc(f?.observacao || '')}</textarea></label>
        ${f ? `<p class="nota">Lançado por ${esc(f.criado_por)} em ${fmtDH(f.criado_em)}${f.atualizado_em ? ` · alterado por ${esc(f.atualizado_por)} em ${fmtDH(f.atualizado_em)}` : ''}</p>` : ''}
        ${!isAdm() ? '<p class="nota">Você pode alterar ou excluir suas férias até a véspera do início. Depois disso, só o ADM.</p>' : ''}
      </div>
    </form>`,
  `${f ? '<button class="btn perigo" id="btnExcluirFerias">Excluir</button>' : ''}<span class="espaco"></span>
   <button class="btn" data-fechar>Cancelar</button><button class="btn primario" id="btnSalvarFerias">Salvar</button>`);

  const form = $('#formFerias');
  let temporizador; let bloqueado = false;
  const previa = async () => {
    const dados = Object.fromEntries(new FormData(form));
    if (!dados.inicio || !dados.fim || !dados.usuario_id) { $('#previa').innerHTML = '<span class="muted">Informe usuário, início e fim para ver a contagem de dias.</span>'; return; }
    try {
      const r = await api('/api/contar', { ...dados, id: f?.id || 0 });
      bloqueado = r.conflito_proprio.length > 0;
      const conta = r.modo === 'uteis' ? r.dias_uteis : r.dias_corridos;
      $('#previa').innerHTML = `<span class="grande">${plural(r.dias_corridos, 'dia corrido', 'dias corridos')} · ${plural(r.dias_uteis, 'dia útil', 'dias úteis')}</span>
        <span>Conta no saldo: <b>${conta}</b> (${modoTxt(r.modo)}) · ${r.semestres.map((s) => `${esc(s.rotulo)}: ${s.corridos} corr./${s.uteis} úteis`).join(' · ')}</span>
        ${r.feriados.length ? `<span>Feriados no período: ${r.feriados.map((x) => `${fmt(x.data).slice(0, 5)} ${esc(x.descricao)}`).join(', ')}</span>` : ''}
        <span>Saldo após este lançamento: <b class="${r.saldo_apos < 0 ? 'negativo' : 'positivo'}">${num(r.saldo_apos)}</b> ${r.saldo_apos < 0 ? '(ficará negativo)' : ''}</span>
        ${r.colegas.length ? `<span class="aviso">Também de férias no período: ${r.colegas.map(esc).join('; ')}</span>` : ''}
        ${bloqueado ? `<span class="bloqueio">Sobrepõe outras férias deste usuário: ${r.conflito_proprio.join('; ')}</span>` : ''}`;
    } catch (e) { $('#previa').innerHTML = `<span class="bloqueio">${esc(e.message)}</span>`; }
  };
  const agendaPrevia = () => { clearTimeout(temporizador); temporizador = setTimeout(previa, 250); };
  form.addEventListener('input', agendaPrevia); form.addEventListener('change', agendaPrevia);
  $$('[data-dur]', form).forEach((b) => b.addEventListener('click', () => {
    if (!form.inicio.value) return toast('Informe primeiro a data de início.', 'aviso');
    form.fim.value = somaDias(form.inicio.value, +b.dataset.dur - 1); agendaPrevia();
  }));
  form.inicio.addEventListener('change', () => { if (form.fim.value && form.fim.value < form.inicio.value) form.fim.value = form.inicio.value; });
  form.addEventListener('submit', (e) => e.preventDefault());
  if (form.inicio.value && form.fim.value) previa();

  $('#btnSalvarFerias').addEventListener('click', async () => {
    if (!form.reportValidity()) return;
    if (bloqueado) return toast('Este período se sobrepõe a outras férias do mesmo usuário.', 'erro');
    const btn = $('#btnSalvarFerias'); btn.disabled = true;
    try {
      const r = await api('/api/ferias/salvar', { ...Object.fromEntries(new FormData(form)), id: f?.id || 0 });
      $('#modal').close(); toast(f ? 'Férias alteradas.' : 'Férias lançadas.');
      r.avisos.forEach((a) => toast(a, 'aviso'));
      await carregar();
    } catch (e) { toast(e.message, 'erro'); btn.disabled = false; }
  });
  $('#btnExcluirFerias')?.addEventListener('click', async () => {
    if (!confirm(`Excluir as férias de ${usuario(f.usuario_id).nome} de ${fmt(f.inicio)} a ${fmt(f.fim)}?`)) return;
    try { await api('/api/ferias/excluir', { id: f.id }); $('#modal').close(); toast('Lançamento excluído.'); await carregar(); } catch (e) { toast(e.message, 'erro'); }
  });
}

function verFerias(f) {
  const u = usuario(f.usuario_id);
  abrirModal(`Férias · ${u.nome}`, `
    <dl class="detalhe-grade">
      <dt>Período</dt><dd>${fmt(f.inicio)} a ${fmt(f.fim)} <span class="selo ${f.situacao.replace(' ', '-')}">${f.situacao}</span></dd>
      <dt>Dias</dt><dd>${f.dias_corridos} corridos · ${f.dias_uteis} úteis</dd>
      <dt>Semestre</dt><dd>${f.semestres.map(semRotulo).join(', ')}</dd>
      ${f.oculto ? '' : `<dt>Motivo</dt><dd>${esc(f.motivo) || '<span class="muted">—</span>'}</dd><dt>Observação</dt><dd>${esc(f.observacao) || '<span class="muted">—</span>'}</dd>`}
      <dt>Lançado por</dt><dd>${esc(f.criado_por)} em ${fmtDH(f.criado_em)}</dd>
    </dl>
    ${f.usuario_id === st.dados.me.id ? '<p class="nota">Férias já iniciadas ou gozadas só podem ser alteradas pelo ADM.</p>' : ''}`,
  '<span class="espaco"></span><button class="btn" data-fechar>Fechar</button>');
}

/* ---------------------------------------------------------------- ausências */
const contarLetras = (t) => (String(t).match(/\p{L}/gu) || []).length;

function fmtDias(dias) {
  // agrupa dias seguidos: "04/11 a 06/11/2026, 10/11/2026"
  const grupos = [];
  for (const d of [...dias].sort()) {
    const g = grupos[grupos.length - 1];
    if (g && diffDias(g[1], d) === 1) g[1] = d; else grupos.push([d, d]);
  }
  return grupos.map(([a, b]) => (a === b ? fmt(a) : `${fmt(a).slice(0, 5)} a ${fmt(b)}`)).join(', ');
}

function situacaoAus(a) {
  const h = st.dados.hoje;
  if (a.dias[0] > h) return 'Futura';
  return a.dias[a.dias.length - 1] < h ? 'Passada' : 'Em curso';
}

function escolherLancamento(dia) {
  const d = st.dados;
  const podeFerias = isAdm() || (d.me.participa && dia > d.hoje);
  abrirModal(`${DSEM[dataDe(dia).getDay()]}, ${fmt(dia)}`, `
    <div class="escolha">
      ${podeFerias ? `<button class="btn primario largo" data-acao="nova-ferias" data-data="${dia}">Lançar férias a partir deste dia</button>` : ''}
      <button class="btn largo" data-acao="nova-ausencia" data-data="${dia}">⊘ Registrar ausência neste dia</button>
    </div>
    <p class="nota">Ausência não desconta do saldo de férias e exige justificativa por escrito.</p>`);
}

function feriasNoDia(uid, iso) { return st.dados.ferias.some((f) => f.usuario_id === uid && f.inicio <= iso && f.fim >= iso); }
function ausenciaNoDia(uid, iso, exceto) { return st.dados.ausencias.find((a) => a.usuario_id === uid && a.id !== exceto && a.dias.includes(iso)); }

function abrirAusencia(id, diasIniciais = []) {
  const d = st.dados;
  const a = id ? d.ausencias.find((x) => x.id === id) : null;
  if (id && !a) return;
  if (a && !a.pode_editar) return verAusencia(a);
  let uid = a?.usuario_id || (isAdm() ? (+st.cal.usuario || d.me.id) : d.me.id);
  const sel = new Set(a?.dias || diasIniciais);
  const ref = dataDe([...sel].sort()[0] || d.hoje);
  let vAno = ref.getFullYear(); let vMes = ref.getMonth();
  const minL = d.min_letras_justificativa;
  const ferMap = feriadoMap();
  const campoUsuario = isAdm()
    ? `<label>Usuário<select id="ausUsuario">${opcoesUsuarios(uid, false, null)}</select></label>`
    : `<label>Usuário<input value="${esc(d.me.nome)}" disabled></label>`;
  abrirModal(a ? 'Editar ausência' : 'Registrar ausência', `
    ${campoUsuario}
    <div>
      <div class="seletor-topo"><button type="button" class="btn mini" id="ausAnt">‹</button><b id="ausTitulo"></b><button type="button" class="btn mini" id="ausProx">›</button>
        <span class="nota">Clique nos dias para marcar/desmarcar</span></div>
      <div class="seletor-dias" id="ausGrade"></div>
    </div>
    <div class="atalhos">Intervalo: <input type="date" id="ausDe"> a <input type="date" id="ausAte">
      <button type="button" class="btn mini" id="ausAddIntervalo">Adicionar dias úteis</button>
      <button type="button" class="btn mini" id="ausLimpar">Limpar seleção</button></div>
    <div class="previa"><span id="ausSel"></span></div>
    <label>Justificativa (obrigatória — mais de ${minL - 1} letras)
      <textarea id="ausJust" maxlength="2000" placeholder="Explique o motivo da ausência (ex.: consulta médica com atestado, problema familiar…)">${esc(a?.justificativa || '')}</textarea></label>
    <span id="ausCont" class="contador"></span>
    ${a ? `<p class="nota">Registrado por ${esc(a.criado_por)} em ${fmtDH(a.criado_em)}${a.atualizado_em ? ` · alterado por ${esc(a.atualizado_por)} em ${fmtDH(a.atualizado_em)}` : ''}</p>` : ''}
    <p class="nota">Ausência não é férias: não desconta do saldo.${!isAdm() ? ' Você pode alterar ou excluir até a véspera do primeiro dia; depois, só o ADM.' : ''}</p>`,
  `${a ? '<button class="btn perigo" id="btnExcluirAus">Excluir</button>' : ''}<span class="espaco"></span>
   <button class="btn" data-fechar>Cancelar</button><button class="btn primario" id="btnSalvarAus" disabled>Salvar ausência</button>`);

  const atualizar = () => {
    const dias = [...sel].sort();
    const uteis = dias.filter((x) => dataDe(x).getDay() % 6 !== 0 && !ferMap.has(x)).length;
    $('#ausSel').innerHTML = dias.length
      ? `<b>${plural(dias.length, 'dia selecionado', 'dias selecionados')}</b> (${plural(uteis, 'útil', 'úteis')}): ${fmtDias(dias)}`
      : '<span class="muted">Nenhum dia selecionado.</span>';
    const n = contarLetras($('#ausJust').value);
    const okJust = n >= minL;
    $('#ausCont').textContent = okJust ? `${n} letras ✓` : `${n} letras — faltam ${minL - n} para poder salvar`;
    $('#ausCont').className = `contador ${okJust ? 'positivo' : 'negativo'}`;
    $('#btnSalvarAus').disabled = !(okJust && dias.length);
  };
  const desenhar = () => {
    $('#ausTitulo').textContent = `${MESES[vMes]} ${vAno}`;
    const primeiro = new Date(vAno, vMes, 1); const n = new Date(vAno, vMes + 1, 0).getDate();
    let g = DSEM.map((s) => `<div class="dsem">${s}</div>`).join('');
    for (let i = 0; i < primeiro.getDay(); i++) g += '<div></div>';
    for (let dia = 1; dia <= n; dia++) {
      const iso = isoDe(new Date(vAno, vMes, dia));
      const emFerias = feriasNoDia(uid, iso); const outra = ausenciaNoDia(uid, iso, a?.id);
      const bloq = emFerias || outra;
      const cls = ['sel-dia', sel.has(iso) ? 'sel' : '', dataDe(iso).getDay() % 6 === 0 ? 'fds' : '', ferMap.has(iso) ? 'feriado' : '', iso === d.hoje ? 'hoje' : '', bloq ? 'bloq' : ''].join(' ');
      const tit = emFerias ? 'De férias' : outra ? 'Já tem ausência registrada' : (ferMap.get(iso) || '');
      g += `<button type="button" class="${cls}" data-iso="${iso}" ${bloq ? 'disabled' : ''} title="${esc(tit)}">${dia}</button>`;
    }
    $('#ausGrade').innerHTML = g;
    $$('#ausGrade [data-iso]').forEach((b) => b.addEventListener('click', () => {
      const iso = b.dataset.iso; if (sel.has(iso)) sel.delete(iso); else sel.add(iso);
      b.classList.toggle('sel'); atualizar();
    }));
  };
  $('#ausAnt').addEventListener('click', () => { const x = new Date(vAno, vMes - 1, 1); vAno = x.getFullYear(); vMes = x.getMonth(); desenhar(); });
  $('#ausProx').addEventListener('click', () => { const x = new Date(vAno, vMes + 1, 1); vAno = x.getFullYear(); vMes = x.getMonth(); desenhar(); });
  $('#ausUsuario')?.addEventListener('change', (e) => {
    uid = +e.target.value;
    [...sel].forEach((iso) => { if (feriasNoDia(uid, iso) || ausenciaNoDia(uid, iso, a?.id)) sel.delete(iso); });
    desenhar(); atualizar();
  });
  $('#ausAddIntervalo').addEventListener('click', () => {
    const de = $('#ausDe').value; const ate = $('#ausAte').value || de;
    if (!de) return toast('Informe a data inicial do intervalo.', 'aviso');
    if (ate < de) return toast('A data final é anterior à inicial.', 'aviso');
    if (diffDias(de, ate) > 62) return toast('Intervalo grande demais (máx. 62 dias).', 'aviso');
    let pulados = 0;
    for (let iso = de; iso <= ate; iso = somaDias(iso, 1)) {
      if (dataDe(iso).getDay() % 6 === 0 || ferMap.has(iso)) continue;
      if (feriasNoDia(uid, iso) || ausenciaNoDia(uid, iso, a?.id)) { pulados++; continue; }
      sel.add(iso);
    }
    if (pulados) toast(`${pulados} dia(s) ignorado(s): férias ou ausência já registrada.`, 'aviso');
    const x = dataDe(de); vAno = x.getFullYear(); vMes = x.getMonth(); desenhar(); atualizar();
  });
  $('#ausLimpar').addEventListener('click', () => { sel.clear(); desenhar(); atualizar(); });
  $('#ausJust').addEventListener('input', atualizar);
  desenhar(); atualizar();

  $('#btnSalvarAus').addEventListener('click', async () => {
    const btn = $('#btnSalvarAus'); btn.disabled = true;
    try {
      const r = await api('/api/ausencias/salvar', { id: a?.id || 0, usuario_id: uid, dias: [...sel].sort(), justificativa: $('#ausJust').value });
      $('#modal').close(); toast(a ? 'Ausência alterada.' : 'Ausência registrada.');
      r.avisos.forEach((x) => toast(x, 'aviso'));
      await carregar();
    } catch (e) { toast(e.message, 'erro'); atualizar(); }
  });
  $('#btnExcluirAus')?.addEventListener('click', async () => {
    if (!confirm(`Excluir a ausência de ${usuario(a.usuario_id).nome} (${fmtDias(a.dias)})?`)) return;
    try { await api('/api/ausencias/excluir', { id: a.id }); $('#modal').close(); toast('Ausência excluída.'); await carregar(); } catch (e) { toast(e.message, 'erro'); }
  });
}

function verAusencia(a) {
  const u = usuario(a.usuario_id);
  abrirModal(`Ausência · ${u.nome}`, `
    <dl class="detalhe-grade">
      <dt>Dia(s)</dt><dd>${fmtDias(a.dias)} <span class="selo ${situacaoAus(a).replace(' ', '-')}">${situacaoAus(a)}</span></dd>
      <dt>Quantidade</dt><dd>${plural(a.dias.length, 'dia', 'dias')} (${plural(a.dias_uteis, 'útil', 'úteis')})</dd>
      ${a.oculto ? '' : `<dt>Justificativa</dt><dd>${esc(a.justificativa)}</dd>`}
      <dt>Registrado por</dt><dd>${esc(a.criado_por)} em ${fmtDH(a.criado_em)}</dd>
    </dl>
    ${a.usuario_id === st.dados.me.id ? '<p class="nota">Ausência que já começou só pode ser alterada pelo ADM.</p>' : ''}`,
  '<span class="espaco"></span><button class="btn" data-fechar>Fechar</button>');
}

function ausenciasFiltradas() {
  const fl = st.filtroAus; const b = fl.busca.trim().toLowerCase();
  return st.dados.ausencias.filter((a) => {
    if (fl.usuario && a.usuario_id !== +fl.usuario) return false;
    if (fl.mes && !a.dias.some((x) => x.startsWith(fl.mes))) return false;
    if (fl.situacao && situacaoAus(a) !== fl.situacao) return false;
    if (b) {
      const alvo = `${usuario(a.usuario_id).nome} ${a.justificativa} ${a.dias.map(fmt).join(' ')}`.toLowerCase();
      if (!alvo.includes(b)) return false;
    }
    return true;
  }).sort((x, y) => y.dias[0].localeCompare(x.dias[0]) || usuario(x.usuario_id).nome.localeCompare(usuario(y.usuario_id).nome));
}

function renderAusencias() {
  const d = st.dados; const fl = st.filtroAus;
  const meses = [...new Set(d.ausencias.flatMap((a) => a.dias.map((x) => x.slice(0, 7))))].sort().reverse();
  $('#view-ausencias').innerHTML = `
    <div class="cabecalho-view"><div class="titulo"><h2>Ausências</h2><p class="sub">Dias fora do escritório que não são férias — não descontam do saldo</p></div>
      <button class="btn" id="btnExportarAus" title="Exporta a lista filtrada para Excel (uma linha por dia)">${ICONE_BAIXAR}Exportar XLSX</button>
      <button class="btn primario" data-acao="nova-ausencia">+ Registrar ausência</button></div>
    <div class="caixa">
      <div class="filtros filtros-aus">
        <label>Pesquisar<input id="aBusca" type="search" placeholder="Nome, justificativa ou data…" value="${esc(fl.busca)}"></label>
        <label>Usuário<select id="aUsuario">${opcoesUsuarios(fl.usuario, false, 'Todos', true)}</select></label>
        <label>Mês<select id="aMes"><option value="">Todos</option>${meses.map((m) => `<option value="${m}" ${fl.mes === m ? 'selected' : ''}>${MESES[+m.slice(5) - 1]} ${m.slice(0, 4)}</option>`).join('')}</select></label>
        <label>Situação<select id="aSituacao"><option value="">Todas</option>${['Futura', 'Em curso', 'Passada'].map((s) => `<option ${fl.situacao === s ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
        <button class="btn" id="aLimpar">Limpar</button>
      </div>
      <div class="resumo-filtro" id="resumoAus"></div>
      <div class="tabela-wrap"><table><thead><tr><th>Usuário</th><th>Dia(s)</th><th class="num">Dias</th><th class="num">Úteis</th><th>Situação</th><th>Justificativa</th><th>Registrado</th><th></th></tr></thead>
        <tbody id="corpoAus"></tbody></table></div>
    </div>`;
  const atualizar = () => {
    const lista = ausenciasFiltradas();
    $('#corpoAus').innerHTML = lista.map((a) => {
      const u = usuario(a.usuario_id); const s = situacaoAus(a);
      return `<tr class="clicavel" data-ausencia="${a.id}"><td class="nw"><span class="ponto" style="background:${esc(u.cor)}"></span> ${esc(u.nome)}</td>
        <td>${fmtDias(a.dias)}</td><td class="num">${a.dias.length}</td><td class="num">${a.dias_uteis}</td>
        <td><span class="selo ${s.replace(' ', '-')}">${s}</span></td>
        <td class="texto-longo">${a.oculto ? '<span class="muted">—</span>' : esc(a.justificativa)}</td>
        <td class="nw muted">${esc(a.criado_por)}<br>${fmtDH(a.criado_em)}</td>
        <td>${a.pode_editar ? '<button class="btn mini">Editar</button>' : ''}</td></tr>`;
    }).join('') || '<tr><td colspan="8" class="vazio">Nenhuma ausência encontrada.</td></tr>';
    const td = lista.reduce((t, a) => t + a.dias.length, 0); const tu = lista.reduce((t, a) => t + a.dias_uteis, 0);
    $('#resumoAus').innerHTML = `<span><b>${lista.length}</b> registro(s)</span><span><b>${td}</b> dia(s)</span><span><b>${tu}</b> dia(s) útil(eis)</span>`;
    $$('#corpoAus [data-ausencia]').forEach((el) => el.addEventListener('click', () => abrirAusencia(+el.dataset.ausencia)));
  };
  const liga = (id, campo, evento = 'change') => $(id).addEventListener(evento, (e) => { fl[campo] = e.target.value; atualizar(); });
  liga('#aBusca', 'busca', 'input'); liga('#aUsuario', 'usuario'); liga('#aMes', 'mes'); liga('#aSituacao', 'situacao');
  $('#aLimpar').addEventListener('click', () => { Object.assign(fl, { busca: '', usuario: '', mes: '', situacao: '' }); renderAusencias(); });
  $('#btnExportarAus').addEventListener('click', () => {
    const ids = ausenciasFiltradas().map((a) => a.id);
    if (!ids.length) return toast('Nada para exportar com esse filtro.', 'aviso');
    window.hubFeriasExportar(`aus=${ids.join(',')}`);
  });
  atualizar();
}

/* ---------------------------------------------------------------- usuários (ADM) */
function renderUsuarios() {
  const d = st.dados;
  const linhas = d.usuarios.map((u) => {
    const r = d.resumos[u.id];
    return `<tr class="clicavel" data-usuario="${u.id}"><td><span class="ponto" style="background:${esc(u.cor)}"></span> ${esc(u.nome)}
        ${u.papel === 'ADM' ? '<span class="selo adm">ADM</span>' : ''} ${!u.ativo ? '<span class="selo inativo">inativo</span>' : ''}</td>
      <td>${esc(u.login)}</td><td>${u.participa ? 'Sim' : '<span class="muted">Não</span>'}</td>
      <td class="num">${u.participa ? num(u.dias_semestre) : '—'}</td><td>${u.participa ? modoTxt(u.modo) : '—'}</td>
      <td>${u.participa ? esc(semRotulo(u.inicio_semestre)) : '—'}</td><td class="num">${u.participa ? num(u.saldo_inicial) : '—'}</td>
      <td class="num">${r ? `<b class="${r.saldo < 0 ? 'negativo' : ''}">${num(r.saldo)}</b>` : '—'}</td>
      <td class="acoes nw"><button class="btn mini" data-editar="${u.id}">Editar</button></td></tr>`;
  }).join('');
  $('#view-usuarios').innerHTML = `
    <div class="cabecalho-view"><div class="titulo"><h2>Usuários</h2><p class="sub">Participação no controle · direito por semestre e forma de contagem do saldo · nomes e acessos vêm do cadastro do HUB</p></div></div>
    <div class="caixa"><div class="tabela-wrap"><table><thead><tr><th>Nome</th><th>E-mail</th><th>No controle</th><th class="num">Dias/semestre</th><th>Contagem</th><th>Início do controle</th><th class="num">Saldo inicial</th><th class="num">Saldo atual</th><th></th></tr></thead>
    <tbody>${linhas}</tbody></table></div>
    <p class="nota mt">Cada usuário ganha os "dias por semestre" no início de cada semestre (Inverno mai–out · Verão nov–abr), a partir do semestre de início do controle. Use o saldo inicial para trazer dias que já tinha acumulados antes.</p>
    <p class="nota">Para incluir, renomear ou desativar alguém, use o HUB: Configurações &gt; Usuários. Administradores e gestores do HUB são ADM aqui.</p></div>`;
  $$('[data-usuario]').forEach((el) => el.addEventListener('click', () => abrirUsuario(+el.dataset.usuario)));
  $$('[data-excluir-usuario]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); excluirUsuario(+b.dataset.excluirUsuario); }));
}

function excluirUsuario(id) {
  const d = st.dados; const u = d.usuarios.find((x) => x.id === id); if (!u) return;
  const nF = d.ferias.filter((f) => f.usuario_id === id).length;
  const nA = d.ausencias.filter((a) => a.usuario_id === id).length;
  abrirModal(`Excluir ${u.nome}?`, `
    <p style="margin:0">O usuário <b>${esc(u.nome)}</b> (login <b>${esc(u.login)}</b>) será apagado
      ${nF || nA ? `junto com <b>${plural(nF, 'lançamento de férias', 'lançamentos de férias')}</b> e <b>${plural(nA, 'registro de ausência', 'registros de ausência')}</b>` : '(não tem férias nem ausências lançadas)'}.</p>
    <div class="previa"><span>Antes de excluir, o app guarda automaticamente uma cópia da base inteira na pasta de backups do servidor.</span>
      ${u.ativo ? '<span><b>Quer só tirar o acesso?</b> Use "Desativar" — o histórico de férias continua no app.</span>' : ''}</div>
    <label><span>Para confirmar, digite <b>EXCLUIR</b></span><input id="confExcluir" autocomplete="off" placeholder="EXCLUIR"></label>`,
  `${u.ativo ? '<button class="btn" id="btnDesativar">Desativar em vez disso</button>' : ''}<span class="espaco"></span>
   <button class="btn" data-fechar>Cancelar</button><button class="btn perigo cheio" id="btnConfExcluir" disabled>Excluir definitivamente</button>`);
  const inp = $('#confExcluir'); inp.focus();
  inp.addEventListener('input', () => { $('#btnConfExcluir').disabled = inp.value.trim().toUpperCase() !== 'EXCLUIR'; });
  $('#btnConfExcluir').addEventListener('click', async () => {
    $('#btnConfExcluir').disabled = true;
    try {
      const r = await api('/api/usuarios/excluir', { id, confirmacao: inp.value });
      $('#modal').close(); toast(`Usuário ${u.nome} excluído. Cópia de segurança: ${r.copia}`); await carregar();
    } catch (e) { toast(e.message, 'erro'); $('#btnConfExcluir').disabled = false; }
  });
  $('#btnDesativar')?.addEventListener('click', async () => {
    try {
      await api('/api/usuarios/salvar', { ...u, ativo: false });
      $('#modal').close(); toast(`${u.nome} desativado (não entra mais; histórico mantido).`); await carregar();
    } catch (e) { toast(e.message, 'erro'); }
  });
}

function abrirUsuario(id) {
  const d = st.dados; const u = id ? d.usuarios.find((x) => x.id === id) : null;
  const cor = u?.cor || CORES[d.usuarios.length % CORES.length];
  const inicioSem = u?.inicio_semestre || d.semestre_atual.chave;
  const sems = new Set(d.semestres.map((s) => s.chave));
  for (let p = -8; p <= 1; p++) sems.add(semestreVizinho(d.semestre_atual.chave, p));
  const opSem = [...sems].sort((a, b) => (a < b ? 1 : -1)).map((c) => `<option value="${c}" ${c === inicioSem ? 'selected' : ''}>${esc(semRotulo(c))}</option>`).join('');
  abrirModal(u ? `Usuário · ${u.nome}` : 'Novo usuário', `
    <form id="formUsuario" autocomplete="off" class="pilha">
      <div class="linha"><label>Nome<input value="${esc(u?.nome || '')}" disabled></label>
        <label>E-mail<input value="${esc(u?.login || '')}" disabled></label></div>
      <div class="linha-checks">
        <label class="check"><input type="checkbox" name="participa" ${!u || u.participa ? 'checked' : ''}> Participa do controle de férias</label>
        <span class="muted">${u?.papel === 'ADM' ? 'ADM (administrador ou gestor do HUB)' : 'Usuário'}${u && !u.ativo ? ' · inativo no HUB' : ''}</span></div>
      <div class="linha3">
        <label>Dias de direito por semestre<input name="dias_semestre" type="number" min="0" max="60" step="0.5" value="${u ? u.dias_semestre : 15}"></label>
        <label>Contagem do saldo<select name="modo"><option value="corridos">Dias corridos</option><option value="uteis" ${u?.modo === 'uteis' ? 'selected' : ''}>Dias úteis</option></select></label>
        <label>Início do controle<select name="inicio_semestre">${opSem}</select></label></div>
      <div class="linha"><label>Saldo inicial (dias já acumulados)<input name="saldo_inicial" type="number" step="0.5" value="${u ? u.saldo_inicial : 0}"></label>
        <label>Cor no calendário<input type="hidden" name="cor" value="${esc(cor)}"><div class="cor-opcoes">${CORES.map((c) => `<button type="button" data-cor="${c}" class="${c === cor ? 'sel' : ''}" style="background:${c}" aria-label="cor ${c}"></button>`).join('')}</div></label></div>
      <p class="nota">Nome, e-mail, perfil e acesso são os do cadastro do HUB (Configurações &gt; Usuários).</p>
    </form>`,
  `<span class="espaco"></span>
   <button class="btn" data-fechar>Cancelar</button><button class="btn primario" id="btnSalvarUsuario">Salvar</button>`);
  $('#btnExcluirUsuario')?.addEventListener('click', () => excluirUsuario(u.id));
  const form = $('#formUsuario');
  $$('[data-cor]', form).forEach((b) => b.addEventListener('click', () => {
    $$('[data-cor]', form).forEach((x) => x.classList.remove('sel')); b.classList.add('sel'); form.cor.value = b.dataset.cor;
  }));
  form.addEventListener('submit', (e) => e.preventDefault());
  $('#btnSalvarUsuario').addEventListener('click', async () => {
    if (!form.reportValidity()) return;
    const v = Object.fromEntries(new FormData(form));
    v.participa = form.participa.checked; v.id = u?.id || 0;
    try { await api('/api/usuarios/salvar', v); $('#modal').close(); toast('Usuário salvo.'); await carregar(); } catch (e) { toast(e.message, 'erro'); }
  });
}

/* ---------------------------------------------------------------- feriados */
let anoFeriados = 0;
function renderFeriados() {
  const d = st.dados; if (!anoFeriados) anoFeriados = +d.hoje.slice(0, 4);
  const lista = d.feriados.filter((f) => f.data.startsWith(String(anoFeriados)));
  const linhas = lista.map((f) => `<tr><td>${fmt(f.data)}</td><td>${DSEM[dataDe(f.data).getDay()]}</td><td>${esc(f.descricao)}</td>
      <td>${f.origem === 'auto' ? 'Nacional' : 'Incluído'}</td>
      <td>${isAdm() ? `<label class="check"><input type="checkbox" data-ativo="${f.id}" ${f.ativo ? 'checked' : ''}> conta</label>` : (f.ativo ? 'Sim' : '<span class="muted">Não</span>')}</td>
      <td>${isAdm() && f.origem !== 'auto' ? `<button class="btn mini perigo" data-excluir="${f.id}">Excluir</button>` : ''}</td></tr>`).join('');
  $('#view-feriados').innerHTML = `
    <div class="cabecalho-view"><div class="titulo"><h2>Feriados de ${anoFeriados}</h2><p class="sub">Dias que ficam fora da contagem de dias úteis</p></div>
      <div class="grupo-nav"><button class="btn icone" data-ano="-1" aria-label="Ano anterior"><svg class="ic" viewBox="0 0 24 24"><path d="M14.5 6l-6 6 6 6"/></svg></button><button class="btn" disabled>${anoFeriados}</button><button class="btn icone" data-ano="1" aria-label="Próximo ano"><svg class="ic" viewBox="0 0 24 24"><path d="M9.5 6l6 6-6 6"/></svg></button></div>
      ${isAdm() ? '<button class="btn primario" id="btnNovoFeriado">+ Incluir feriado</button>' : ''}</div>
    <div class="caixa"><div class="tabela-wrap"><table><thead><tr><th>Data</th><th>Dia</th><th>Descrição</th><th>Origem</th><th>Conta como feriado</th><th></th></tr></thead>
      <tbody>${linhas || '<tr><td colspan="6" class="vazio">Nenhum feriado neste ano.</td></tr>'}</tbody></table></div>
      <p class="nota mt">Feriados que "contam" ficam fora da contagem de dias úteis. Os nacionais são gerados automaticamente (Carnaval e Corpus Christi incluídos — desmarque se o escritório trabalhar). Inclua os feriados municipais/estaduais.</p></div>`;
  $$('[data-ano]').forEach((b) => b.addEventListener('click', async () => {
    anoFeriados += +b.dataset.ano;
    if (isAdm() && !d.feriados.some((f) => f.data.startsWith(String(anoFeriados)) && f.origem === 'auto')) {
      try { await api('/api/feriados/ano', { ano: anoFeriados }); await carregar(); return; } catch (e) { toast(e.message, 'erro'); }
    }
    renderFeriados();
  }));
  $$('[data-ativo]').forEach((cb) => cb.addEventListener('change', async () => {
    const f = d.feriados.find((x) => x.id === +cb.dataset.ativo);
    try { await api('/api/feriados/salvar', { ...f, ativo: cb.checked }); await carregar(); } catch (e) { toast(e.message, 'erro'); cb.checked = !cb.checked; }
  }));
  $$('[data-excluir]').forEach((b) => b.addEventListener('click', async () => {
    const f = d.feriados.find((x) => x.id === +b.dataset.excluir);
    if (!confirm(`Excluir o feriado ${fmt(f.data)} – ${f.descricao}?`)) return;
    try { await api('/api/feriados/excluir', { id: f.id }); await carregar(); } catch (e) { toast(e.message, 'erro'); }
  }));
  $('#btnNovoFeriado')?.addEventListener('click', () => {
    abrirModal('Incluir feriado', `<form id="formFeriado" class="pilha">
      <div class="linha"><label>Data<input type="date" name="data" required></label><label>Descrição<input name="descricao" required maxlength="80" placeholder="Ex.: Aniversário da cidade"></label></div></form>`,
    '<span class="espaco"></span><button class="btn" data-fechar>Cancelar</button><button class="btn primario" id="btnSalvarFeriado">Salvar</button>');
    const form = $('#formFeriado'); form.addEventListener('submit', (e) => e.preventDefault());
    $('#btnSalvarFeriado').addEventListener('click', async () => {
      if (!form.reportValidity()) return;
      try {
        await api('/api/feriados/salvar', { data: form.data.value, descricao: form.descricao.value, ativo: true });
        anoFeriados = +form.data.value.slice(0, 4); $('#modal').close(); toast('Feriado incluído.'); await carregar();
      } catch (e) { toast(e.message, 'erro'); }
    });
  });
}

/* ---------------------------------------------------------------- senha */
function abrirTrocaSenha() {
  abrirModal('Trocar senha', `<form id="formSenha" class="pilha">
    <label>Senha atual<input type="password" name="atual" required autocomplete="current-password"></label>
    <label>Nova senha (mín. 6)<input type="password" name="nova" minlength="6" required autocomplete="new-password"></label>
    <label>Repita a nova senha<input type="password" name="nova2" minlength="6" required autocomplete="new-password"></label></form>`,
  '<span class="espaco"></span><button class="btn" data-fechar>Cancelar</button><button class="btn primario" id="btnSalvarSenha">Salvar</button>');
  const form = $('#formSenha'); form.addEventListener('submit', (e) => e.preventDefault());
  $('#btnSalvarSenha').addEventListener('click', async () => {
    if (!form.reportValidity()) return;
    if (form.nova.value !== form.nova2.value) return toast('As novas senhas não conferem.', 'erro');
    try { await api('/api/senha', { atual: form.atual.value, nova: form.nova.value }); $('#modal').close(); toast('Senha alterada.'); } catch (e) { toast(e.message, 'erro'); }
  });
}

iniciar();
