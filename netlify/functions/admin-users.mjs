import { assertDeliveryConfig, isDeliveryEnabled, sendEmail } from "./email-outbox.mjs";

const JSON_HEADERS = {
  "content-type": "application/json",
  "cache-control": "no-store"
};

const ROLES = new Set(["admin", "gestor", "colaborador"]);

export default async function handler(request) {
  if (request.method !== "POST") {
    return json(405, { error: "Método não permitido." });
  }

  const supabaseUrl = getEnv("VITE_SUPABASE_URL") || getEnv("SUPABASE_URL");
  const supabaseAnonKey = getEnv("VITE_SUPABASE_ANON_KEY") || getEnv("SUPABASE_ANON_KEY");
  const serviceRoleKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
    return json(500, { error: "Variáveis Supabase ausentes no servidor." });
  }

  const token = readBearerToken(request.headers.get("authorization"));
  if (!token) {
    return json(401, { error: "Sessão não informada." });
  }

  const payload = await parseBody(request);
  if (!payload.ok) return json(400, { error: payload.error });

  const body = payload.value;
  const action = String(body.action || "upsert-user");
  const ctx = { supabaseUrl, supabaseAnonKey, serviceRoleKey };

  try {
    const authUser = await verifySession(supabaseUrl, supabaseAnonKey, token);

    // Troca da própria senha: qualquer usuário ativo, salvo bloqueio do administrador.
    if (action === "trocar-propria-senha") {
      return json(200, await trocarPropriaSenha(ctx, authUser, body));
    }

    const profile = normalizeProfile(body);
    if (!profile.email || !profile.nome) {
      return json(400, { error: "Nome e e-mail são obrigatórios." });
    }
    if (!ROLES.has(profile.role)) {
      return json(400, { error: "Perfil inválido." });
    }

    await assertAdminCaller(supabaseUrl, serviceRoleKey, authUser.id);

    const marcas = lerMarcasDeSenha(body);
    // Confere antes de criar/alterar qualquer coisa se o banco já tem as marcas de senha (patch_senhas_v2.sql).
    if (action === "marcas-senha" || action === "reset-password" || body.createAuthUser !== false) {
      await lerPerfilParaSenha(ctx, authUser.id);
    }
    const gerarSenha = body.gerarSenha === true;
    const precisaSenha = action === "reset-password" || (action === "upsert-user" && body.createAuthUser !== false);
    const password = precisaSenha ? (gerarSenha ? gerarSenhaProvisoria() : String(body.password || "").trim()) : "";
    if (precisaSenha && password.length < 8) {
      return json(400, { error: "Informe uma senha inicial com pelo menos 8 caracteres." });
    }

    // Só as marcas (exigir troca / bloquear troca), sem mexer na senha.
    if (action === "marcas-senha") {
      if (!profile.id) return json(400, { error: "ID do usuário não informado." });
      await gravarMarcasDeSenha(ctx, profile.id, marcas);
      return json(200, { ok: true, marcas });
    }

    if (action === "reset-password") {
      if (!profile.id) {
        return json(400, { error: "ID Auth Supabase não informado para redefinir senha." });
      }

      // O banco só aceita a troca com esta autorização (ver supabase/patch_senhas_somente_admin.sql).
      await authorizePasswordChange(supabaseUrl, serviceRoleKey, profile.id, authUser.id);
      try {
        await resetAuthUserPassword(supabaseUrl, serviceRoleKey, profile.id, password);
      } catch (resetError) {
        await revokePasswordAuthorization(supabaseUrl, serviceRoleKey, profile.id);
        throw resetError;
      }
      await gravarMarcasDeSenha(ctx, profile.id, marcas);
      const email = await sendPasswordResetEmail(supabaseUrl, serviceRoleKey, profile, password, authUser.id, { novo: false, exigirTroca: marcas.senha_provisoria });
      return json(200, { ok: true, ...email, ...senhaParaOAdmin(email, gerarSenha, password) });
    }

    let userId = profile.id;
    const criando = body.createAuthUser !== false;

    if (criando) {
      const created = await createAuthUser(supabaseUrl, serviceRoleKey, profile, password);
      userId = created.user?.id || created.id || created.user_id;
    }

    if (!userId) {
      return json(400, { error: "ID do usuário Auth não encontrado." });
    }

    const savedProfile = await upsertProfile(supabaseUrl, serviceRoleKey, {
      id: userId,
      email: profile.email,
      nome: profile.nome,
      role: profile.role,
      active: profile.active
    });

    if (!criando) return json(200, { profile: savedProfile });

    await gravarMarcasDeSenha(ctx, userId, marcas);
    const email = await sendPasswordResetEmail(supabaseUrl, serviceRoleKey, { ...profile, id: userId }, password, authUser.id, { novo: true, exigirTroca: marcas.senha_provisoria });
    return json(200, { profile: savedProfile, ...email, ...senhaParaOAdmin(email, gerarSenha, password) });
  } catch (error) {
    const statusCode = error.statusCode && error.statusCode >= 400 ? error.statusCode : 400;
    return json(statusCode, { error: toPublicMessage(error) });
  }
}

