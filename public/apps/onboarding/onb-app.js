/*
 * Onboarding no HUB — ambiente contratual (Contrato, Adendo, matriz, itens, checklist e declaração).
 *
 * A tela é a mesma do Onboarding 1.1.35 (contract-workspace.js, copiado sem alterações). Aqui ficam só a sessão
 * do HUB e a ordem geral do checklist, salva no banco do HUB (onb_sessao / onb_checklist_ordem_salvar).
 * Clientes, portal, pacotes e avisos aos clientes continuam no Onboarding do servidor do escritório.
 */
import { initializeContractWorkspaces, renderContractWorkspace } from "./js/contract-workspace.js?v=1.1.35";

const CFG_KEY = "hub_supabase_public";
const SERVIDOR = "http://192.168.0.200:8767/";
const realFetch = window.fetch.bind(window);

// ------------------------------------------------------------------ sessão do HUB (mesmo esquema dos outros apps)
let hubWindow = null;
try {
  hubWindow = window.top !== window ? window.parent : window.opener && !window.opener.closed ? window.opener : null;
} catch (_) {
  hubWindow = null;
}
const auth = { token: "", exp: 0, url: "", anonKey: "" };
let waiting = [];

function jwtExp(token) {
  try {
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return Number(payload.exp || 0) * 1000;
  } catch (_) {
    return 0;
  }
}
function readStoredConfig() {
  try {
    const cfg = JSON.parse(localStorage.getItem(CFG_KEY) || "null");
    if (cfg && cfg.url && cfg.anonKey) {
      auth.url = auth.url || cfg.url;
      auth.anonKey = auth.anonKey || cfg.anonKey;
    }
  } catch (_) { /* sem configuração guardada */ }
}
function readStoredSession() {
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (!/^sb-.*-auth-token$/.test(key || "")) continue;
      const data = JSON.parse(localStorage.getItem(key) || "null");
      const session = data && (data.currentSession || data);
      if (session && session.access_token) return session.access_token;
    }
  } catch (_) { /* sem sessão guardada */ }
  return "";
}
function acceptToken(data) {
  if (!data || !data.token) return;
  auth.token = data.token;
  auth.exp = jwtExp(data.token);
  if (data.supabaseUrl) auth.url = data.supabaseUrl;
  if (data.supabaseAnonKey) auth.anonKey = data.supabaseAnonKey;
  const list = waiting;
  waiting = [];
  list.forEach((fn) => fn());
}
window.addEventListener("message", (event) => {
  if (event.origin !== location.origin || !event.data) return;
  if (event.data.type === "hub-auth-token") acceptToken(event.data);
});
function askHub(timeoutMs) {
  return new Promise((resolve) => {
    if (!hubWindow) return resolve(false);
    let done = false;
    waiting.push(() => { if (!done) { done = true; resolve(true); } });
    try { hubWindow.postMessage({ type: "hub:auth-request" }, location.origin); } catch (_) { /* janela do HUB indisponível */ }
    setTimeout(() => { if (!done) { done = true; resolve(false); } }, timeoutMs || 2500);
  });
}
let pedindo = null;
async function getToken(force) {
  readStoredConfig();
  if (!force && auth.token && auth.exp - Date.now() > 90000) return auth.token;
  if (!pedindo) pedindo = askHub(2500).finally(() => { pedindo = null; });
  await pedindo;
  if (!auth.token || auth.exp - Date.now() < 30000) {
    const stored = readStoredSession();
    if (stored && jwtExp(stored) - Date.now() > 30000) { auth.token = stored; auth.exp = jwtExp(stored); }
  }
  return auth.token;
}
function erro(message, code) {
  const e = new Error(message);
  e.code = code || "";
  return e;
}
async function rpc(fn, args, retried) {
  const token = await getToken(false);
  if (!auth.url || !auth.anonKey) throw erro("Configuração do HUB não encontrada. Abra o Onboarding pelo HUB.");
  if (!token) throw erro("Sessão do HUB não encontrada. Entre no HUB e abra o Onboarding por ele.");
  let response;
  try {
    response = await realFetch(auth.url.replace(/\/+$/, "") + "/rest/v1/rpc/" + fn, {
      method: "POST",
      headers: { apikey: auth.anonKey, Authorization: "Bearer " + token, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(args || {}),
    });
  } catch (_) {
    throw erro("Sem conexão com o HUB.");
  }
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (_) { data = text; }
  if (response.ok) return data;
  if ((response.status === 401 || (data && data.code === "PGRST301")) && !retried) {
    await getToken(true);
    return rpc(fn, args, true);
  }
  const code = (data && data.code) || "";
  if (code === "PGRST202") throw erro("O Onboarding ainda não foi ativado no banco do HUB (falta rodar o SQL do Onboarding no Supabase).", code);
  throw erro((data && (data.message || data.error)) || "Erro " + response.status, code);
}

// ------------------------------------------------------------------ tela
function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}
function toast(message, error) {
  const region = document.querySelector("#toast-region");
  if (!region) return;
  const item = document.createElement("div");
  item.className = "toast" + (error ? " toast--error" : "");
  item.textContent = message;
  region.append(item);
  setTimeout(() => item.remove(), error ? 7000 : 4200);
}
function pageHead(aviso) {
  return `
    <div class="page-head">
      <div class="page-head__copy">
        <span class="page-kicker">Documento contratual</span>
        <h2>Obrigações</h2>
        <p>Contrato, Adendo, matriz de responsabilidades e checklist em um único ambiente.</p>
      </div>
      <div class="page-head__actions">
        <a class="button button--soft button--small" href="${SERVIDOR}" target="_blank" rel="noopener noreferrer"
           title="Clientes, portal, pacotes e avisos aos clientes ficam no Onboarding do servidor (rede do escritório)">Onboarding do servidor ↗</a>
      </div>
    </div>
    ${aviso ? `<div class="onb-hub-aviso" role="status">${escapeHtml(aviso)}</div>` : ""}`;
}

