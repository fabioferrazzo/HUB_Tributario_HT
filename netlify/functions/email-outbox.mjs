const JSON_HEADERS = {
  "content-type": "application/json",
  "cache-control": "no-store"
};

const EMAIL_SELECT =
  "id,dedupe_key,to_email,to_name,subject,html_body,text_body,category,target_type,target_ref,attempts,scheduled_for";

export default async function handler(request) {
  if (!["GET", "POST"].includes(request.method)) {
    return json(405, { error: "Metodo nao permitido." });
  }

  const payload = request.method === "POST" ? await parseJsonBody(request) : readQueryPayload(request);
  const scheduled = Boolean(payload.next_run);
  const dispatchToken = getEnv("EMAIL_DISPATCH_TOKEN");
  const requestToken = readToken(request);

  if (!scheduled && (!dispatchToken || requestToken !== dispatchToken)) {
    return json(401, { error: "Token de despacho de e-mail ausente ou invalido." });
  }

  if (scheduled && getEnv("EMAIL_SCHEDULE_ENABLED").toLowerCase() !== "true") {
    return json(200, { scheduled: true, skipped: true, reason: "EMAIL_SCHEDULE_ENABLED desativado." });
  }

  const supabaseUrl = getEnv("VITE_SUPABASE_URL") || getEnv("SUPABASE_URL");
  const serviceRoleKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    return json(500, { error: "Variaveis Supabase ausentes no servidor." });
  }

  if (request.method === "GET" && !payload.action) {
    const preview = await readDueEmails(supabaseUrl, serviceRoleKey, 10);
    return json(200, {
      deliveryEnabled: isDeliveryEnabled(),
      provider: getEmailProvider(),
      queuedPreview: preview.length,
      items: preview.map(toSafePreview)
    });
  }

  const action = payload.action || (scheduled ? "daily" : "process");
  console.log("email-outbox action", {
    action,
    deliveryEnabled: isDeliveryEnabled(),
    scheduled,
    provider: getEmailProvider()
  });

  if (action === "queue-deadlines") {
    const queued = await callSupabaseRpc(supabaseUrl, serviceRoleKey, "queue_lembrete_deadline_emails", {});
    console.log("email-outbox queue-deadlines", { queued: Number(queued || 0) });
    return json(200, { queued: Number(queued || 0) });
  }

  if (action === "daily") {
    const queued = await callSupabaseRpc(supabaseUrl, serviceRoleKey, "queue_lembrete_deadline_emails", {});
    const processed = await processDueEmails(supabaseUrl, serviceRoleKey, Number(payload.limit || 20));
    console.log("email-outbox daily result", { queued: Number(queued || 0), ...processed });
    return json(200, {
      scheduled: true,
      queued: Number(queued || 0),
      ...processed
    });
  }

  if (action !== "process") {
    return json(400, { error: "Acao invalida." });
  }

  const processed = await processDueEmails(supabaseUrl, serviceRoleKey, Number(payload.limit || 20));
  console.log("email-outbox process result", processed);
  return json(200, processed);
}

export const config = {
  schedule: "0 12 * * *"
};

async function processDueEmails(supabaseUrl, serviceRoleKey, requestedLimit) {
  const limit = clamp(requestedLimit, 1, 50);
  const dueEmails = await readDueEmails(supabaseUrl, serviceRoleKey, limit);
  console.log("email-outbox due emails", { limit, count: dueEmails.length });

  if (!isDeliveryEnabled()) {
    return {
      deliveryEnabled: false,
      dryRun: true,
      queued: dueEmails.length,
      items: dueEmails.map(toSafePreview)
    };
  }

  assertDeliveryConfig();

  const results = [];

  for (const email of dueEmails) {
    await updateEmail(supabaseUrl, serviceRoleKey, email.id, {
      status: "processing",
      attempts: Number(email.attempts || 0) + 1,
      last_error: null
    });

    try {
      const sent = await sendEmail(email);
      await updateEmail(supabaseUrl, serviceRoleKey, email.id, {
        status: "sent",
        provider: sent.provider,
        provider_message_id: sent.id,
        sent_at: new Date().toISOString(),
        last_error: null
      });
      console.log("email-outbox sent", { id: email.id, provider: sent.provider, providerMessageId: sent.id });
      results.push({ id: email.id, status: "sent" });
    } catch (error) {
      await updateEmail(supabaseUrl, serviceRoleKey, email.id, {
        status: "failed",
        last_error: getErrorMessage(error)
      });
      console.error("email-outbox failed", { id: email.id, error: getErrorMessage(error) });
      results.push({ id: email.id, status: "failed", error: getErrorMessage(error) });
    }
  }

  return {
    deliveryEnabled: true,
    processed: results.length,
    results
  };
}