// ---------------------------------------------------------------------------------------------
// Senhas v2 (27/11/2026): troca pelo próprio usuário, senha provisória e bloqueio por usuário.

const LETRAS_SENHA = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";

/** Senha provisória aleatória (sem caracteres que se confundem: 0/O, 1/l/I), ex.: "Kp7q-Xm3r-T9wz". */
export function gerarSenhaProvisoria() {
  for (;;) {
    const bytes = crypto.getRandomValues(new Uint32Array(12));
    const letras = Array.from(bytes, (n) => LETRAS_SENHA[n % LETRAS_SENHA.length]).join("");
    if (/[A-Z]/.test(letras) && /[a-z]/.test(letras) && /\d/.test(letras)) {
      return `${letras.slice(0, 4)}-${letras.slice(4, 8)}-${letras.slice(8, 12)}`;
    }
  }
}

/** Bloquear a troca e exigir troca no primeiro acesso não combinam: o bloqueio prevalece. */
export function lerMarcasDeSenha(body) {
  const bloqueada = body.bloquearTroca === true;
  return { senha_troca_bloqueada: bloqueada, senha_provisoria: !bloqueada && body.exigirTroca !== false };
}

/** A senha só volta para a tela do administrador quando foi gerada pelo HUB e o e-mail não saiu. */
function senhaParaOAdmin(email, gerada, password) {
  return gerada && !email.emailSent ? { senhaParaInformar: password } : {};
}

async function gravarMarcasDeSenha(ctx, userId, marcas) {
  try {
    await supabaseRequest(`${trimUrl(ctx.supabaseUrl)}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}`, {
      method: "PATCH",
      headers: { ...serviceHeaders(ctx.serviceRoleKey), "content-type": "application/json", prefer: "return=minimal" },
      body: JSON.stringify(marcas)
    });
  } catch (error) {
    if (/senha_provisoria|senha_troca_bloqueada|column/i.test(error?.message || "")) {
      throw httpError(500, "Atualização pendente no banco: execute supabase/patch_senhas_v2.sql no Supabase.");
    }
    throw error;
  }
}

async function lerPerfilParaSenha(ctx, userId) {
  try {
    const rows = await supabaseRequest(
      `${trimUrl(ctx.supabaseUrl)}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=id,email,nome,role,active,senha_provisoria,senha_troca_bloqueada&limit=1`,
      { headers: serviceHeaders(ctx.serviceRoleKey) }
    );
    return Array.isArray(rows) ? rows[0] : null;
  } catch (error) {
    if (/senha_provisoria|senha_troca_bloqueada|column/i.test(error?.message || "")) {
      throw httpError(500, "Atualização pendente no banco: execute supabase/patch_senhas_v2.sql no Supabase.");
    }
    throw error;
  }
}

