// AUTH01 — login local por estação (base continua no navegador de cada PC).
// Usuários ficam no store 'settings' (registro 'auth-users'), sem mudar o schema IndexedDB v9 nem o formato .htaf.
// Senhas: PBKDF2-SHA-256 (310.000 iterações) com sal aleatório; nunca são guardadas em texto.
// Limite honesto: protege o uso do app; quem tiver acesso técnico ao navegador ainda consegue ler o IndexedDB.

export const AUTH_SETTING_ID = 'auth-users';
export const DEFAULT_ADMIN_LOGIN = '';
export const ROLES = Object.freeze({ADMIN: 'ADMIN', USER: 'USER'});
export const MIN_PASSWORD = 6;
const ITERATIONS = 310000;
const SESSION_KEY = 'ht-af-session';

const encoder = new TextEncoder();
const toBase64 = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const fromBase64 = text => Uint8Array.from(atob(text), char => char.charCodeAt(0));
const nowIso = () => new Date().toISOString();
const newId = () => `user-${Date.now()}-${globalThis.crypto.randomUUID()}`;
export const normalizeLogin = value => String(value || '').trim().toLowerCase();

async function derive(secret, saltBytes, iterations = ITERATIONS) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(String(secret)), 'PBKDF2', false, ['deriveBits']);
  return toBase64(await crypto.subtle.deriveBits({name: 'PBKDF2', hash: 'SHA-256', salt: saltBytes, iterations}, key, 256));
}

export async function hashSecret(secret) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return {salt: toBase64(salt), hash: await derive(secret, salt), iterations: ITERATIONS};
}

async function verifySecret(secret, record) {
  if (!record?.hash || !record?.salt) return false;
  const candidate = await derive(secret, fromBase64(record.salt), record.iterations || ITERATIONS);
  // comparação sem retorno antecipado
  let diff = candidate.length ^ record.hash.length;
  for (let index = 0; index < Math.max(candidate.length, record.hash.length); index += 1) diff |= (candidate.charCodeAt(index) || 0) ^ (record.hash.charCodeAt(index) || 0);
  return diff === 0;
}

async function readState(repo) {
  const record = await repo.get('settings', AUTH_SETTING_ID);
  return {users: [], recovery: null, ...(record?.value || {})};
}
async function writeState(repo, value) {
  await repo.put('settings', {id: AUTH_SETTING_ID, value, updatedAt: nowIso()});
  return value;
}
const publicUser = user => user && ({id: user.id, name: user.name, login: user.login, email: user.email || '', role: user.role, active: user.active !== false, createdAt: user.createdAt, lastLoginAt: user.lastLoginAt || null, mustChangePassword: Boolean(user.mustChangePassword)});
const activeAdmins = users => users.filter(user => user.role === ROLES.ADMIN && user.active !== false);

function validatePassword(password) {
  if (String(password || '').length < MIN_PASSWORD) throw new Error(`A senha deve ter pelo menos ${MIN_PASSWORD} caracteres.`);
}
function requireAdmin(actor) {
  if (actor?.role !== ROLES.ADMIN) throw new Error('Somente o administrador pode gerenciar usuários.');
}

export async function listUsers(repo) { return (await readState(repo)).users.map(publicUser); }
export async function hasUsers(repo) { return (await readState(repo)).users.length > 0; }
export async function getUser(repo, id) { return publicUser((await readState(repo)).users.find(user => user.id === id)); }

function recoveryKey() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const chars = [...bytes].map(byte => alphabet[byte % alphabet.length]).join('');
  return chars.match(/.{4}/g).join('-');
}

/** Primeiro acesso da estação: cria o administrador e devolve a chave de recuperação (mostrada uma única vez). */
export async function setupFirstAdmin(repo, {name, login = DEFAULT_ADMIN_LOGIN, email = '', password}) {
  const state = await readState(repo);
  if (state.users.length) throw new Error('Esta estação já possui usuários cadastrados.');
  validatePassword(password);
  const key = recoveryKey();
  const user = {id: newId(), name: String(name || 'Administrador').trim().slice(0, 120), login: normalizeLogin(login), email: String(email || login || '').trim().slice(0, 160), role: ROLES.ADMIN, active: true, createdAt: nowIso(), updatedAt: nowIso(), lastLoginAt: nowIso(), ...(await hashSecret(password))};
  if (!user.login) throw new Error('Informe o usuário (login).');
  await writeState(repo, {...state, users: [user], recovery: await hashSecret(key.replace(/-/g, ''))});
  return {user: publicUser(user), recoveryKey: key};
}

export async function authenticate(repo, login, password) {
  const state = await readState(repo);
  const user = state.users.find(item => item.login === normalizeLogin(login));
  const ok = user ? await verifySecret(password, user) : await verifySecret(password, {salt: toBase64(new Uint8Array(16)), hash: 'x'});
  if (!user || !ok) throw new Error('Usuário ou senha inválidos.');
  if (user.active === false) throw new Error('Usuário desativado. Procure o administrador.');
  user.lastLoginAt = nowIso();
  await writeState(repo, state);
  return publicUser(user);
}