async function iniciar() {
  const main = document.querySelector("#main-view");
  let sessao = null;
  let aviso = "";
  try {
    sessao = await rpc("onb_sessao", {});
  } catch (e) {
    aviso = e.code === "PGRST202"
      ? e.message + " O conteúdo abaixo pode ser consultado; a ordem do checklist definida pelo escritório ainda não está disponível."
      : (e.message || "Não foi possível consultar o HUB.") + " O conteúdo abaixo pode ser consultado normalmente.";
  }
  const admin = sessao && sessao.papel === "admin";
  document.documentElement.classList.add(admin ? "onb-papel-admin" : "onb-papel-leitor");
  // id: as marcações do checklist ficam neste navegador, separadas por usuário (como no original)
  const user = { id: (sessao && sessao.id) || "", name: (sessao && sessao.nome) || "", email: (sessao && sessao.email) || "", role: admin ? "admin" : "viewer" };
  main.innerHTML = pageHead(aviso) + renderContractWorkspace({ mode: "admin", user, checklistOrder: (sessao && sessao.checklist_order) || {} });
  initializeContractWorkspaces(document);
  const workspace = document.querySelector('[data-contract-workspace][data-contract-mode="admin"]');
  workspace?.addEventListener("ht:checklist-order-change", async (event) => {
    try {
      await rpc("onb_checklist_ordem_salvar", { p: event.detail.order });
      toast("Ordem do checklist salva para toda a equipe.");
    } catch (e) {
      event.detail.revert?.();
      toast(e.message || "Não foi possível salvar a ordem do checklist.", true);
    }
  });
}

iniciar().catch((e) => {
  console.error("Onboarding:", e);
  const main = document.querySelector("#main-view");
  if (main) main.innerHTML = `<div class="onb-hub-aviso">Não foi possível abrir o ambiente contratual: ${escapeHtml(e.message || e)}</div>`;
});