async function conferirSenhaAtual(ctx, email, senha) {
  const resposta = await fetch(`${trimUrl(ctx.supabaseUrl)}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ctx.supabaseAnonKey, "content-type": "application/json" },
    body: JSON.stringify({ email, password: senha })
  });
  return resposta.ok;
}

export async function trocarPropriaSenha(ctx, authUser, body) {
  const atual = String(body.senhaAtual || "");
  const nova = String(body.novaSenha || "");
  const perfil = await lerPerfilParaSenha(ctx, authUser.id);
  if (!perfil?.active) throw httpError(403, "Usuário desativado.");
  const admin = perfil.role === "admin";
  if (perfil.senha_troca_bloqueada && !perfil.senha_provisoria && !admin) {
    throw httpError(403, "A troca de senha está bloqueada pela coordenação. Fale com o administrador.");
  }
  if (nova.length < 8) throw httpError(400, "A nova senha precisa ter pelo menos 8 caracteres.");
  if (!/[A-Za-zÀ-ÿ]/.test(nova) || !/\d/.test(nova)) throw httpError(400, "Use letras e números na nova senha.");
  if (nova === atual) throw httpError(400, "A nova senha precisa ser diferente da atual.");
  if (!(await conferirSenhaAtual(ctx, perfil.email || authUser.email, atual))) {
    throw httpError(400, "Senha atual incorreta.");
  }

  await authorizePasswordChange(ctx.supabaseUrl, ctx.serviceRoleKey, authUser.id, authUser.id);
  try {
    await resetAuthUserPassword(ctx.supabaseUrl, ctx.serviceRoleKey, authUser.id, nova);
  } catch (error) {
    await revokePasswordAuthorization(ctx.supabaseUrl, ctx.serviceRoleKey, authUser.id);
    throw error;
  }
  if (perfil.senha_provisoria) {
    await gravarMarcasDeSenha(ctx, authUser.id, { senha_provisoria: false, senha_troca_bloqueada: Boolean(perfil.senha_troca_bloqueada) });
  }
  if (!admin) await avisarAdminsTrocaDeSenha(ctx, perfil);
  return { ok: true };
}

/** Sino dos administradores: "Fulano alterou a própria senha" (sem a senha, claro). */
async function avisarAdminsTrocaDeSenha(ctx, perfil) {
  try {
    const admins = await supabaseRequest(`${trimUrl(ctx.supabaseUrl)}/rest/v1/profiles?role=eq.admin&active=eq.true&select=id`, {
      headers: serviceHeaders(ctx.serviceRoleKey)
    });
    const agora = new Date().toISOString();
    const linhas = (Array.isArray(admins) ? admins : []).map((a) => ({
      user_id: a.id,
      tipo: "seguranca_senha",
      titulo: "Senha alterada pelo usuário",
      body: `${perfil.nome || perfil.email} alterou a própria senha no HUB.`,
      meta: JSON.stringify({ userId: perfil.id, email: perfil.email }),
      dedupe_key: `senha_propria:${perfil.id}:${Date.now()}`,
      route: "admin",
      tone: "info",
      active: true,
      created_at: agora,
      updated_at: agora
    }));
    if (!linhas.length) return;
    await supabaseRequest(`${trimUrl(ctx.supabaseUrl)}/rest/v1/notificacoes`, {
      method: "POST",
      headers: { ...serviceHeaders(ctx.serviceRoleKey), "content-type": "application/json", prefer: "return=minimal" },
      body: JSON.stringify(linhas)
    });
  } catch (error) {
    console.warn("Não foi possível avisar os administradores da troca de senha.", error?.message || error);
  }
}

async function verifySession(supabaseUrl, anonKey, token) {
  const user = await supabaseRequest(`${trimUrl(supabaseUrl)}/auth/v1/user`, {
    headers: {
      apikey: anonKey,
      authorization: `Bearer ${token}`
    }
  });

  if (!user?.id) {
    throw httpError(401, "Sessão inválida.");
  }

  return user;
}

async function assertAdminCaller(supabaseUrl, serviceRoleKey, userId) {
  const rows = await supabaseRequest(
    `${trimUrl(supabaseUrl)}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=role,active&limit=1`,
    {
      headers: serviceHeaders(serviceRoleKey)
    }
  );

  const caller = Array.isArray(rows) ? rows[0] : null;

  if (!caller?.active || caller.role !== "admin") {
    throw httpError(403, "Apenas administradores podem criar usuários.");
  }
}

async function createAuthUser(supabaseUrl, serviceRoleKey, profile, password) {
  return supabaseRequest(`${trimUrl(supabaseUrl)}/auth/v1/admin/users`, {
    method: "POST",
    headers: {
      ...serviceHeaders(serviceRoleKey),
      "content-type": "application/json"
    },
    body: JSON.stringify({
      email: profile.email,
      password,
      email_confirm: true,
      user_metadata: {
        nome: profile.nome,
        role: profile.role
      }
    })
  });
}

async function resetAuthUserPassword(supabaseUrl, serviceRoleKey, userId, password) {
  return supabaseRequest(`${trimUrl(supabaseUrl)}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
    method: "PUT",
    headers: {
      ...serviceHeaders(serviceRoleKey),
      "content-type": "application/json"
    },
    body: JSON.stringify({
      password
    })
  });
}

