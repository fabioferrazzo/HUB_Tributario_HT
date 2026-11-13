/*
 * Analista de Aplicações Financeiras no HUB — entrada pelo login do HUB.
 *
 * O app é o mesmo do pacote 1.9.0 (stage18-stable2). Aqui só muda a entrada: em vez do login local da estação,
 * o usuário é o do HUB (administrador do HUB = administrador do app). Os projetos e documentos continuam
 * guardados no navegador de cada computador (IndexedDB), como no app original; para levar de um computador
 * a outro, use "Criar backup" / "Restaurar .htaf".
 */
import { AUTH_SETTING_ID, ROLES } from './auth/local-auth.js';

const CFG_KEY = 'hub_supabase_public';
const realFetch = window.fetch.bind(window);
let hubWindow = null;
try { hubWindow = window.top !== window ? window.parent : (window.opener && !window.opener.closed ? window.opener : null); } catch { hubWindow = null; }
const auth = {token: '', exp: 0, url: '', anonKey: ''};
let waiting = [];

function jwtPayload(token) {
  try { return JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); } catch { return {}; }
}
const jwtExp = token => Number(jwtPayload(token).exp || 0) * 1000;
function readStoredConfig() {
  try {
    const cfg = JSON.parse(localStorage.getItem(CFG_KEY) || 'null');
    if (cfg && cfg.url && cfg.anonKey) { auth.url = auth.url || cfg.url; auth.anonKey = auth.anonKey || cfg.anonKey; }
  } catch { /* sem configuração guardada */ }
}
function readStoredSession() {
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (!/^sb-.*-auth-token$/.test(key || '')) continue;
      const data = JSON.parse(localStorage.getItem(key) || 'null');
      const session = data && (data.currentSession || data);
      if (session && session.access_token) return session.access_token;
    }
  } catch { /* sem sessão guardada */ }
  return '';
}
window.addEventListener('message', event => {
  if (event.origin !== location.origin || !event.data || event.data.type !== 'hub-auth-token' || !event.data.token) return;
  auth.token = event.data.token; auth.exp = jwtExp(event.data.token);
  if (event.data.supabaseUrl) auth.url = event.data.supabaseUrl;
  if (event.data.supabaseAnonKey) auth.anonKey = event.data.supabaseAnonKey;
  const list = waiting; waiting = []; list.forEach(fn => fn());
});
function askHub(timeoutMs) {
  return new Promise(resolve => {
    if (!hubWindow) return resolve(false);
    let done = false;
    waiting.push(() => { if (!done) { done = true; resolve(true); } });
    try { hubWindow.postMessage({type: 'hub:auth-request'}, location.origin); } catch { /* janela do HUB indisponível */ }
    setTimeout(() => { if (!done) { done = true; resolve(false); } }, timeoutMs || 2500);
  });
}
async function getToken() {
  readStoredConfig();
  if (auth.token && auth.exp - Date.now() > 90000) return auth.token;
  await askHub(2500);
  if (!auth.token || auth.exp - Date.now() < 30000) {
    const stored = readStoredSession();
    if (stored && jwtExp(stored) - Date.now() > 30000) { auth.token = stored; auth.exp = jwtExp(stored); }
  }
  return auth.token;
}

async function hubProfile() {
  const token = await getToken();
  if (!auth.url || !auth.anonKey || !token) throw new Error('Sessão do HUB não encontrada. Entre no HUB e abra o simulador pelo menu Simuladores.');
  const sub = jwtPayload(token).sub;
  let response;
  try {
    response = await realFetch(`${auth.url.replace(/\/+$/, '')}/rest/v1/profiles?select=id,email,nome,role,active&id=eq.${encodeURIComponent(sub)}`, {
      headers: {apikey: auth.anonKey, Authorization: `Bearer ${token}`, Accept: 'application/json'},
    });
  } catch { throw new Error('Sem conexão com o HUB. Verifique a internet e recarregue.'); }
  const rows = response.ok ? await response.json().catch(() => []) : [];
  const profile = Array.isArray(rows) ? rows[0] : null;
  if (!profile) throw new Error('Não foi possível confirmar o seu usuário no HUB. Recarregue a página ou entre no HUB novamente.');
  if (profile.active === false) throw new Error('Seu usuário está inativo no HUB.');
  return profile;
}

function showBlocked(message) {
  for (const id of ['setupForm', 'recoveryPanel', 'loginForm', 'recoverForm', 'forceChangeForm']) document.getElementById(id)?.classList.add('hidden');
  const sub = document.getElementById('authSubtitle'); if (sub) sub.textContent = 'Acesso pelo HUB';
  const msg = document.getElementById('authMessage'); if (msg) { msg.className = 'auth-message'; msg.textContent = message; }
}

/** Substitui o login local: o usuário do HUB vira o usuário do app neste navegador. */
export async function hubAuthGate(repo) {
  let profile;
  try { profile = await hubProfile(); } catch (error) {
    // fica na tela de acesso com o aviso (sem abrir o app e sem o login local)
    showBlocked(error.message);
    return new Promise(() => {});
  }
  const now = new Date().toISOString();
  const id = `hub-${profile.id}`;
  const role = profile.role === 'admin' ? ROLES.ADMIN : ROLES.USER;
  const record = await repo.get('settings', AUTH_SETTING_ID);
  const value = {users: [], recovery: null, ...(record?.value || {})};
  const users = Array.isArray(value.users) ? value.users.slice() : [];
  const index = users.findIndex(user => user.id === id);
  const user = {
    ...(index >= 0 ? users[index] : {createdAt: now}),
    id, name: String(profile.nome || profile.email || 'Usuário do HUB').trim().slice(0, 120),
    login: String(profile.email || id).trim().toLowerCase(), email: String(profile.email || '').trim().slice(0, 160),
    role, active: true, mustChangePassword: false, hubManaged: true, lastLoginAt: now, updatedAt: now,
  };
  if (index >= 0) users[index] = user; else users.push(user);
  await repo.put('settings', {id: AUTH_SETTING_ID, value: {...value, users}, updatedAt: now});
  // Base demonstrativa e projetos sem dono: ficam com quem abre, quando ainda não há administrador neste navegador.
  if (role !== ROLES.ADMIN && !users.some(item => item.role === ROLES.ADMIN && item.active !== false)) {
    const ids = new Set(users.map(item => item.id));
    for (const project of await repo.all('projects')) {
      if (!project.ownerUserId || !ids.has(project.ownerUserId)) await repo.put('projects', {...project, ownerUserId: id});
    }
  }
  document.body.classList.remove('auth-locked');
  document.documentElement.classList.add('hub-embedded');
  return {id, name: user.name, login: user.login, email: user.email, role, active: true, createdAt: user.createdAt, lastLoginAt: now, mustChangePassword: false};
}
