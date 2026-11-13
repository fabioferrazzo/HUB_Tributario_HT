(() => {
  'use strict';

  const APP_VERSION = '2.1.0';
  const ROLE_ADMIN = 'admin';
  const ROLE_VIEWER = 'viewer';
  const PREF_PREFIX = 'HTCarteiraClientesV2';
  const ACCESS_SESSION_KEY = `${PREF_PREFIX}:tab-authenticated`;
  const FRESH_LOGIN_PARAM = 'fresh';

  const REGIME_OPTIONS = ['Simples', 'LP', 'LR', 'Assoc.', 'Coop.', 'Produtor'];
  const HONORARIOS_FILTER_OPTIONS = ['Em dia', 'Em atraso', 'Bloqueado', 'Não cliente'];
  const SITUACAO_FILTER_OPTIONS = ['Ativa', 'Inativa', 'S. mov.', 'Não cliente'];

  const FIELDS = [
    { key: 'empresa', server: 'empresa', label: 'Empresa' },
    { key: 'cnpj', server: 'cnpj', label: 'CNPJ' },
    { key: 'dominio', server: 'dominio', label: 'Domínio' },
    { key: 'responsavelFiscal', server: 'responsavel_fiscal', label: 'Responsável Fiscal' },
    { key: 'responsavelContabil', server: 'responsavel_contabil', label: 'Responsável Contábil' },
    { key: 'responsavelDeptoPessoal', server: 'responsavel_depto_pessoal', label: 'Responsável Depto Pessoal' },
    { key: 'regime', server: 'regime', label: 'Regime' },
    { key: 'socios', server: 'socios', label: 'Sócios' },
    { key: 'fone', server: 'fone', label: 'Fone' },
    { key: 'email', server: 'email', label: 'E-mail' },
    { key: 'honorarios', server: 'honorarios', label: 'Honorários' },
    { key: 'situacao', server: 'situacao', label: 'Situação' },
    { key: 'obs', server: 'obs', label: 'Obs.' }
  ];

  const DEFAULT_COLUMN_ORDER = FIELDS.map(f => f.key);
  const DEFAULT_COLUMN_WIDTHS = {
    empresa: 320, cnpj: 170, dominio: 110,
    responsavelFiscal: 180, responsavelContabil: 190, responsavelDeptoPessoal: 210,
    regime: 110, socios: 250, fone: 145, email: 250,
    honorarios: 135, situacao: 130, obs: 330
  };
  const MIN_COLUMN_WIDTHS = {
    empresa: 160, cnpj: 110, dominio: 80,
    responsavelFiscal: 125, responsavelContabil: 135, responsavelDeptoPessoal: 150,
    regime: 85, socios: 130, fone: 100, email: 145,
    honorarios: 105, situacao: 100, obs: 160
  };

  const state = {
    user: null,
    health: null,
    periods: [],
    periodKey: null,
    periodExists: false,
    periodMeta: null,
    records: [],
    filteredRecords: [],
    filters: {},
    sort: { field: 'empresa', dir: 'asc' },
    currentView: 'carteira',
    dashboardPeriodKey: null,
    dashboardFilters: { document: '', situation: '', regime: '', honorarios: '' },
    auditPeriodKey: null,
    auditFilters: { user: '', action: '', search: '' },
    columnWidths: { ...DEFAULT_COLUMN_WIDTHS },
    columnOrder: [...DEFAULT_COLUMN_ORDER],
    dragField: null,
    justDragged: false,
    recordCache: new Map(),
    auditCache: new Map(),
    connectionOk: false,
    originalRecords: new Map(),
    dirtyFields: new Map(),
    pendingInserts: new Map(),
    pendingDeletes: new Map(),
    nextTempId: -1,
    saveInProgress: false
  };

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  document.addEventListener('DOMContentLoaded', init);

  function consumeFreshLoginRequest() {
    try {
      const url = new URL(window.location.href);
      const requested = url.searchParams.get(FRESH_LOGIN_PARAM) === '1';
      if (!requested) return false;
      sessionStorage.removeItem(ACCESS_SESSION_KEY);
      url.searchParams.delete(FRESH_LOGIN_PARAM);
      const cleanUrl = `${url.pathname}${url.search}${url.hash}` || '/';
      window.history.replaceState(null, '', cleanUrl);
      return true;
    } catch (_) {
      return false;
    }
  }

  function tabHasAuthenticatedAccess() {
    try {
      return sessionStorage.getItem(ACCESS_SESSION_KEY) === '1';
    } catch (_) {
      return false;
    }
  }

  function markTabAuthenticated() {
    try { sessionStorage.setItem(ACCESS_SESSION_KEY, '1'); } catch (_) {}
  }

  function clearTabAuthenticated() {
    try { sessionStorage.removeItem(ACCESS_SESSION_KEY); } catch (_) {}
  }

  async function init() {
    bindEvents();
    prepareStage04WriteControls();
    renderTableStructure();
    const freshLoginRequested = consumeFreshLoginRequest();
    try {
      state.health = await api('/api/health');
      state.connectionOk = true;

      // Nova abertura do app sempre começa pela tela de login.
      // O marcador existe apenas nesta aba e sobrevive a F5, evitando
      // reautenticacao durante o uso normal da mesma sessao de trabalho.
      if (freshLoginRequested || !tabHasAuthenticatedAccess()) {
        state.user = null;
        showLogin();
        return;
      }

      const me = await api('/api/me', { allow401: true });
      if (me && me.ok) {
        state.user = me.user;
        await showApp();
      } else {
        clearTabAuthenticated();
        showLogin();
      }
    } catch (err) {
      showFatal(err);
    }
  }

  async function api(path, options = {}) {
    const init = {
      method: options.method || 'GET',
      headers: { 'Accept': 'application/json' },
      credentials: 'same-origin'
    };
    if (options.body !== undefined) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(options.body);
    }
    let response;
    try {
      response = await fetch(path, init);
    } catch (err) {
      state.connectionOk = false;
      throw new Error('Não foi possível conectar ao servidor SQLite. Confirme se o servidor está aberto e a rede está disponível.');
    }
    let payload = null;
    const text = await response.text();
    if (text) {
      try { payload = JSON.parse(text); } catch (_) { payload = { ok: false, message: text }; }
    }
    if (response.status === 401 && options.allow401) return null;
    if (!response.ok) {
      const error = new Error((payload && (payload.message || payload.error)) || `Erro HTTP ${response.status}`);
      error.status = response.status;
      error.details = payload && payload.details;
      throw error;
    }
    state.connectionOk = true;
    return payload || { ok: true };
  }

  function showFatal(err) {
    console.error(err);
    document.body.innerHTML = `
      <div style="padding:32px;font-family:Segoe UI,Arial;color:#8b1f1f">
        <h2>Não foi possível conectar à Carteira de Clientes</h2>
        <p>${escapeHtml(err && err.message ? err.message : String(err))}</p>
        <p>Esta V2 precisa ser aberta pelo endereço do servidor, por exemplo <strong>http://127.0.0.1:8787</strong> ou pelo IP da máquina servidor.</p>
      </div>`;
  }

  function bindEvents() {
    $('#loginForm').addEventListener('submit', onLogin);
    $('#btnLogout').addEventListener('click', logout);
    $('#btnMyPassword').addEventListener('click', openChangePasswordModal);
    $('#btnUsers').addEventListener('click', () => openUsersModal().catch(handleUiError));
    $('#btnMigrationStatus').addEventListener('click', () => openMigrationStatus().catch(handleUiError));

    $('#btnTabCarteira').addEventListener('click', () => switchView('carteira'));
    $('#btnTabDashboard').addEventListener('click', () => switchView('dashboard').catch(handleUiError));
    $('#btnTabAudit').addEventListener('click', () => switchView('auditoria').catch(handleUiError));

    $('#monthSelect').addEventListener('change', () => onPeriodSelectorChange().catch(handleUiError));
    $('#yearSelect').addEventListener('change', () => onPeriodSelectorChange().catch(handleUiError));
    $('#globalSearch').addEventListener('input', renderFiltered);
    $('#btnClearSearch').addEventListener('click', () => { $('#globalSearch').value = ''; renderFiltered(); });
    $('#btnSave').addEventListener('click', () => savePendingChanges().catch(handleUiError));
    $('#btnCreatePeriod').addEventListener('click', () => createNextPeriod().catch(handleUiError));
    $('#btnAddRow').addEventListener('click', addCompanyRow);
    $('#btnExport').addEventListener('click', () => exportCurrentXlsx().catch(handleUiError));
    $('#fileImport').addEventListener('change', event => onImportXlsxSelected(event).catch(handleUiError));
    $('#btnClearFilters').addEventListener('click', clearFilters);
    $('#btnResetColumnWidths').addEventListener('click', resetColumnWidths);
    $('#btnResetColumnOrder').addEventListener('click', resetColumnOrder);

    $('#dashboardMonthSelect').addEventListener('change', () => onDashboardPeriodChange().catch(handleUiError));
    $('#dashboardYearSelect').addEventListener('change', () => onDashboardPeriodChange().catch(handleUiError));
    $('#dashboardDocumentFilter').addEventListener('change', onDashboardFilterChange);
    $('#dashboardSituationFilter').addEventListener('change', onDashboardFilterChange);
    $('#dashboardRegimeFilter').addEventListener('change', onDashboardFilterChange);
    $('#dashboardHonorariosFilter').addEventListener('change', onDashboardFilterChange);
    $('#btnDashboardClearFilters').addEventListener('click', clearDashboardFilters);
    $('#dashboardKpis').addEventListener('click', onDashboardKpiClick);
    $('#dashboardRegimeGrid').addEventListener('click', onDashboardRegimeClick);

    $('#auditMonthSelect').addEventListener('change', () => onAuditPeriodChange().catch(handleUiError));
    $('#auditYearSelect').addEventListener('change', () => onAuditPeriodChange().catch(handleUiError));
    $('#auditUserFilter').addEventListener('change', onAuditFilterChange);
    $('#auditActionFilter').addEventListener('change', onAuditFilterChange);
    $('#auditSearch').addEventListener('input', onAuditFilterChange);
    $('#btnAuditClearFilters').addEventListener('click', clearAuditFilters);

    $$('[data-close-modal]').forEach(el => el.addEventListener('click', closeModal));
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
    window.addEventListener('beforeunload', e => {
      if (!hasPendingChanges()) return;
      e.preventDefault();
      e.returnValue = '';
    });
  }

  function prepareStage04WriteControls() {
    const create = $('#btnCreatePeriod');
    if (create) {
      create.classList.remove('hidden');
      create.title = 'Criar a próxima competência copiando a relação atual.';
    }
    const add = $('#btnAddRow');
    if (add) add.title = 'Adicionar uma empresa à competência atual.';
    const exportBtn = $('#btnExport');
    if (exportBtn) exportBtn.title = 'Exportar toda a competência selecionada para XLSX.';
    const importLabel = document.querySelector('label[for="fileImport"]');
    if (importLabel) {
      importLabel.classList.remove('stage-disabled');
      importLabel.title = 'Importar XLSX e substituir integralmente os dados da competência selecionada.';
    }
    $('#fileImport').disabled = false;
    updateWriteButtons();
  }

  function updateWriteButtons() {
    const save = $('#btnSave');
    const create = $('#btnCreatePeriod');
    const add = $('#btnAddRow');
    const exportBtn = $('#btnExport');
    const importInput = $('#fileImport');
    const importLabel = document.querySelector('label[for="fileImport"]');
    const periodOpen = !!(state.periodExists && state.periodMeta && state.periodMeta.status === 'open');
    const admin = isAdminUser();
    const pending = hasPendingChanges();

    if (save) {
      const canSave = admin && periodOpen && pending && !state.saveInProgress;
      save.disabled = !canSave;
      if (!admin) save.title = 'Somente usuários ADM podem gravar alterações.';
      else if (!periodOpen) save.title = 'A competência atual não está aberta para edição.';
      else if (state.saveInProgress) save.title = 'Salvamento em andamento.';
      else if (!pending) save.title = 'Nenhuma alteração pendente.';
      else save.title = 'Salvar alterações pendentes no banco do HUB.';
    }
    if (create) create.disabled = !admin || !state.periodExists || pending || state.saveInProgress;
    if (add) add.disabled = !admin || !periodOpen || state.saveInProgress;
    if (exportBtn) {
      exportBtn.disabled = !admin || !state.periodExists || pending || state.saveInProgress;
      exportBtn.title = pending ? 'Salve as alterações pendentes antes de exportar.' : 'Exportar toda a competência selecionada para XLSX.';
    }
    if (importInput) importInput.disabled = !admin || !periodOpen || pending || state.saveInProgress;
    if (importLabel) {
      const disabled = !admin || !periodOpen || pending || state.saveInProgress;
      importLabel.classList.toggle('stage-disabled', disabled);
      importLabel.title = disabled
        ? (pending ? 'Salve as alterações pendentes antes de importar.' : 'Importação disponível somente para ADM em competência aberta.')
        : 'Importar XLSX e substituir integralmente os dados desta competência.';
    }
  }

  function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunk, bytes.length)));
    }
    return btoa(binary);
  }

  async function exportCurrentXlsx() {
    if (!isAdminUser()) return toast('Exportação XLSX disponível somente para ADM.', 'error');
    if (!state.periodExists) return toast('Selecione uma competência existente.', 'error');
    if (hasPendingChanges()) return toast('Salve as alterações pendentes antes de exportar o XLSX.', 'warning');
    const key = state.periodKey;
    const response = await fetch(`/api/periods/${encodeURIComponent(key)}/export-xlsx`, {
      method: 'GET', credentials: 'same-origin'
    });
    if (!response.ok) {
      let message = `Falha ao exportar XLSX (HTTP ${response.status}).`;
      try {
        const payload = await response.json();
        message = payload.error || payload.message || message;
      } catch (_) {}
      throw new Error(message);
    }
    const blob = await response.blob();
    const disposition = response.headers.get('Content-Disposition') || '';
    const match = disposition.match(/filename="?([^";]+)"?/i);
    const filename = match ? match[1] : `Carteira_Clientes_${key}.xlsx`;
    const url = URL.createObjectURL(blob);
    try {
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    toast(`Competência ${displayPeriod(key)} exportada para XLSX.`, 'success');
  }

  async function onImportXlsxSelected(event) {
    const input = event && event.target ? event.target : $('#fileImport');
    const file = input && input.files ? input.files[0] : null;
    if (!file) return;
    if (!isAdminUser()) {
      input.value = '';
      return toast('Importação XLSX disponível somente para ADM.', 'error');
    }
    if (!state.periodExists || !(state.periodMeta && state.periodMeta.status === 'open')) {
      input.value = '';
      return toast('Selecione uma competência existente e aberta para importar.', 'error');
    }
    if (hasPendingChanges()) {
      input.value = '';
      return toast('Salve ou descarte as alterações pendentes antes de importar.', 'warning');
    }
    if (!/\.xlsx$/i.test(file.name || '')) {
      input.value = '';
      return toast('Selecione um arquivo XLSX.', 'error');
    }
    if (file.size > 10_000_000) {
      input.value = '';
      return toast('O XLSX deve ter no máximo 10 MB.', 'error');
    }

    const key = state.periodKey;
    const currentCount = state.records.length;
    openModal({
      title: 'Importar XLSX',
      body: `
        <div class="danger-box"><strong>Atenção:</strong> ao concluir a importação, os dados da competência <strong>${escapeHtml(displayPeriod(key))}</strong> serão sobrescritos integralmente pelos dados do arquivo <strong>${escapeHtml(file.name)}</strong>.</div>
        <p>Registros atuais no período: <strong>${currentCount}</strong>.</p>
        <p>O XLSX deve conter as 13 colunas da Carteira. Colunas extras serão ignoradas. A auditoria já existente será preservada e a importação será registrada.</p>
        <p>Se quiser uma cópia do período atual antes da substituição, cancele e use <strong>Exportar XLSX</strong>.</p>`,
      actions: [
        { label: 'Cancelar', className: 'btn secondary', onClick: () => { input.value = ''; closeModal(); } },
        { label: 'Sobrescrever e importar', className: 'btn danger', onClick: async () => {
          closeModal();
          try {
            const buffer = await file.arrayBuffer();
            const result = await api(`/api/periods/${encodeURIComponent(key)}/import-xlsx`, {
              method: 'POST',
              body: { filename: file.name, data_base64: arrayBufferToBase64(buffer) }
            });
            state.recordCache.delete(key);
            state.auditCache.delete(key);
            await loadPeriod(key);
            toast(`Importação concluída: ${result.imported_records} empresa(s) carregada(s) em ${displayPeriod(key)}.`, 'success');
          } catch (err) {
            handleUiError(err);
          } finally {
            input.value = '';
          }
        }}
      ]
    });
  }

  function nextPeriodKey(key) {
    if (!/^\d{4}-\d{2}$/.test(key || '')) return '';
    let [year, month] = key.split('-').map(Number);
    month += 1;
    if (month > 12) { month = 1; year += 1; }
    return periodKey(year, month);
  }

  async function createNextPeriod() {
    if (!isAdminUser() || !state.periodExists) return;
    if (hasPendingChanges()) {
      toast('Salve ou descarte as alterações pendentes antes de criar nova competência.', 'warning');
      return;
    }
    const source = state.periodKey;
    const suggested = nextPeriodKey(source);
    const target = window.prompt('Nova competência (AAAA-MM):', suggested);
    if (target == null) return;
    const key = String(target).trim();
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(key)) {
      toast('Competência inválida. Use AAAA-MM, por exemplo 2026-10.', 'error');
      return;
    }
    if (!window.confirm(`Criar ${displayPeriod(key)} copiando as empresas de ${displayPeriod(source)}?`)) return;
    const result = await api('/api/periods', {
      method: 'POST',
      body: { period_key: key, source_period_key: source }
    });
    state.recordCache.clear();
    state.auditCache.clear();
    await refreshPeriods();
    await loadPeriod(key);
    setSelectorToKey('#monthSelect', '#yearSelect', key);
    toast(`Competência ${displayPeriod(key)} criada com ${result.copied_records || 0} empresa(s).`, 'success');
  }

  function addCompanyRow() {
    if (!isAdminUser() || !(state.periodExists && state.periodMeta && state.periodMeta.status === 'open')) return;
    state.filters = {};
    $('#globalSearch').value = '';
    const rec = createPendingInsert({});
    renderTableStructure();
    renderFiltered();
    setTimeout(() => {
      const input = document.querySelector(`tr[data-id="${rec.id}"] .cell-input[data-field="empresa"]`);
      if (input) input.focus();
    }, 0);
  }

  function requestDeleteRow(rec) {
    if (!isAdminUser() || !rec) return;
    const label = String(rec.empresa || '').trim() || 'linha sem nome';
    if (!window.confirm(`Excluir "${label}" desta competência? A exclusão só será efetivada ao clicar em Salvar.`)) return;
    if (!markPendingDelete(rec.id)) return;
    renderFiltered();
    toast('Empresa marcada para exclusão. Clique em Salvar para confirmar.', 'warning');
  }

  async function openMigrationStatus() {
    // HUB: importa a base da V2 (backup .sqlite3 do HTSERVER) para o banco do HUB.
    if (!(state.user && state.user.role === ROLE_ADMIN)) return;
    const status = await api('/api/migration/status');
    const c = status.counts || {};
    const migrated = !!status.completed;
    const history = status.history || {};
    const hasData = Number(c.periods || 0) > 0 || Number(c.audit || 0) > 0;
    openModal({
      title: 'Base da Carteira V2 → HUB',
      body: `
        <div class="info-box"><strong>${migrated ? 'Base da V2 importada para o HUB.' : 'A base da V2 ainda não foi importada para o HUB.'}</strong></div>
        <p>Banco do HUB: <strong>${escapeHtml(String(c.periods || 0))}</strong> competência(s), <strong>${escapeHtml(String(c.records || 0))}</strong> registro(s) e <strong>${escapeHtml(String(c.audit || 0))}</strong> linha(s) de auditoria.</p>
        ${migrated ? `<p>Arquivo importado: <strong>${escapeHtml(history.arquivo || '—')}</strong> em <strong>${escapeHtml(formatDateTime(history.imported_at) || '—')}</strong>.</p><p>SHA-256 do arquivo: <code>${escapeHtml(history.arquivo_sha256 || '—')}</code></p>` : ''}
        <p>Para trazer os dados da V2: no servidor (HTSERVER), rode <strong>03_BACKUP_BANCO.bat</strong> na pasta da Carteira V2 e copie para este computador o arquivo <code>carteira_AAAAMMDD_HHMMSS.sqlite3</code> criado em <code>backups</code>. Depois selecione o arquivo abaixo.</p>
        <div class="field"><label for="hubBaseV2File">Backup da Carteira V2 (.sqlite3)</label><input id="hubBaseV2File" type="file" accept=".sqlite3,.sqlite,.db"></div>
        ${hasData ? `<div class="danger-box" style="margin-top:10px"><label style="display:flex;gap:8px;align-items:flex-start"><input id="hubBaseV2Replace" type="checkbox"> <span><strong>Substituir</strong> todas as competências, empresas e auditoria que já estão no HUB pelos dados do arquivo.</span></label></div>` : ''}
        <p id="hubBaseV2Progress" class="hidden" style="margin-top:10px"></p>`,
      actions: [
        { label: 'Fechar', className: 'btn secondary', onClick: closeModal },
        { label: 'Importar para o HUB', className: 'btn primary', onClick: async (event) => {
          const file = ($('#hubBaseV2File').files || [])[0];
          if (!file) return toast('Selecione o backup .sqlite3 da Carteira V2.', 'error');
          const replace = !!($('#hubBaseV2Replace') && $('#hubBaseV2Replace').checked);
          if (hasData && !replace) return toast('O HUB já tem dados da Carteira. Marque "Substituir" para importar de novo.', 'warning');
          if (hasPendingChanges()) return toast('Salve ou descarte as alterações pendentes antes de importar.', 'warning');
          const button = event && event.currentTarget;
          if (button) button.disabled = true;
          const progress = $('#hubBaseV2Progress');
          progress.classList.remove('hidden');
          try {
            const counts = await window.HubCarteira.importarBaseV2(file, { substituir: replace, progresso: text => { progress.textContent = text; } });
            closeModal();
            state.recordCache.clear();
            state.auditCache.clear();
            resetEditingState();
            await refreshPeriods();
            toast(`Base da V2 importada: ${counts.periods} competência(s), ${counts.records} registro(s) e ${counts.audit} linha(s) de auditoria.`, 'success');
          } catch (err) {
            progress.textContent = (err && err.message) || 'Falha ao importar.';
            toast(err && err.message ? err.message : 'Falha ao importar a base da V2.', 'error');
          } finally {
            if (button) button.disabled = false;
          }
        }}
      ]
    });
  }

  function handleUiError(err) {
    console.error(err);
    renderNetworkNotice('Falha de comunicação com o servidor. Nenhum dado local substitui a base central.');
    toast(err && err.message ? err.message : 'Falha de comunicação com o servidor.', 'error');
  }

  async function onLogin(e) {
    e.preventDefault();
    const username = $('#loginUser').value.trim();
    const password = $('#loginPassword').value;
    const error = $('#loginError');
    error.classList.add('hidden');
    try {
      const result = await api('/api/login', { method: 'POST', body: { username, password } });
      state.user = result.user;
      markTabAuthenticated();
      $('#loginPassword').value = '';
      await showApp();
    } catch (err) {
      error.textContent = err.message || 'Falha no login.';
      error.classList.remove('hidden');
    }
  }

  async function logout() {
    if (!confirmDiscardPending('sair do app')) return;
    clearTabAuthenticated();
    try { await api('/api/logout', { method: 'POST', body: {} }); } catch (_) {}
    resetEditingState();
    state.user = null;
    state.periods = [];
    state.records = [];
    state.recordCache.clear();
    state.auditCache.clear();
    $('#appShell').classList.add('hidden');
    $('#appShell').setAttribute('aria-hidden', 'true');
    showLogin();
  }

  function showLogin() {
    $('#loginScreen').classList.remove('hidden');
    $('#appShell').classList.add('hidden');
    $('#appShell').setAttribute('aria-hidden', 'true');
    setTimeout(() => $('#loginUser').focus(), 0);
  }

  async function showApp() {
    $('#loginScreen').classList.add('hidden');
    $('#appShell').classList.remove('hidden');
    $('#appShell').setAttribute('aria-hidden', 'false');
    applyRoleVisibility();
    await loadVisualPreferences();
    renderTableStructure();
    setupHorizontalScrollMirror();
    await refreshPeriods();
    renderNetworkNotice();
    switchView('carteira');
  }

  function applyRoleVisibility() {
    const isAdmin = state.user && state.user.role === ROLE_ADMIN;
    $$('.admin-only').forEach(el => el.classList.toggle('hidden', !isAdmin));

    // MVP interno: usuario comum visualiza somente a Carteira.
    // Totalizador e Auditoria sao ferramentas exclusivas do ADM.
    ['btnTabDashboard', 'btnTabAudit'].forEach(id => {
      const tab = $('#' + id);
      if (!tab) return;
      tab.classList.toggle('hidden', !isAdmin);
      tab.setAttribute('aria-hidden', isAdmin ? 'false' : 'true');
      tab.tabIndex = isAdmin ? 0 : -1;
    });

    $('#btnUsers').disabled = !isAdmin;
    updateWriteButtons();
    const roleLabel = isAdmin ? 'ADM · HUB' : 'Consulta · HUB';
    $('#sessionBadge').textContent = `${state.user.username} · ${roleLabel}`;
  }

  function renderNetworkNotice(extra = '') {
    const panel = $('#noticePanel');
    if (!panel) return;

    // Etapa 03.2: nao exibir faixa informativa permanente no uso normal.
    // Alertas operacionais continuam visiveis quando ha algo que exige atencao.
    const message = String(extra || '').trim();
    const routineLoad = /^Competência .+ carregada do servidor/i.test(message);
    if (!message || routineLoad) {
      panel.innerHTML = '';
      panel.classList.add('hidden');
      return;
    }

    panel.classList.remove('hidden');
    panel.textContent = message;
  }

  async function refreshPeriods() {
    const response = await api('/api/periods');
    state.periods = (response.periods || []).map(p => ({
      id: p.period_key,
      year: p.year,
      month: p.month,
      status: p.status,
      sourcePeriodKey: p.source_period_key || '',
      createdAt: p.created_at,
      createdBy: p.created_by,
      updatedAt: p.updated_at
    }));
    populateAllPeriodSelectors();
    const now = new Date();
    const currentKey = periodKey(now.getFullYear(), now.getMonth() + 1);
    const keys = new Set(state.periods.map(p => p.id));
    let initial = keys.has(currentKey) ? currentKey : (state.periods[0] ? state.periods[0].id : currentKey);
    state.periodKey = initial;
    state.dashboardPeriodKey = initial;
    state.auditPeriodKey = initial;
    setSelectorToKey('#monthSelect', '#yearSelect', initial);
    setSelectorToKey('#dashboardMonthSelect', '#dashboardYearSelect', initial);
    setSelectorToKey('#auditMonthSelect', '#auditYearSelect', initial);
    await loadPeriod(initial);
  }

  function populateAllPeriodSelectors() {
    const now = new Date();
    const years = new Set([now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1]);
    state.periods.forEach(p => years.add(Number(p.year)));
    const sortedYears = Array.from(years).filter(Number.isFinite).sort((a, b) => a - b);
    const monthHtml = Array.from({ length: 12 }, (_, i) => `<option value="${i + 1}">${String(i + 1).padStart(2, '0')}</option>`).join('');
    const yearHtml = sortedYears.map(y => `<option value="${y}">${y}</option>`).join('');
    ['monthSelect', 'dashboardMonthSelect', 'auditMonthSelect'].forEach(id => $('#' + id).innerHTML = monthHtml);
    ['yearSelect', 'dashboardYearSelect', 'auditYearSelect'].forEach(id => $('#' + id).innerHTML = yearHtml);
  }

  function setSelectorToKey(monthSel, yearSel, key) {
    const [y, m] = key.split('-');
    $(yearSel).value = y;
    $(monthSel).value = String(Number(m));
  }

  function periodKey(year, month) {
    return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
  }

  function displayPeriod(key) {
    if (!/^\d{4}-\d{2}$/.test(key || '')) return key || '';
    const [y, m] = key.split('-');
    return `${m}/${y}`;
  }

  async function onPeriodSelectorChange() {
    const key = periodKey(Number($('#yearSelect').value), Number($('#monthSelect').value));
    if (key === state.periodKey) return;
    if (!confirmDiscardPending(`trocar para a competência ${displayPeriod(key)}`)) {
      if (state.periodKey) setSelectorToKey('#monthSelect', '#yearSelect', state.periodKey);
      return;
    }
    await loadPeriod(key);
  }

  async function loadPeriod(key) {
    state.periodKey = key;
    $('#periodChip').textContent = `Competência ${displayPeriod(key)}`;
    const meta = state.periods.find(p => p.id === key) || null;
    state.periodExists = !!meta;
    state.periodMeta = meta;
    state.filters = {};
    $('#globalSearch').value = '';
    if (!meta) {
      resetEditingState();
      state.records = [];
      state.filteredRecords = [];
      renderTableStructure();
      renderTable([]);
      $('#recordCount').textContent = '0';
      $('#saveState').textContent = 'Competência não cadastrada';
      renderNetworkNotice(`A competência ${displayPeriod(key)} ainda não existe no servidor.`);
      return;
    }
    const records = await fetchRecords(key, true);
    state.records = records;
    initializeEditingState(records);
    updateFilterOptions();
    renderFiltered();
    updatePendingIndicator();
    renderNetworkNotice(`Competência ${displayPeriod(key)} carregada do servidor · ${records.length} registros.`);
  }

  async function fetchRecords(key, force = false) {
    if (!force && state.recordCache.has(key)) return clone(state.recordCache.get(key));
    const response = await api(`/api/periods/${encodeURIComponent(key)}/records?limit=2000`);
    const records = (response.records || []).map(fromServerRecord);
    state.recordCache.set(key, records);
    if (state.periodKey === key && response.period) {
      state.periodMeta = {
        id: response.period.period_key,
        year: response.period.year,
        month: response.period.month,
        status: response.period.status,
        sourcePeriodKey: response.period.source_period_key || '',
        createdAt: response.period.created_at,
        createdBy: response.period.created_by,
        updatedAt: response.period.updated_at
      };
    }
    return clone(records);
  }

  function fromServerRecord(r) {
    const rec = {
      id: Number(r.id),
      recordKey: r.record_key || '',
      rowOrder: Number(r.row_order || 0),
      version: Number(r.version || 1),
      createdAt: r.created_at || '',
      updatedAt: r.updated_at || '',
      updatedBy: r.updated_by || ''
    };
    FIELDS.forEach(f => { rec[f.key] = r[f.server] == null ? '' : String(r[f.server]); });
    return rec;
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function isAdminUser() {
    return !!(state.user && state.user.role === ROLE_ADMIN);
  }

  function initializeEditingState(records) {
    state.originalRecords = new Map();
    state.dirtyFields = new Map();
    state.pendingInserts = new Map();
    state.pendingDeletes = new Map();
    state.nextTempId = -1;
    (records || []).forEach(rec => state.originalRecords.set(String(rec.id), clone(rec)));
    updatePendingIndicator();
  }

  function resetEditingState() {
    state.originalRecords = new Map();
    state.dirtyFields = new Map();
    state.pendingInserts = new Map();
    state.pendingDeletes = new Map();
    state.nextTempId = -1;
    updatePendingIndicator();
  }

  function pendingChangeCount() {
    let count = 0;
    state.dirtyFields.forEach(fields => { count += fields.size; });
    count += state.pendingInserts.size;
    count += state.pendingDeletes.size;
    return count;
  }

  function hasPendingChanges() {
    return pendingChangeCount() > 0;
  }

  function confirmDiscardPending(actionLabel) {
    if (!hasPendingChanges()) return true;
    return window.confirm(`Há ${pendingChangeCount()} alteração(ões) local(is) ainda não salvas. Deseja descartá-las e ${actionLabel}?`);
  }

  function updatePendingIndicator() {
    const el = $('#saveState');
    if (!el) return;
    const count = pendingChangeCount();
    el.classList.toggle('pending', count > 0);
    if (count > 0) {
      el.textContent = `${count} alteração(ões) pendente(s) · ainda não gravadas`;
      updateWriteButtons();
      return;
    }
    if (state.periodExists) el.textContent = 'Banco do HUB · sem alterações pendentes';
    updateWriteButtons();
  }

  function getDirtySet(recordId) {
    const key = String(recordId);
    if (!state.dirtyFields.has(key)) state.dirtyFields.set(key, new Set());
    return state.dirtyFields.get(key);
  }

  function setDraftField(rec, fieldKey, value, inputEl = null) {
    if (!rec || !fieldKey || !isAdminUser()) return;
    const next = value == null ? '' : String(value);
    rec[fieldKey] = next;
    const key = String(rec.id);
    const original = state.originalRecords.get(key);
    if (original) {
      const set = getDirtySet(key);
      if (String(original[fieldKey] || '') === next) set.delete(fieldKey);
      else set.add(fieldKey);
      if (!set.size) state.dirtyFields.delete(key);
    } else if (rec._isNew) {
      state.pendingInserts.set(key, rec);
    }
    if (inputEl) {
      inputEl.classList.toggle('dirty-cell-input', isFieldDirty(rec.id, fieldKey));
      const row = inputEl.closest('tr');
      if (row) row.classList.toggle('dirty-row', isRecordDirty(rec.id));
    }
    updatePendingIndicator();
  }

  function isFieldDirty(recordId, fieldKey) {
    const set = state.dirtyFields.get(String(recordId));
    return !!(set && set.has(fieldKey));
  }

  function isRecordDirty(recordId) {
    const key = String(recordId);
    const set = state.dirtyFields.get(key);
    return !!((set && set.size) || state.pendingInserts.has(key) || state.pendingDeletes.has(key));
  }

  // Estado previsto para as próximas subetapas. 04.2 mantém estes modelos locais
  // sem expor ainda os botões de inclusão/exclusão ao usuário.
  function createPendingInsert(seed = {}) {
    const tempId = state.nextTempId--;
    const rec = {
      id: tempId, recordKey: '', rowOrder: state.records.length + 1, version: 0,
      createdAt: '', updatedAt: '', updatedBy: '', _isNew: true
    };
    FIELDS.forEach(f => { rec[f.key] = seed[f.key] == null ? '' : String(seed[f.key]); });
    state.records.push(rec);
    state.pendingInserts.set(String(tempId), rec);
    updatePendingIndicator();
    return rec;
  }

  function markPendingDelete(recordId) {
    const key = String(recordId);
    const rec = state.records.find(r => String(r.id) === key);
    if (!rec) return false;
    if (rec._isNew) {
      state.pendingInserts.delete(key);
      state.records = state.records.filter(r => String(r.id) !== key);
    } else {
      state.pendingDeletes.set(key, { recordId: rec.id, expectedVersion: rec.version, record: clone(rec) });
      state.dirtyFields.delete(key);
    }
    updatePendingIndicator();
    return true;
  }

  function buildPendingChangesPreview() {
    const changes = [];
    state.dirtyFields.forEach((fieldSet, key) => {
      const rec = state.records.find(r => String(r.id) === key);
      if (!rec || !fieldSet.size) return;
      const fields = {};
      const baseFields = {};
      const original = state.originalRecords.get(key);
      fieldSet.forEach(fieldKey => {
        const def = FIELDS.find(f => f.key === fieldKey);
        if (!def) return;
        fields[def.server] = rec[fieldKey] == null ? '' : String(rec[fieldKey]);
        baseFields[def.server] = original && original[fieldKey] != null ? String(original[fieldKey]) : '';
      });
      changes.push({
        type: 'update', record_id: rec.id, expected_version: rec.version,
        fields, base_fields: baseFields
      });
    });
    state.pendingInserts.forEach(rec => {
      const fields = {};
      FIELDS.forEach(f => { fields[f.server] = rec[f.key] == null ? '' : String(rec[f.key]); });
      changes.push({ type: 'insert', row_order: rec.rowOrder, fields });
    });
    state.pendingDeletes.forEach(item => {
      changes.push({ type: 'delete', record_id: item.recordId, expected_version: item.expectedVersion });
    });
    return changes;
  }

  function conflictFieldDefs(details) {
    const keys = Array.isArray(details && details.conflict_field_keys)
      ? details.conflict_field_keys.filter(Boolean)
      : [];
    if (keys.length) {
      return keys.map(serverKey => FIELDS.find(f => f.server === serverKey)).filter(Boolean);
    }
    const labels = Array.isArray(details && details.conflict_fields)
      ? details.conflict_fields.filter(Boolean)
      : [];
    return labels.map(label => FIELDS.find(f => f.label === label)).filter(Boolean);
  }

  function applyConflictResolution(details, mode) {
    const current = details && details.current_record;
    if (!current || current.id == null) return false;
    const fresh = fromServerRecord(current);
    const key = String(fresh.id);
    const rec = state.records.find(r => String(r.id) === key);
    if (!rec) return false;

    const dirtyBefore = new Set(state.dirtyFields.get(key) || []);
    const conflictDefs = conflictFieldDefs(details);
    const conflictKeys = new Set(conflictDefs.map(f => f.key));

    // Merge the newest server snapshot into untouched fields. Local drafts remain
    // intact, except when the user explicitly chooses the server value.
    FIELDS.forEach(f => {
      const wasDirty = dirtyBefore.has(f.key);
      const isConflict = conflictKeys.has(f.key);
      if (!wasDirty || (mode === 'server' && isConflict)) rec[f.key] = fresh[f.key];
    });

    rec.recordKey = fresh.recordKey;
    rec.rowOrder = fresh.rowOrder;
    rec.version = fresh.version;
    rec.createdAt = fresh.createdAt;
    rec.updatedAt = fresh.updatedAt;
    rec.updatedBy = fresh.updatedBy;
    state.originalRecords.set(key, clone(fresh));

    const dirtyAfter = new Set();
    FIELDS.forEach(f => {
      if (String(rec[f.key] == null ? '' : rec[f.key]) !== String(fresh[f.key] == null ? '' : fresh[f.key])) {
        dirtyAfter.add(f.key);
      }
    });
    if (dirtyAfter.size) state.dirtyFields.set(key, dirtyAfter);
    else state.dirtyFields.delete(key);

    state.recordCache.delete(state.periodKey);
    state.auditCache.delete(state.periodKey);
    renderFiltered();
    updatePendingIndicator();
    return true;
  }

  function openConflictResolutionModal(details) {
    const current = details && details.current_record;
    const fresh = current ? fromServerRecord(current) : null;
    const key = fresh ? String(fresh.id) : '';
    const rec = key ? state.records.find(r => String(r.id) === key) : null;
    const defs = conflictFieldDefs(details);
    if (!fresh || !rec || !defs.length) {
      toast('Conflito detectado, mas nao foi possivel montar a resolucao assistida. Seu rascunho continua preservado.', 'error');
      return;
    }

    const rows = defs.map(def => `
      <tr>
        <td><strong>${escapeHtml(def.label)}</strong></td>
        <td>${escapeHtml(fresh[def.key] || '—')}</td>
        <td>${escapeHtml(rec[def.key] || '—')}</td>
      </tr>`).join('');

    openModal({
      title: 'Resolver conflito de edição',
      body: `
        <div class="danger-box"><strong>${escapeHtml(fresh.empresa || 'Registro')}</strong> foi alterado por outro usuário no mesmo campo antes do seu salvamento. Nenhum valor foi sobrescrito.</div>
        <table>
          <thead><tr><th>Campo</th><th>Valor no servidor</th><th>Meu rascunho</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <p><strong>Usar valor do servidor</strong> descarta somente o seu rascunho conflitante. <strong>Manter meu valor</strong> confirma conscientemente a substituição do valor atual e gera nova linha de auditoria.</p>`,
      actions: [
        { label: 'Cancelar', className: 'btn secondary', onClick: closeModal },
        { label: 'Usar valor do servidor', className: 'btn secondary', onClick: () => {
          if (!applyConflictResolution(details, 'server')) return;
          closeModal();
          toast('Conflito resolvido com o valor atual do servidor.', 'success');
        }},
        { label: 'Manter meu valor e salvar', className: 'btn danger', onClick: async () => {
          if (!applyConflictResolution(details, 'local')) return;
          closeModal();
          toast('Substituicao confirmada. Tentando salvar seu valor sobre a versao atual.', 'warning');
          await savePendingChanges();
        }}
      ]
    });
  }

  async function savePendingChanges() {
    if (!isAdminUser()) {
      toast('Somente usuarios ADM podem salvar alteracoes.', 'error');
      return;
    }
    if (state.saveInProgress) return;
    if (!(state.periodExists && state.periodMeta && state.periodMeta.status === 'open')) {
      toast('A competencia atual nao esta aberta para edicao.', 'error');
      return;
    }
    const changes = buildPendingChangesPreview();
    if (!changes.length) {
      updateWriteButtons();
      return;
    }

    const key = state.periodKey;
    state.saveInProgress = true;
    updateWriteButtons();
    const status = $('#saveState');
    if (status) status.textContent = `Salvando ${changes.length} alteracao(oes)...`;

    try {
      const result = await api(`/api/periods/${encodeURIComponent(key)}/save`, {
        method: 'POST',
        body: { changes }
      });

      state.recordCache.delete(key);
      state.auditCache.delete(key);
      const records = await fetchRecords(key, true);
      state.records = records;
      initializeEditingState(records);
      renderFiltered();
      toast(`Alteracoes salvas no HUB. Lote ${String(result.batch_uuid || '').slice(0, 8)} confirmado.`, 'success');
    } catch (err) {
      if (err && err.status === 409) {
        const details = err.details || {};
        const current = details.current_record || {};
        const name = current.empresa || `registro ${details.record_id || ''}`;
        const fields = Array.isArray(details.conflict_fields) ? details.conflict_fields.filter(Boolean) : [];
        const fieldText = fields.length ? ` no(s) campo(s): ${fields.join(', ')}` : '';
        if (status) status.textContent = `Conflito real em ${name}${fieldText}. Alterações locais preservadas.`;
        toast('Outro usuário alterou a mesma célula. Atualize a página (F5) para carregar o valor do servidor; se ainda quiser sua alteração, edite novamente e salve.', 'error');
        return;
      }
      if (status) status.textContent = 'Falha ao salvar · alteracoes locais preservadas';
      toast(err && err.message ? err.message : 'Falha ao salvar alteracoes.', 'error');
      return;
    } finally {
      state.saveInProgress = false;
      updateWriteButtons();
    }
  }

  function normalizeSearch(text) {
    return String(text == null ? '' : text)
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase().replace(/\s+/g, ' ').trim();
  }

  function onlyDigits(value) { return String(value == null ? '' : value).replace(/\D/g, ''); }

  function valueMatches(value, query) {
    const v = normalizeSearch(value);
    const q = normalizeSearch(query);
    if (!q) return true;
    if (v.includes(q)) return true;
    const vc = v.replace(/[^a-z0-9]/g, '');
    const qc = q.replace(/[^a-z0-9]/g, '');
    return !!qc && vc.includes(qc);
  }

  function columnFilterMatches(field, value, query) {
    if (!query) return true;
    if (field === 'regime' || field === 'honorarios' || field === 'situacao') {
      return normalizeSearch(value) === normalizeSearch(query);
    }
    return valueMatches(value, query);
  }

  function recordMatches(rec, query) { return FIELDS.some(f => valueMatches(rec[f.key], query)); }

  function renderFiltered() {
    const global = $('#globalSearch').value || '';
    let rows = state.records.filter(rec => {
      if (global && !recordMatches(rec, global)) return false;
      for (const [field, value] of Object.entries(state.filters)) {
        if (value && !columnFilterMatches(field, rec[field], value)) return false;
      }
      return true;
    });
    const { field, dir } = state.sort;
    rows = rows.slice().sort((a, b) => {
      const cmp = String(a[field] || '').localeCompare(String(b[field] || ''), 'pt-BR', { numeric: true, sensitivity: 'base' });
      return dir === 'asc' ? cmp : -cmp;
    });
    state.filteredRecords = rows;
    renderTable(rows);
    $('#recordCount').textContent = String(rows.length);
    updateSortIndicators();
  }

  function clearFilters() {
    state.filters = {};
    $('#globalSearch').value = '';
    renderTableStructure();
    updateFilterOptions();
    renderFiltered();
  }

  function orderedFields() {
    const map = new Map(FIELDS.map(f => [f.key, f]));
    return state.columnOrder.map(k => map.get(k)).filter(Boolean);
  }

  function sanitizeColumnOrder(order) {
    const valid = new Set(DEFAULT_COLUMN_ORDER);
    const seen = new Set();
    const next = [];
    (Array.isArray(order) ? order : []).forEach(k => {
      if (valid.has(k) && !seen.has(k)) { seen.add(k); next.push(k); }
    });
    DEFAULT_COLUMN_ORDER.forEach(k => { if (!seen.has(k)) next.push(k); });
    return next;
  }

  function prefKey(type) {
    const user = state.user ? state.user.username : 'anon';
    return `${PREF_PREFIX}::${user}::${type}`;
  }

  async function loadVisualPreferences() {
    try {
      const order = JSON.parse(localStorage.getItem(prefKey('columnOrder')) || 'null');
      const widths = JSON.parse(localStorage.getItem(prefKey('columnWidths')) || 'null');
      state.columnOrder = sanitizeColumnOrder(order);
      state.columnWidths = { ...DEFAULT_COLUMN_WIDTHS };
      if (widths && typeof widths === 'object') {
        FIELDS.forEach(f => {
          const n = Number(widths[f.key]);
          if (Number.isFinite(n)) state.columnWidths[f.key] = Math.max(MIN_COLUMN_WIDTHS[f.key] || 70, Math.min(900, n));
        });
      }
    } catch (_) {
      state.columnOrder = [...DEFAULT_COLUMN_ORDER];
      state.columnWidths = { ...DEFAULT_COLUMN_WIDTHS };
    }
  }

  function persistVisualPreferences() {
    try {
      localStorage.setItem(prefKey('columnOrder'), JSON.stringify(state.columnOrder));
      localStorage.setItem(prefKey('columnWidths'), JSON.stringify(state.columnWidths));
    } catch (_) {}
  }

  function resetColumnOrder() {
    state.columnOrder = [...DEFAULT_COLUMN_ORDER];
    persistVisualPreferences();
    renderTableStructure();
    updateFilterOptions();
    renderFiltered();
    toast('Ordem padrão restaurada.', 'success');
  }

  function resetColumnWidths() {
    state.columnWidths = { ...DEFAULT_COLUMN_WIDTHS };
    persistVisualPreferences();
    applyColumnWidths();
    toast('Larguras padrão restauradas.', 'success');
  }

  function renderTableStructure() {
    const fields = orderedFields();
    const showActions = isAdminUser();
    $('#clientColgroup').innerHTML = fields.map(f => `<col data-col="${f.key}">`).join('') + (showActions ? '<col style="width:76px">' : '');
    const header = $('#clientTable .header-row');
    const filter = $('#clientTable .filter-row');
    header.innerHTML = fields.map(f => `
      <th data-sort="${f.key}" data-col="${f.key}" draggable="true">
        ${escapeHtml(f.label)} <span class="sort-indicator"></span><span class="column-resizer" data-resize="${f.key}" title="Arraste para ajustar; duplo clique para autoajustar"></span>
      </th>`).join('') + (showActions ? '<th class="row-actions">Ações</th>' : '');
    filter.innerHTML = fields.map(f => `<th data-col="${f.key}">${filterControlHtml(f)}</th>`).join('') + (showActions ? '<th class="row-actions"></th>' : '');

    header.querySelectorAll('th[data-sort]').forEach(th => {
      th.addEventListener('click', e => {
        if (e.target.closest('.column-resizer') || state.justDragged) return;
        toggleSort(th.dataset.sort);
      });
      th.addEventListener('dragstart', onColumnDragStart);
      th.addEventListener('dragover', e => { e.preventDefault(); th.classList.add('column-drop-target'); });
      th.addEventListener('dragleave', () => th.classList.remove('column-drop-target'));
      th.addEventListener('drop', onColumnDrop);
      th.addEventListener('dragend', onColumnDragEnd);
    });
    header.querySelectorAll('.column-resizer').forEach(handle => {
      handle.addEventListener('pointerdown', onResizePointerDown);
      handle.addEventListener('dblclick', e => { e.preventDefault(); e.stopPropagation(); autoFitColumn(handle.dataset.resize); });
      handle.addEventListener('mousedown', e => e.stopPropagation());
    });
    filter.querySelectorAll('.column-filter').forEach(control => {
      control.addEventListener('input', onColumnFilterChange);
      control.addEventListener('change', onColumnFilterChange);
    });
    applyColumnWidths();
    updateSortIndicators();
  }

  function filterControlHtml(f) {
    const value = state.filters[f.key] || '';
    if (f.key === 'regime') return selectFilterHtml(f.key, [''].concat(REGIME_OPTIONS), value, 'Todos');
    if (f.key === 'honorarios') return selectFilterHtml(f.key, [''].concat(HONORARIOS_FILTER_OPTIONS), value, 'Todos');
    if (f.key === 'situacao') return selectFilterHtml(f.key, [''].concat(SITUACAO_FILTER_OPTIONS), value, 'Todos');
    return `<input class="column-filter" data-field="${f.key}" placeholder="Filtrar" value="${escapeAttr(value)}">`;
  }

  function selectFilterHtml(field, options, value, emptyLabel) {
    return `<select class="column-filter" data-field="${field}">${options.map((opt, i) => `<option value="${escapeAttr(opt)}"${opt === value ? ' selected' : ''}>${i === 0 ? emptyLabel : escapeHtml(opt)}</option>`).join('')}</select>`;
  }

  function onColumnFilterChange(e) {
    const field = e.target.dataset.field;
    state.filters[field] = e.target.value || '';
    renderFiltered();
  }

  function updateFilterOptions() {
    // Opções categóricas são fixas por regra do app; inputs de texto não exigem atualização.
  }

  function toggleSort(field) {
    if (state.sort.field === field) state.sort.dir = state.sort.dir === 'asc' ? 'desc' : 'asc';
    else state.sort = { field, dir: 'asc' };
    renderFiltered();
  }

  function updateSortIndicators() {
    $$('#clientTable .header-row th[data-sort]').forEach(th => {
      const span = $('.sort-indicator', th);
      if (span) span.textContent = th.dataset.sort === state.sort.field ? (state.sort.dir === 'asc' ? '▲' : '▼') : '';
    });
  }

  function renderTable(records) {
    const tbody = $('#tableBody');
    tbody.innerHTML = '';
    const frag = document.createDocumentFragment();
    const fields = orderedFields();
    const editable = isAdminUser() && state.periodExists && state.periodMeta && state.periodMeta.status === 'open';
    const showActions = isAdminUser();
    records.forEach(rec => {
      if (state.pendingDeletes.has(String(rec.id))) return;
      const tr = document.createElement('tr');
      tr.dataset.id = String(rec.id);
      tr.dataset.version = String(rec.version);
      tr.classList.toggle('dirty-row', isRecordDirty(rec.id));
      fields.forEach(f => {
        const td = document.createElement('td');
        td.className = `col-${f.key}`;
        if (editable) {
          const input = buildEditableControl(rec, f);
          td.appendChild(input);
        } else {
          const span = document.createElement('span');
          span.className = 'readonly-cell';
          span.textContent = rec[f.key] || '';
          td.appendChild(span);
        }
        tr.appendChild(td);
      });
      if (showActions) {
        const td = document.createElement('td');
        td.className = 'row-actions';
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'row-delete';
        btn.textContent = 'Excluir';
        btn.disabled = !editable;
        btn.title = editable ? 'Excluir desta competência' : 'Competência sem edição';
        btn.addEventListener('click', () => requestDeleteRow(rec));
        td.appendChild(btn);
        tr.appendChild(td);
      }
      frag.appendChild(tr);
    });
    tbody.appendChild(frag);
    applyColumnWidths();
  }

  function buildEditableControl(rec, fieldDef) {
    const selectOptions = fieldDef.key === 'regime'
      ? REGIME_OPTIONS
      : (fieldDef.key === 'honorarios'
          ? HONORARIOS_FILTER_OPTIONS
          : (fieldDef.key === 'situacao' ? SITUACAO_FILTER_OPTIONS : null));
    const control = selectOptions ? document.createElement('select') : document.createElement('input');
    control.className = 'cell-input';
    control.dataset.field = fieldDef.key;
    control.dataset.recordId = String(rec.id);
    if (selectOptions) {
      const blank = document.createElement('option');
      blank.value = '';
      blank.textContent = '—';
      control.appendChild(blank);
      selectOptions.forEach(value => {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = value;
        control.appendChild(option);
      });
      control.value = rec[fieldDef.key] || '';
      control.addEventListener('change', e => setDraftField(rec, fieldDef.key, e.target.value, e.target));
    } else {
      control.type = 'text';
      control.value = rec[fieldDef.key] || '';
      control.addEventListener('input', e => setDraftField(rec, fieldDef.key, e.target.value, e.target));
    }
    control.classList.toggle('dirty-cell-input', isFieldDirty(rec.id, fieldDef.key));
    return control;
  }

  function applyColumnWidths() {
    $$('#clientColgroup col[data-col]').forEach(col => {
      const key = col.dataset.col;
      col.style.width = `${state.columnWidths[key] || DEFAULT_COLUMN_WIDTHS[key] || 120}px`;
    });
    requestAnimationFrame(refreshHorizontalScrollMirror);
  }

  let horizontalScrollMirrorBound = false;
  let horizontalScrollResizeObserver = null;

  function setupHorizontalScrollMirror() {
    const top = $('#tableScrollTop');
    const main = $('#tableScroll');
    const table = $('#clientTable');
    if (!top || !main || !table) return;

    if (!horizontalScrollMirrorBound) {
      let syncing = false;
      top.addEventListener('scroll', () => {
        if (syncing) return;
        syncing = true;
        main.scrollLeft = top.scrollLeft;
        syncing = false;
      });
      main.addEventListener('scroll', () => {
        if (syncing) return;
        syncing = true;
        top.scrollLeft = main.scrollLeft;
        syncing = false;
      });
      window.addEventListener('resize', refreshHorizontalScrollMirror);
      horizontalScrollMirrorBound = true;
    }

    if ('ResizeObserver' in window && !horizontalScrollResizeObserver) {
      horizontalScrollResizeObserver = new ResizeObserver(refreshHorizontalScrollMirror);
      horizontalScrollResizeObserver.observe(main);
      horizontalScrollResizeObserver.observe(table);
    }
    refreshHorizontalScrollMirror();
  }

  function refreshHorizontalScrollMirror() {
    const top = $('#tableScrollTop');
    const spacer = $('#tableScrollTopSpacer');
    const main = $('#tableScroll');
    const table = $('#clientTable');
    if (!top || !spacer || !main || !table) return;
    const width = Math.max(table.scrollWidth || 0, main.scrollWidth || 0, main.clientWidth || 0, 1);
    spacer.style.width = `${width}px`;
    if (Math.abs(top.scrollLeft - main.scrollLeft) > 1) top.scrollLeft = main.scrollLeft;
  }

  function onResizePointerDown(e) {
    e.preventDefault();
    e.stopPropagation();
    const field = e.currentTarget.dataset.resize;
    const startX = e.clientX;
    const startWidth = state.columnWidths[field] || DEFAULT_COLUMN_WIDTHS[field] || 120;
    document.body.classList.add('column-resize-active');
    const move = ev => {
      const width = Math.max(MIN_COLUMN_WIDTHS[field] || 70, Math.min(900, startWidth + (ev.clientX - startX)));
      state.columnWidths[field] = Math.round(width);
      applyColumnWidths();
    };
    const up = () => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      document.body.classList.remove('column-resize-active');
      persistVisualPreferences();
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up, { once: true });
  }

  function autoFitColumn(field) {
    const f = FIELDS.find(x => x.key === field);
    if (!f) return;
    let max = f.label.length;
    state.filteredRecords.slice(0, 500).forEach(r => { max = Math.max(max, String(r[field] || '').length); });
    const width = Math.max(MIN_COLUMN_WIDTHS[field] || 70, Math.min(600, 32 + max * 7.4));
    state.columnWidths[field] = Math.round(width);
    persistVisualPreferences();
    applyColumnWidths();
  }

  function onColumnDragStart(e) {
    if (e.target.closest('.column-resizer')) { e.preventDefault(); return; }
    state.dragField = e.currentTarget.dataset.col;
    e.currentTarget.classList.add('column-dragging');
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', state.dragField);
    }
  }

  function onColumnDrop(e) {
    e.preventDefault();
    const target = e.currentTarget.dataset.col;
    const source = state.dragField || (e.dataTransfer ? e.dataTransfer.getData('text/plain') : '');
    if (!source || !target || source === target) return;
    const order = state.columnOrder.slice();
    const from = order.indexOf(source);
    const to = order.indexOf(target);
    if (from < 0 || to < 0) return;
    order.splice(from, 1);
    order.splice(to, 0, source);
    state.columnOrder = sanitizeColumnOrder(order);
    state.justDragged = true;
    persistVisualPreferences();
    renderTableStructure();
    renderFiltered();
    setTimeout(() => { state.justDragged = false; }, 50);
  }

  function onColumnDragEnd(e) {
    $$('#clientTable .header-row th').forEach(th => th.classList.remove('column-dragging', 'column-drop-target'));
    state.dragField = null;
  }

  async function switchView(view) {
    // Defesa adicional: mesmo que a funcao seja chamada manualmente no navegador,
    // perfil comum permanece restrito a Carteira.
    if (!(state.user && state.user.role === ROLE_ADMIN) && view !== 'carteira') {
      view = 'carteira';
    }
    if (view !== state.currentView && state.currentView === 'carteira' && hasPendingChanges()) {
      if (!confirmDiscardPending(`abrir a aba ${view}`)) return;
      // A navegação confirmada descarta somente o rascunho local e recarrega do cache/servidor ao voltar.
      const original = Array.from(state.originalRecords.values()).map(clone);
      state.records = original;
      initializeEditingState(original);
      renderFiltered();
    }
    state.currentView = view;
    $('#carteiraView').classList.toggle('hidden', view !== 'carteira');
    $('#dashboardView').classList.toggle('hidden', view !== 'dashboard');
    $('#auditView').classList.toggle('hidden', view !== 'auditoria');
    $('#btnTabCarteira').classList.toggle('active', view === 'carteira');
    $('#btnTabDashboard').classList.toggle('active', view === 'dashboard');
    $('#btnTabAudit').classList.toggle('active', view === 'auditoria');
    if (view === 'dashboard') await renderDashboard();
    if (view === 'auditoria') await renderAudit();
  }

  async function onDashboardPeriodChange() {
    state.dashboardPeriodKey = periodKey(Number($('#dashboardYearSelect').value), Number($('#dashboardMonthSelect').value));
    await renderDashboard();
  }

  function onDashboardFilterChange() {
    state.dashboardFilters.document = $('#dashboardDocumentFilter').value || '';
    state.dashboardFilters.situation = $('#dashboardSituationFilter').value || '';
    state.dashboardFilters.regime = $('#dashboardRegimeFilter').value || '';
    state.dashboardFilters.honorarios = $('#dashboardHonorariosFilter').value || '';
    renderDashboard().catch(console.error);
  }

  function clearDashboardFilters() {
    state.dashboardFilters = { document: '', situation: '', regime: '', honorarios: '' };
    $('#dashboardDocumentFilter').value = '';
    $('#dashboardSituationFilter').value = '';
    $('#dashboardRegimeFilter').value = '';
    $('#dashboardHonorariosFilter').value = '';
    renderDashboard().catch(console.error);
  }

  function classifyDocument(rec) {
    const d = onlyDigits(rec.cnpj);
    if (d.length === 14) return 'cnpj';
    if (d.length === 11) return 'cpf';
    return 'outros';
  }

  function classifySituation(value) {
    const n = normalizeSearch(value);
    if (n === 'ativa' || n === 'ativo') return 'ativa';
    if (n === 'inativa' || n === 'inativo') return 'inativa';
    if (n === 'nao cliente' || n === 'nao-cliente') return 'nao-cliente';
    return 'outros';
  }

  function classifyHonorarios(value) {
    const n = normalizeSearch(value);
    if (n === 'em dia') return 'em-dia';
    if (n === 'em atraso' || n === 'atraso') return 'em-atraso';
    if (n === 'bloqueado' || n === 'bloqueada') return 'bloqueado';
    if (n === 'nao cliente' || n === 'nao-cliente') return 'nao-cliente';
    return 'outros';
  }

  function canonicalRegime(value) {
    const n = normalizeSearch(value);
    if (['simples', 'sn', 'simples nacional'].includes(n)) return 'Simples';
    if (['lp', 'lucro presumido'].includes(n)) return 'LP';
    if (['lr', 'lucro real'].includes(n)) return 'LR';
    if (n.startsWith('assoc')) return 'Assoc.';
    if (n.startsWith('coop')) return 'Coop.';
    if (n.startsWith('produtor')) return 'Produtor';
    return String(value || '').trim() || 'Sem regime';
  }

  function dashboardFilterRecords(records) {
    const f = state.dashboardFilters;
    return records.filter(r => {
      if (f.document && classifyDocument(r) !== f.document) return false;
      if (f.situation && classifySituation(r.situacao) !== f.situation) return false;
      if (f.regime && canonicalRegime(r.regime) !== f.regime) return false;
      if (f.honorarios) {
        const h = classifyHonorarios(r.honorarios);
        if (f.honorarios === 'inadimplente') {
          if (!(h === 'em-atraso' || h === 'bloqueado')) return false;
        } else if (h !== f.honorarios) return false;
      }
      return true;
    });
  }

  function dashboardMetrics(records) {
    const m = {
      total: records.length, cnpj: 0, cpf: 0, ativas: 0, inativas: 0, outrosSituacao: 0,
      emDia: 0, bloqueado: 0, emAtraso: 0, naoClientes: 0,
      inadimplentes: 0, clientesConsiderados: 0, regimes: new Map()
    };
    records.forEach(r => {
      const d = classifyDocument(r); if (d === 'cnpj') m.cnpj++; else if (d === 'cpf') m.cpf++;
      const s = classifySituation(r.situacao);
      if (s === 'ativa') m.ativas++; else if (s === 'inativa') m.inativas++; else m.outrosSituacao++;
      const h = classifyHonorarios(r.honorarios);
      if (h === 'em-dia') m.emDia++;
      if (h === 'bloqueado') m.bloqueado++;
      if (h === 'em-atraso') m.emAtraso++;
      const nonClient = s === 'nao-cliente' || h === 'nao-cliente';
      if (nonClient) m.naoClientes++;
      else {
        m.clientesConsiderados++;
        if (h === 'bloqueado' || h === 'em-atraso') m.inadimplentes++;
      }
      const regime = canonicalRegime(r.regime);
      m.regimes.set(regime, (m.regimes.get(regime) || 0) + 1);
    });
    m.inadimplencia = m.clientesConsiderados ? (m.inadimplentes / m.clientesConsiderados) * 100 : 0;
    return m;
  }

  async function renderDashboard() {
    const key = state.dashboardPeriodKey || state.periodKey;
    if (!key) return;
    $('#dashboardPeriodChip').textContent = `Competência ${displayPeriod(key)}`;
    const meta = state.periods.find(p => p.id === key) || null;
    let allRecords = [];
    if (meta) allRecords = key === state.periodKey ? clone(state.records) : await fetchRecords(key, false);
    updateDashboardRegimeFilter(allRecords);
    const filtered = dashboardFilterRecords(allRecords);
    const metrics = dashboardMetrics(filtered);
    const full = dashboardMetrics(allRecords);
    $('#dashboardBaseCount').textContent = String(allRecords.length);
    $('#dashboardFilteredCount').textContent = String(filtered.length);
    $('#dashboardUpdatedAt').textContent = meta ? `Atualização no servidor: ${formatDateTime(meta.updatedAt)}` : 'Competência não cadastrada';
    $('#kpiTotalGeral').textContent = String(full.total);
    $('#kpiResultado').textContent = String(metrics.total);
    $('#kpiCnpj').textContent = String(metrics.cnpj);
    $('#kpiCpf').textContent = String(metrics.cpf);
    $('#kpiAtivas').textContent = String(metrics.ativas);
    $('#kpiInativas').textContent = String(metrics.inativas);
    $('#kpiOutrosSituacao').textContent = String(metrics.outrosSituacao);
    $('#kpiEmDia').textContent = String(metrics.emDia);
    $('#kpiBloqueadas').textContent = String(metrics.bloqueado);
    $('#kpiEmAtraso').textContent = String(metrics.emAtraso);
    $('#kpiInadimplencia').textContent = `${metrics.inadimplencia.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
    $('#kpiInadimplenciaDetail').textContent = `${metrics.inadimplentes} de ${metrics.clientesConsiderados} clientes considerados`;
    $('#dashboardNonClientNote').textContent = `${metrics.naoClientes} Não Cliente(s) no recorte · excluídos da taxa de inadimplência`;
    $('#dashboardPendingNotice').classList.add('hidden');
    const grid = $('#dashboardRegimeGrid');
    const regimes = Array.from(metrics.regimes.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'pt-BR'));
    grid.innerHTML = regimes.map(([name, count]) => `<button type="button" class="regime-total-item" data-regime="${escapeAttr(name)}"><span>${escapeHtml(name)}</span><strong>${count}</strong></button>`).join('');
    $('#dashboardRegimeEmpty').classList.toggle('hidden', regimes.length > 0);
  }

  function updateDashboardRegimeFilter(records) {
    const select = $('#dashboardRegimeFilter');
    const previous = state.dashboardFilters.regime || '';
    const regimes = Array.from(new Set(records.map(r => canonicalRegime(r.regime)))).filter(Boolean).sort((a, b) => a.localeCompare(b, 'pt-BR'));
    select.innerHTML = '<option value="">Todos</option>' + regimes.map(r => `<option value="${escapeAttr(r)}">${escapeHtml(r)}</option>`).join('');
    if (regimes.includes(previous)) select.value = previous;
    else state.dashboardFilters.regime = '';
  }

  function onDashboardKpiClick(e) {
    const card = e.target.closest('[data-dashboard-filter]');
    if (!card) return;
    const type = card.dataset.dashboardFilter;
    const value = card.dataset.dashboardValue || '';
    if (type === 'clear') return clearDashboardFilters();
    if (type === 'document') state.dashboardFilters.document = value;
    if (type === 'situation') state.dashboardFilters.situation = value;
    if (type === 'honorarios') state.dashboardFilters.honorarios = value;
    syncDashboardControls();
    renderDashboard().catch(console.error);
  }

  function onDashboardRegimeClick(e) {
    const btn = e.target.closest('[data-regime]');
    if (!btn) return;
    state.dashboardFilters.regime = btn.dataset.regime || '';
    syncDashboardControls();
    renderDashboard().catch(console.error);
  }

  function syncDashboardControls() {
    $('#dashboardDocumentFilter').value = state.dashboardFilters.document || '';
    $('#dashboardSituationFilter').value = state.dashboardFilters.situation || '';
    $('#dashboardRegimeFilter').value = state.dashboardFilters.regime || '';
    $('#dashboardHonorariosFilter').value = state.dashboardFilters.honorarios || '';
  }

  async function onAuditPeriodChange() {
    state.auditPeriodKey = periodKey(Number($('#auditYearSelect').value), Number($('#auditMonthSelect').value));
    await renderAudit();
  }

  function onAuditFilterChange() {
    state.auditFilters.user = $('#auditUserFilter').value || '';
    state.auditFilters.action = $('#auditActionFilter').value || '';
    state.auditFilters.search = $('#auditSearch').value || '';
    renderAudit().catch(console.error);
  }

  function clearAuditFilters() {
    state.auditFilters = { user: '', action: '', search: '' };
    $('#auditUserFilter').value = '';
    $('#auditActionFilter').value = '';
    $('#auditSearch').value = '';
    renderAudit().catch(console.error);
  }

  async function fetchAudit(key, force = true) {
    if (!force && state.auditCache.has(key)) return clone(state.auditCache.get(key));
    const response = await api(`/api/periods/${encodeURIComponent(key)}/audit?limit=5000`);
    const list = (response.audit || []).map(a => ({
      id: a.id,
      timestamp: a.occurred_at || '',
      username: a.username || '',
      action: a.action || '',
      rowRef: a.row_ref || (a.current_row_order ? `Linha ${a.current_row_order}` : (a.record_id ? `Registro #${a.record_id}` : '')),
      recordId: a.record_id,
      empresa: a.empresa_snapshot || a.current_empresa || summaryField(a.old_value, 'Empresa') || summaryField(a.new_value, 'Empresa') || '',
      cnpj: a.cnpj_snapshot || a.current_cnpj || summaryField(a.old_value, 'CNPJ') || summaryField(a.new_value, 'CNPJ') || '',
      field: a.field || '',
      oldValue: a.old_value == null ? '' : String(a.old_value),
      newValue: a.new_value == null ? '' : String(a.new_value),
      versionBefore: a.version_before,
      versionAfter: a.version_after
    })).sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)) || Number(b.id) - Number(a.id));
    state.auditCache.set(key, list);
    return clone(list);
  }

  function summaryField(summary, label) {
    const text = String(summary || '');
    const parts = text.split(' | ');
    const prefix = `${label}: `;
    const item = parts.find(p => p.startsWith(prefix));
    return item ? item.slice(prefix.length) : '';
  }

  async function renderAudit() {
    const key = state.auditPeriodKey || state.periodKey;
    if (!key) return;
    $('#auditPeriodChip').textContent = `Competência ${displayPeriod(key)}`;
    const meta = state.periods.find(p => p.id === key);
    const all = meta ? await fetchAudit(key, true) : [];
    const users = Array.from(new Set(all.map(a => a.username).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'pt-BR'));
    const userSelect = $('#auditUserFilter');
    const previous = state.auditFilters.user || '';
    userSelect.innerHTML = '<option value="">Todos os usuários</option>' + users.map(u => `<option value="${escapeAttr(u)}">${escapeHtml(u)}</option>`).join('');
    if (users.includes(previous)) userSelect.value = previous; else state.auditFilters.user = '';
    const q = normalizeSearch(state.auditFilters.search || '');
    const filtered = all.filter(a => {
      if (state.auditFilters.user && a.username !== state.auditFilters.user) return false;
      if (state.auditFilters.action && a.action !== state.auditFilters.action) return false;
      if (q) {
        const hay = [a.username, a.action, a.rowRef, a.empresa, a.cnpj, a.field, a.oldValue, a.newValue].map(normalizeSearch).join(' ');
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    $('#auditCount').textContent = String(filtered.length);
    $('#auditTotalCount').textContent = String(all.length);
    const tbody = $('#auditTableBody');
    tbody.innerHTML = '';
    const frag = document.createDocumentFragment();
    filtered.forEach(a => {
      const tr = document.createElement('tr');
      const values = [formatAuditDate(a.timestamp), formatAuditTime(a.timestamp), a.username, a.action, a.rowRef, a.empresa, a.cnpj, a.field, a.oldValue, a.newValue];
      values.forEach((value, idx) => {
        const td = document.createElement('td');
        td.textContent = value == null ? '' : String(value);
        if (idx >= 8) td.className = 'audit-value';
        tr.appendChild(td);
      });
      frag.appendChild(tr);
    });
    tbody.appendChild(frag);
    $('#auditEmpty').classList.toggle('hidden', filtered.length > 0);
  }

  function formatAuditDate(iso) {
    const d = new Date(iso); if (Number.isNaN(d.getTime())) return '';
    return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric' }).format(d);
  }
  function formatAuditTime(iso) {
    const d = new Date(iso); if (Number.isNaN(d.getTime())) return '';
    return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(d);
  }
  function formatDateTime(iso) {
    const d = new Date(iso); if (Number.isNaN(d.getTime())) return '';
    return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'medium' }).format(d);
  }

  async function openUsersModal() {
    // HUB: os usuários e as senhas são os do HUB; aqui o ADM define quem é ADM, quem consulta e quem não acessa.
    if (!isAdminUser()) return;
    const response = await api('/api/admin/users');
    const users = response.users || [];
    const rows = users.map(user => {
      const value = user.role === 'admin' ? 'admin' : (user.is_active ? 'viewer' : 'bloqueado');
      const fixed = !!user.hub_admin;
      return `
        <div class="user-admin-row" data-user="${escapeAttr(user.id)}" style="border:1px solid #d7e1eb;border-radius:10px;padding:10px 12px;margin-top:8px;display:flex;gap:12px;align-items:center;justify-content:space-between;flex-wrap:wrap">
          <div><strong>${escapeHtml(user.display_name || user.username)}</strong><div style="font-size:12px;color:#667085">${escapeHtml(user.email || '')}${fixed ? ' · administrador do HUB' : ''}</div></div>
          <div style="display:flex;gap:8px;align-items:center">
            <select class="user-role" ${fixed ? 'disabled' : ''}>
              <option value="viewer" ${value === 'viewer' ? 'selected' : ''}>Usuário comum · leitura</option>
              <option value="admin" ${value === 'admin' ? 'selected' : ''}>ADM</option>
              <option value="bloqueado" ${value === 'bloqueado' ? 'selected' : ''}>Sem acesso</option>
            </select>
            ${fixed ? '' : '<button type="button" class="btn secondary user-save">Salvar</button>'}
          </div>
        </div>`;
    }).join('');
    openModal({
      title: 'Usuários',
      body: `
        <p style="margin-top:0;color:#667085">Os usuários e as senhas são os do HUB. Administradores do HUB são sempre ADM na Carteira; os demais consultam, e o ADM pode torná-los ADM ou retirar o acesso.</p>
        ${rows || '<p>Nenhum usuário encontrado.</p>'}`,
      actions: [{ label: 'Fechar', className: 'btn secondary', onClick: closeModal }]
    });
    $$('.user-admin-row').forEach(row => {
      const button = $('.user-save', row);
      if (!button) return;
      button.addEventListener('click', async () => {
        try {
          await api(`/api/admin/users/${encodeURIComponent(row.dataset.user)}`, { method: 'PATCH', body: { papel: $('.user-role', row).value } });
          toast('Acesso atualizado.', 'success');
          await openUsersModal();
        } catch (err) { toast(err.message || 'Falha ao atualizar usuário.', 'error'); }
      });
    });
  }

  function openChangePasswordModal() {
    if (!state.user) return;
    openModal({
      title: 'Alterar minha senha',
      body: `
        <div class="field"><label>Senha atual</label><input id="currentPassword" type="password"></div>
        <div class="field" style="margin-top:10px"><label>Nova senha</label><input id="newPassword" type="password"></div>
        <div class="field" style="margin-top:10px"><label>Confirmar nova senha</label><input id="newPassword2" type="password"></div>`,
      actions: [
        { label: 'Cancelar', className: 'btn secondary', onClick: closeModal },
        { label: 'Alterar senha', className: 'btn primary', onClick: async () => {
          const current = $('#currentPassword').value || '';
          const next = $('#newPassword').value || '';
          const next2 = $('#newPassword2').value || '';
          if (next.length < 8) return toast('A nova senha deve ter pelo menos 8 caracteres.', 'error');
          if (next !== next2) return toast('A confirmação não confere.', 'error');
          try {
            await api('/api/me/password', { method: 'POST', body: { current_password: current, new_password: next } });
            closeModal();
            toast('Senha alterada no servidor.', 'success');
          } catch (err) { toast(err.message || 'Falha ao alterar senha.', 'error'); }
        }}
      ]
    });
  }

  function openModal({ title, body, actions = [] }) {
    $('#modalTitle').textContent = title || '';
    $('#modalBody').innerHTML = body || '';
    const root = $('#modalActions');
    root.innerHTML = '';
    actions.forEach(a => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = a.className || 'btn secondary';
      btn.textContent = a.label;
      btn.addEventListener('click', a.onClick || closeModal);
      root.appendChild(btn);
    });
    $('#modalRoot').classList.remove('hidden');
    $('#modalRoot').setAttribute('aria-hidden', 'false');
  }

  function closeModal() {
    $('#modalRoot').classList.add('hidden');
    $('#modalRoot').setAttribute('aria-hidden', 'true');
  }

  function toast(message, type = 'info') {
    const div = document.createElement('div');
    div.className = `toast ${type}`;
    div.textContent = message;
    $('#toastRoot').appendChild(div);
    setTimeout(() => { div.classList.add('show'); }, 10);
    setTimeout(() => { div.classList.remove('show'); setTimeout(() => div.remove(), 250); }, 3600);
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }
  function escapeAttr(value) { return escapeHtml(value); }
})();