async function authorizePasswordChange(supabaseUrl, serviceRoleKey, userId, adminId) {
  const expiresAt = new Date(Date.now() + 2 * 60 * 1000).toISOString();
  try {
    await supabaseRequest(`${trimUrl(supabaseUrl)}/rest/v1/senha_autorizacoes?on_conflict=user_id`, {
      method: "POST",
      headers: {
        ...serviceHeaders(serviceRoleKey),
        "content-type": "application/json",
        prefer: "resolution=merge-duplicates,return=minimal"
      },
      body: JSON.stringify({ user_id: userId, autorizado_por: adminId, expira_em: expiresAt })
    });
  } catch (error) {
    console.error("Falha ao autorizar troca de senha.", error?.message || error);
    throw httpError(500, "Não foi possível autorizar a troca de senha. Verifique se o patch_senhas_somente_admin.sql foi aplicado no Supabase.");
  }
}

async function revokePasswordAuthorization(supabaseUrl, serviceRoleKey, userId) {
  try {
    await supabaseRequest(`${trimUrl(supabaseUrl)}/rest/v1/senha_autorizacoes?user_id=eq.${encodeURIComponent(userId)}`, {
      method: "DELETE",
      headers: { ...serviceHeaders(serviceRoleKey), prefer: "return=minimal" }
    });
  } catch (error) {
    console.warn("Não foi possível remover a autorização de senha.", error?.message || error);
  }
}

// A senha provisoria nunca e gravada no banco: o e-mail sai na hora (quando o envio
// esta ativo no Netlify) e a fila email_outbox guarda apenas um registro SEM a senha.
// Motivo: a fila pode ser consultada por gestores e o envio pode estar desligado.
async function sendPasswordResetEmail(supabaseUrl, serviceRoleKey, profile, password, createdBy, opcoes = {}) {
  const appUrl = getAppBaseUrl();
  const novo = opcoes.novo === true;
  const exigirTroca = opcoes.exigirTroca !== false;
  const subject = novo ? "Seu acesso ao HUB Depto Tributário" : "Senha provisória do HUB Depto Tributário";
  const dedupeKey = `password_reset:${profile.id}:${Date.now()}`;
  const abertura = novo
    ? `Olá, ${profile.nome}! Seu acesso ao HUB Depto Tributário da H. Teixeira foi criado.`
    : "Uma senha provisória foi gerada para seu acesso ao HUB Depto Tributário.";
  const rotuloSenha = exigirTroca ? "Senha provisória" : "Senha";
  const aviso = exigirTroca ? "No primeiro acesso, o HUB vai pedir que você crie uma senha nova, só sua." : "";
  const htmlBody = (secret) =>
    `<p>${escapeHtml(abertura)}</p>` +
    `<p><strong>E-mail:</strong> ${escapeHtml(profile.email)}</p>` +
    `<p><strong>${rotuloSenha}:</strong> ${escapeHtml(secret)}</p>` +
    (aviso ? `<p>${escapeHtml(aviso)}</p>` : "") +
    `<p>Acesse: <a href="${escapeHtml(appUrl)}">${escapeHtml(appUrl)}</a></p>`;
  const textBody = (secret) =>
    `${abertura}\n` +
    `E-mail: ${profile.email}\n` +
    `${rotuloSenha}: ${secret}\n` +
    (aviso ? `${aviso}\n` : "") +
    `Acesse: ${appUrl}`;

  let result = { emailSent: false, emailReason: "envio de e-mails desativado no Netlify (EMAIL_DELIVERY_ENABLED)" };
  let sent = null;
  if (isDeliveryEnabled()) {
    try {
      assertDeliveryConfig();
      sent = await sendEmail({
        dedupe_key: dedupeKey,
        to_email: profile.email,
        to_name: profile.nome,
        subject,
        html_body: htmlBody(password),
        text_body: textBody(password)
      });
      result = { emailSent: true };
    } catch (error) {
      result = { emailSent: false, emailReason: error?.message || "falha no envio" };
    }
  }

  // Registro para auditoria, sem a senha.
  try {
    const omitted = "[senha omitida por segurança]";
    const emailId = await supabaseRequest(`${trimUrl(supabaseUrl)}/rest/v1/rpc/queue_email`, {
      method: "POST",
      headers: { ...serviceHeaders(serviceRoleKey), "content-type": "application/json" },
      body: JSON.stringify({
        p_to_email: profile.email,
        p_to_name: profile.nome,
        p_subject: subject,
        p_html_body: htmlBody(omitted),
        p_text_body: textBody(omitted),
        p_category: "usuario_senha",
        p_target_type: "profile",
        p_target_ref: profile.id,
        p_scheduled_for: new Date().toISOString(),
        p_dedupe_key: dedupeKey,
        p_created_by: createdBy
      })
    });
    if (emailId) {
      await supabaseRequest(`${trimUrl(supabaseUrl)}/rest/v1/email_outbox?id=eq.${encodeURIComponent(emailId)}`, {
        method: "PATCH",
        headers: { ...serviceHeaders(serviceRoleKey), "content-type": "application/json", prefer: "return=minimal" },
        body: JSON.stringify(
          sent
            ? { status: "sent", sent_at: new Date().toISOString(), provider: sent.provider, provider_message_id: sent.id || null, attempts: 1, last_error: null }
            : { status: "skipped", last_error: result.emailReason }
        )
      });
    }
  } catch (error) {
    console.warn("Não foi possível registrar o envio da senha provisória.", error?.message || error);
  }

  return result;
}

