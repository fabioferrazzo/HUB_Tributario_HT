// Ações manuais da fila de e-mails (Configurações > E-mails): ver a fila, enfileirar vencimentos e processar.
// Sempre exige login de admin/gestor ou o EMAIL_DISPATCH_TOKEN (a execução diária fica em email-outbox).
import { handleEmailOutbox } from "./email-outbox.mjs";

export default async function handler(request) {
  return handleEmailOutbox(request, { scheduledEntry: false });
}
