import { processDueEmails } from "./email-outbox.mjs";

const JSON_HEADERS = {
  "content-type": "application/json",
  "cache-control": "no-store"
};

const HTML_HEADERS = {
  "content-type": "text/html; charset=utf-8",
  "cache-control": "no-store"
};

const MANAGER_ROLES = new Set(["admin", "gestor"]);

export default async function handler(request) {
  if (request.method !== "POST") {
    return json(405, { error: "Metodo nao permitido." });
  }

  const supabaseUrl = getEnv("VITE_SUPABASE_URL") || getEnv("SUPABASE_URL");
  const supabaseAnonKey = getEnv("VITE_SUPABASE_ANON_KEY") || getEnv("SUPABASE_ANON_KEY");
  const serviceRoleKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
    return json(500, { error: "Variaveis Supabase ausentes no servidor." });
  }

  try {
    const payload = await parseFormPayload(request);
    const to = String(payload.to || "").trim().toLowerCase();
    const authorized = await authorizeDispatch({
      supabaseUrl,
      supabaseAnonKey,
      serviceRoleKey,
      token: payload.token,
      authToken: payload.authToken,
      targetEmail: to
    });

    if (!authorized.ok) {
      return respond(request, 401, { error: authorized.error || "Envio nao autorizado." });
    }

    const subject = String(payload.subject || "").trim();
    const htmlBody = String(payload.htmlBody || "").trim();
    const textBody = String(payload.body || "").trim();

    if (!to || !subject || (!htmlBody && !textBody)) {
      return respond(request, 400, { error: "Destinatario, assunto e corpo sao obrigatorios." });
    }

    const category = inferCategory(subject, payload.collaboratorName);
    const targetRef = `${String(payload.periodId || "sem-periodo")}:${Date.now()}`;
    const emailId = await queueEmail(supabaseUrl, serviceRoleKey, {
      to,
      subject,
      htmlBody: htmlBody || textToHtml(textBody),
      textBody,
      category,
      targetRef,
      toName: payload.collaboratorName || "",
      createdBy: authorized.userId || null
    });

    const processed = await processDueEmails(supabaseUrl, serviceRoleKey, 1);

    return respond(request, 200, {
      ok: true,
      queued: emailId,
      category,
      processed: processed.processed || 0,
      results: processed.results || []
    });
  } catch (error) {
    return respond(request, 400, { error: error?.message || "Nao foi possivel enviar o e-mail da Coordenacao Tributaria." });
  }
}

async function authorizeDispatch({ supabaseUrl, supabaseAnonKey, serviceRoleKey, token, authToken, targetEmail }) {
  const dispatchToken = getEnv("COORD_EMAIL_TOKEN") || getEnv("EMAIL_DISPATCH_TOKEN");
  const providedToken = String(token || "").trim();

  if (dispatchToken && providedToken && providedToken === dispatchToken) {
    return { ok: true, userId: null };
  }

  const bearer = String(authToken || "").trim();
  if (!bearer) {
    return { ok: false, error: "Token ou sessao do HUB nao informados." };
  }

  const authUser = await verifySession(supabaseUrl, supabaseAnonKey, bearer);
  const profile = await readProfile(supabaseUrl, serviceRoleKey, authUser.id);

  if (!profile?.active) {
    return { ok: false, error: "Usuario inativo ou sem perfil no HUB." };
  }

  const profileEmail = String(profile.email || "").trim().toLowerCase();
  const canSendAsManager = MANAGER_ROLES.has(profile.role);
  const canSendToSelf = Boolean(targetEmail && profileEmail && profileEmail === String(targetEmail).trim().toLowerCase());

  if (!canSendAsManager && !canSendToSelf) {
    return { ok: false, error: "Usuarios comuns podem enviar relatorios apenas para o proprio e-mail." };
  }

  return { ok: true, userId: authUser.id };
}

async function verifySession(supabaseUrl, anonKey, token) {
  const user = await supabaseRequest(`${trimUrl(supabaseUrl)}/auth/v1/user`, {
    headers: {
      apikey: anonKey,
      authorization: `Bearer ${token}`
    }
  });

  if (!user?.id) {
    throw new Error("Sessao Supabase invalida.");
  }

  return user;
}

async function readProfile(supabaseUrl, serviceRoleKey, userId) {
  const rows = await supabaseRequest(
    `${trimUrl(supabaseUrl)}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=email,role,active&limit=1`,
    {
      headers: serviceHeaders(serviceRoleKey)
    }
  );

  return Array.isArray(rows) ? rows[0] : null;
}

async function queueEmail(supabaseUrl, serviceRoleKey, payload) {
  return supabaseRequest(`${trimUrl(supabaseUrl)}/rest/v1/rpc/queue_email`, {
    method: "POST",
    headers: {
      ...serviceHeaders(serviceRoleKey),
      "content-type": "application/json"
    },
    body: JSON.stringify({
      p_to_email: payload.to,
      p_to_name: payload.toName,
      p_subject: payload.subject,
      p_html_body: payload.htmlBody,
      p_text_body: payload.textBody,
      p_category: payload.category,
      p_target_type: "coordenacao",
      p_target_ref: payload.targetRef,
      p_scheduled_for: new Date().toISOString(),
      p_dedupe_key: `${payload.category}:${payload.to}:${payload.targetRef}`,
      p_created_by: payload.createdBy
    })
  });
}

async function parseFormPayload(request) {
  const contentType = request.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    return request.json();
  }

  const text = await request.text();
  const params = new URLSearchParams(text);
  return Object.fromEntries(params.entries());
}

async function supabaseRequest(url, options) {
  const response = await fetch(url, options);
  const text = await response.text();
  const data = parseJson(text);

  if (!response.ok) {
    throw new Error(data?.message || data?.msg || data?.error || text || response.statusText);
  }

  return data;
}

function respond(request, status, body) {
  const acceptsJson = (request.headers.get("accept") || "").includes("application/json");
  if (acceptsJson) return json(status, body);

  return new Response(
    `<!doctype html><html><body><pre>${escapeHtml(JSON.stringify(body))}</pre></body></html>`,
    {
      status,
      headers: HTML_HEADERS
    }
  );
}

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: JSON_HEADERS
  });
}

function serviceHeaders(serviceRoleKey) {
  return {
    apikey: serviceRoleKey,
    authorization: `Bearer ${serviceRoleKey}`
  };
}

function inferCategory(subject, collaboratorName) {
  const value = `${subject || ""} ${collaboratorName || ""}`.toLowerCase();
  if (value.includes("pauta")) return "coord_pautas";
  if (value.includes("avali") || value.includes("lembrete") || value.includes("resumo")) return "coord_avaliacoes";
  return "coord_email";
}

function textToHtml(value) {
  return `<p>${escapeHtml(value).replace(/\n/g, "<br>")}</p>`;
}

function getEnv(name) {
  return globalThis.Netlify?.env?.get?.(name) || process.env[name] || "";
}

function trimUrl(value) {
  return value.replace(/\/+$/, "");
}

function parseJson(value) {
  if (!value) return null;

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