async function upsertProfile(supabaseUrl, serviceRoleKey, profile) {
  const rows = await supabaseRequest(
    `${trimUrl(supabaseUrl)}/rest/v1/profiles?on_conflict=id&select=id,email,nome,role,active,created_at,updated_at`,
    {
      method: "POST",
      headers: {
        ...serviceHeaders(serviceRoleKey),
        "content-type": "application/json",
        prefer: "resolution=merge-duplicates,return=representation"
      },
      body: JSON.stringify(profile)
    }
  );

  return Array.isArray(rows) ? rows[0] : rows;
}

async function supabaseRequest(url, options) {
  const response = await fetch(url, options);
  const text = await response.text();
  const data = parseJson(text);

  if (!response.ok) {
    throw httpError(response.status, extractSupabaseMessage(data, text, response.statusText));
  }

  return data;
}

function serviceHeaders(serviceRoleKey) {
  return {
    apikey: serviceRoleKey,
    authorization: `Bearer ${serviceRoleKey}`
  };
}

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: JSON_HEADERS
  });
}

function getEnv(name) {
  return globalThis.Netlify?.env?.get?.(name) || process.env[name] || "";
}

function readBearerToken(value) {
  if (!value) return "";
  const match = value.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || "";
}

async function parseBody(request) {
  try {
    return { ok: true, value: await request.json() };
  } catch {
    return { ok: false, error: "JSON inválido." };
  }
}

function parseJson(value) {
  if (!value) return null;

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function normalizeProfile(body) {
  return {
    id: typeof body.id === "string" ? body.id.trim() : "",
    email: typeof body.email === "string" ? body.email.trim().toLowerCase() : "",
    nome: typeof body.nome === "string" ? body.nome.trim() : "",
    role: typeof body.role === "string" ? body.role : "colaborador",
    active: body.active !== false
  };
}

function trimUrl(value) {
  return value.replace(/\/+$/, "");
}

function getAppBaseUrl() {
  return getEnv("APP_BASE_URL") || getEnv("URL") || "https://hub-depto-tributario-ht.netlify.app";
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function extractSupabaseMessage(data, text, fallback) {
  return data?.msg || data?.message || data?.error_description || data?.error || text || fallback || "Erro Supabase.";
}

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function toPublicMessage(error) {
  const message = error?.message || "Não foi possível criar o usuário.";

  if (/already registered|already exists|duplicate/i.test(message)) {
    return "Este e-mail já possui usuário no Supabase Auth.";
  }

  return message;
}
