import { APP_RELEASE_DATE, APP_RELEASE_LABEL, HOMOLOGATION_STORAGE_KEY, HUB_SUPABASE_HOST, homologationStatusLabels } from "../app/appConfig";
import type { CoordSyncHealth, HealthCheck, HomologationStatus } from "../app/appTypes";
import type { HubProfile, HubUser } from "../types";
import { configuredSupabaseHost } from "./supabase";
import { getArquivosSource } from "./arquivosRepository";
import { getLembretesSource } from "./lembretesRepository";
import { getLinksSource } from "./linksRepository";
import { getTarefasSource } from "./tarefasRepository";
import { getUsersSource } from "./usersRepository";

export function buildOperationalHealthChecks(user: HubUser, users: HubProfile[], coordHealth: CoordSyncHealth): HealthCheck[] {
  const usersSource = getUsersSource();
  const lembretesSource = getLembretesSource(user);
  const arquivosSource = getArquivosSource();
  const linksSource = getLinksSource();
  const tarefasSource = getTarefasSource(user);
  const hasAdmin = users.some((profile) => profile.active && profile.role === "admin");
  const hasCurrentUser = users.some((profile) => profile.active && profile.email.toLowerCase() === user.email.toLowerCase());
  const supabaseReady = [usersSource, lembretesSource, arquivosSource, linksSource].every((source) => source === "supabase");

  return [
    {
      area: "Versao do HUB",
      status: APP_RELEASE_LABEL,
      detail: `Pacote preparado em ${APP_RELEASE_DATE}; use esta etiqueta para confirmar se o navegador/Netlify carregou a versao correta.`,
      tone: "info"
    },
    {
      area: "Projeto Supabase",
      status: configuredSupabaseHost,
      detail:
        configuredSupabaseHost === HUB_SUPABASE_HOST
          ? "Conectado ao projeto correto do HUB Depto Tributario."
          : `Revise o Netlify: este HUB deve usar ${HUB_SUPABASE_HOST}, nao o projeto futuro do app substituto do Sheets.`,
      tone: configuredSupabaseHost === HUB_SUPABASE_HOST ? "ok" : "warning"
    },
    {
      area: "Usuarios e perfis",
      status: usersSource === "supabase" ? "Supabase ativo" : "Modo local",
      detail: hasAdmin && hasCurrentUser ? "Admin ativo e usuario logado presente na lista." : "Revise se ha admin ativo e se o usuario logado esta em profiles.",
      tone: usersSource === "supabase" && hasAdmin && hasCurrentUser ? "ok" : "warning"
    },
    {
      area: "Lembretes",
      status: lembretesSource === "supabase" ? "Persistencia real" : "Fallback local",
      detail: "Criacao, visibilidade, anexos, confidencialidade e e-mails usam esta origem.",
      tone: lembretesSource === "supabase" ? "ok" : "warning"
    },
    {
      area: "Arquivos",
      status: arquivosSource === "supabase" ? "Biblioteca multiusuario" : "Fallback local",
      detail: "Pastas, uploads e anotacoes do visualizador devem usar Supabase no ambiente publicado.",
      tone: arquivosSource === "supabase" ? "ok" : "warning"
    },
    {
      area: "Links uteis",
      status: linksSource === "supabase" ? "Links sincronizados" : "Fallback local",
      detail: "Links globais e pessoais respeitam permissoes de admin, gestor e colaborador.",
      tone: linksSource === "supabase" ? "ok" : "warning"
    },
    {
      area: "Tarefas",
      status: tarefasSource,
      detail:
        tarefasSource === "supabase"
          ? "Persistencia multiusuario ativa; calendario original sincroniza com Supabase."
          : tarefasSource === "calendario"
            ? "Calendario local ativo; Supabase preparado para ativacao por VITE_TAREFAS_SUPABASE=true."
            : "Fallback local ativo porque o calendario do navegador nao esta disponivel.",
      tone: tarefasSource === "supabase" ? "ok" : "info"
    },
    {
      area: "Coordenacao Tributaria",
      status: coordHealth.status,
      detail: coordHealth.detail,
      tone: coordHealth.tone
    },
    {
      area: "E-mails",
      status: "Fila ativa",
      detail: "Lembretes, vencimentos, reset de senha e Coordenacao usam email_outbox; envio real segue em modo teste ate validar dominio proprio.",
      tone: supabaseReady ? "ok" : "info"
    },
    {
      area: "Rodapes",
      status: "Automacao ativa",
      detail: "Noticias tributarias e legislacoes oficiais sao atualizadas pela funcao refresh-updates e exibidas nos rodapes/sidebars.",
      tone: "info"
    },
    {
      area: "Agenda Tributaria",
      status: "Make/RFB preparado",
      detail: "Agenda usa o endpoint /api/agenda-tributaria e o cache agenda_tributaria_cache; configure AGENDA_SYNC_TOKEN no Netlify e no Make.",
      tone: "info"
    },
    {
      area: "Netlify",
      status: "Builds pausados",
      detail: "Manter builds parados durante desenvolvimento e liberar apenas para deploy de marco.",
      tone: "info"
    }
  ];
}

export function readHomologationStatuses() {
  try {
    const raw = localStorage.getItem(HOMOLOGATION_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, HomologationStatus>;
    const validStatuses = new Set(Object.keys(homologationStatusLabels));
    return Object.fromEntries(Object.entries(parsed).filter(([, status]) => validStatuses.has(status)));
  } catch {
    return {};
  }
}