async function readDueEmails(supabaseUrl, serviceRoleKey, limit) {
  const now = encodeURIComponent(new Date().toISOString());
  const url =
    `${trimUrl(supabaseUrl)}/rest/v1/email_outbox` +
    `?status=eq.queued&scheduled_for=lte.${now}` +
    `&select=${encodeURIComponent(EMAIL_SELECT)}` +
    `&order=scheduled_for.asc&limit=${limit}`;

  const rows = await supabaseRequest(url, {
    headers: serviceHeaders(serviceRoleKey)
  });

  return Array.isArray(rows) ? rows : [];
}

async function callSupabaseRpc(supabaseUrl, serviceRoleKey, functionName, body) {
  return supabaseRequest(`${trimUrl(supabaseUrl)}/rest/v1/rpc/${functionName}`, {
    method: "POST",
    headers: {
      ...serviceHeaders(serviceRoleKey),
      "content-type": "application/json"
    },
    body: JSON.stringify(body)
  });
}

async function updateEmail(supabaseUrl, serviceRoleKey, id, patch) {
  await supabaseRequest(`${trimUrl(supabaseUrl)}/rest/v1/email_outbox?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: {
      ...serviceHeaders(serviceRoleKey),
      "content-type": "application/json",
      prefer: "return=minimal"
    },
    body: JSON.stringify(patch)
  });
}

async function sendEmail(email) {
  const provider = getEmailProvider();

  if (provider !== "resend") {
    throw new Error(`Provedor de e-mail nao suportado: ${provider}`);
  }

  const forcedRecipient = getEnv("EMAIL_FORCE_TEST_TO");
  const toEmail = forcedRecipient || email.to_email;
  const subject = forcedRecipient ? `[TESTE HUB] ${email.subject}` : email.subject;

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${getEnv("EMAIL_PROVIDER_API_KEY")}`,
      "idempotency-key": email.dedupe_key,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      from: getEnv("EMAIL_FROM"),
      to: [toEmail],
      subject,
      html: email.html_body,
      text: email.text_body || stripHtml(email.html_body),
      reply_to: getEnv("EMAIL_REPLY_TO") || undefined
    })
  });

  const text = await response.text();
  const data = parseJson(text);

  if (!response.ok) {
    throw new Error(data?.message || data?.error || text || "Erro ao enviar e-mail.");
  }

  return { provider, id: data?.id || "" };
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

function serviceHeaders(serviceRoleKey) {
  return {
    apikey: serviceRoleKey,
    authorization: `Bearer ${serviceRoleKey}`
  };
}

function assertDeliveryConfig() {
  if (!getEnv("EMAIL_PROVIDER_API_KEY")) {
    throw new Error("EMAIL_PROVIDER_API_KEY nao configurada.");
  }

  if (!getEnv("EMAIL_FROM")) {
    throw new Error("EMAIL_FROM nao configurado.");
  }
}

function isDeliveryEnabled() {
  return getEnv("EMAIL_DELIVERY_ENABLED").toLowerCase() === "true";
}

function getEmailProvider() {
  return (getEnv("EMAIL_PROVIDER") || "resend").toLowerCase();
}

function toSafePreview(email) {
  return {
    id: email.id,
    category: email.category,
    targetType: email.target_type,
    targetRef: email.target_ref,
    toEmail: maskEmail(email.to_email),
    subject: email.subject,
    scheduledFor: email.scheduled_for
  };
}

function readToken(request) {
  const auth = request.headers.get("authorization") || "";
  const match = auth.match(/^Bearer\s+(.+)$/i);
  const urlToken = new URL(request.url).searchParams.get("token") || "";
  return match?.[1]?.trim() || request.headers.get("x-email-dispatch-token") || urlToken;
}

async function parseJsonBody(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

function readQueryPayload(request) {
  const params = new URL(request.url).searchParams;
  return {
    action: params.get("action") || "",
    limit: params.get("limit") || "",
    next_run: params.get("next_run") || ""
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

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(Math.trunc(value), min), max);
}

function stripHtml(value) {
  return String(value || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function maskEmail(value) {
  const [name, domain] = String(value || "").split("@");
  if (!name || !domain) return "";
  return `${name.slice(0, 2)}***@${domain}`;
}

function getErrorMessage(error) {
  return error?.message || "Erro inesperado.";
}