export async function createUser(repo, actor, {name, login, email = '', password, role = ROLES.USER}) {
  requireAdmin(actor);
  validatePassword(password);
  const state = await readState(repo);
  const normalized = normalizeLogin(login);
  if (!normalized) throw new Error('Informe o usuário (login).');
  if (!String(name || '').trim()) throw new Error('Informe o nome.');
  if (state.users.some(user => user.login === normalized)) throw new Error('Já existe um usuário com esse login nesta estação.');
  const user = {id: newId(), name: String(name).trim().slice(0, 120), login: normalized, email: String(email || '').trim().slice(0, 160), role: role === ROLES.ADMIN ? ROLES.ADMIN : ROLES.USER, active: true, mustChangePassword: true, createdAt: nowIso(), updatedAt: nowIso(), createdBy: actor.id, ...(await hashSecret(password))};
  state.users.push(user);
  await writeState(repo, state);
  return publicUser(user);
}

export async function updateUser(repo, actor, id, changes = {}) {
  requireAdmin(actor);
  const state = await readState(repo);
  const user = state.users.find(item => item.id === id);
  if (!user) throw new Error('Usuário não encontrado.');
  const next = {...user};
  if (changes.name != null) next.name = String(changes.name).trim().slice(0, 120) || user.name;
  if (changes.email != null) next.email = String(changes.email).trim().slice(0, 160);
  if (changes.role) next.role = changes.role === ROLES.ADMIN ? ROLES.ADMIN : ROLES.USER;
  if (changes.active != null) next.active = Boolean(changes.active);
  const others = state.users.filter(item => item.id !== id);
  if (!activeAdmins([...others, next]).length) throw new Error('É preciso manter pelo menos um administrador ativo.');
  Object.assign(user, next, {updatedAt: nowIso()});
  await writeState(repo, state);
  return publicUser(user);
}

/** ADM redefine a senha de alguém (o usuário troca no próximo acesso). */
export async function resetPassword(repo, actor, id, password) {
  requireAdmin(actor);
  validatePassword(password);
  const state = await readState(repo);
  const user = state.users.find(item => item.id === id);
  if (!user) throw new Error('Usuário não encontrado.');
  Object.assign(user, await hashSecret(password), {mustChangePassword: user.id !== actor.id, updatedAt: nowIso()});
  await writeState(repo, state);
  return publicUser(user);
}

export async function changeOwnPassword(repo, userId, currentPassword, newPassword) {
  validatePassword(newPassword);
  const state = await readState(repo);
  const user = state.users.find(item => item.id === userId);
  if (!user || !(await verifySecret(currentPassword, user))) throw new Error('Senha atual incorreta.');
  Object.assign(user, await hashSecret(newPassword), {mustChangePassword: false, updatedAt: nowIso()});
  await writeState(repo, state);
  return publicUser(user);
}

/** "Esqueci a senha do ADM": a chave de recuperação da estação redefine a senha de um administrador. */
export async function recoverAdmin(repo, key, login, newPassword) {
  validatePassword(newPassword);
  const state = await readState(repo);
  if (!state.recovery || !(await verifySecret(String(key || '').toUpperCase().replace(/[^A-Z0-9]/g, ''), state.recovery))) throw new Error('Chave de recuperação inválida.');
  const user = state.users.find(item => item.login === normalizeLogin(login) && item.role === ROLES.ADMIN);
  if (!user) throw new Error('Administrador não encontrado com esse login.');
  Object.assign(user, await hashSecret(newPassword), {active: true, mustChangePassword: false, updatedAt: nowIso()});
  await writeState(repo, state);
  return publicUser(user);
}

/** Preserva usuários ao limpar a base local (clearAll apaga o store settings). */
export async function withAuthPreserved(repo, action) {
  const saved = await repo.get('settings', AUTH_SETTING_ID);
  try { return await action(); } finally { if (saved) await repo.put('settings', saved); }
}

// --- visibilidade de projetos ---------------------------------------------------------------
export const canSeeProject = (user, project) => Boolean(user) && (user.role === ROLES.ADMIN || project?.ownerUserId === user.id);
export const visibleProjects = (user, projects = []) => projects.filter(project => canSeeProject(user, project));

/** Projetos sem dono (criados antes do login ou vindos de backup antigo) passam ao 1º administrador. */
export async function claimOrphanProjects(repo) {
  const users = (await readState(repo)).users;
  const admin = activeAdmins(users)[0];
  if (!admin) return 0;
  const ids = new Set(users.map(user => user.id));
  let changed = 0;
  for (const project of await repo.all('projects')) {
    if (project.ownerUserId && ids.has(project.ownerUserId)) continue;
    await repo.put('projects', {...project, ownerUserId: admin.id});
    changed += 1;
  }
  return changed;
}

export async function setProjectOwner(repo, projectId, userId) {
  const project = await repo.get('projects', projectId);
  if (!project) throw new Error('Projeto não encontrado.');
  return repo.put('projects', {...project, ownerUserId: userId});
}

// --- sessão (fecha junto com a janela do navegador) ------------------------------------------
export function saveSession(user) { try { sessionStorage.setItem(SESSION_KEY, JSON.stringify({userId: user.id, at: nowIso()})); } catch {} }
export function readSession() { try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null'); } catch { return null; } }
export function clearSession() { try { sessionStorage.removeItem(SESSION_KEY); } catch {} }
