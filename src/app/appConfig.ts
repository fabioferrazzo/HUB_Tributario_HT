import { Bell, CalendarDays, FileArchive, Home, Link2, ListChecks, Settings, Timer, UserRoundCog } from "lucide-react";
import type { FileResourceCategory, HubRoute, UserRole } from "../types";
import { getAppRoute, hubApps, type HubAppGroup } from "./appsRegistry";
import type { HomologationBlock, HomologationStatus } from "./appTypes";

export const HOMOLOGATION_STORAGE_KEY = "hub_homologation_status_v1";

export const APP_RELEASE_LABEL = "2026-06-19-agenda-make-pomodoro";

export const APP_RELEASE_DATE = "19/06/2026";

export const HUB_SUPABASE_HOST = "kgorlrpparhcrprwamlc.supabase.co";

export const dailyOperationalGuide = [
  {
    title: "Abrir Saúde operacional",
    detail: "Conferir a etiqueta de versão, origens Supabase/local, Functions e avisos antes de mexer em dados reais."
  },
  {
    title: "Conferir sino e pendências",
    detail: "Abrir notificações, revisar lembretes vencidos/próximos e pautas críticas do dia."
  },
  {
    title: "Rodar e-mails do dia",
    detail: "No console de Lembretes e e-mails, consultar fila, enfileirar vencimentos e processar pendentes quando necessário."
  },
  {
    title: "Conferir Agenda Tributária",
    detail: "Abrir Agenda tributária e confirmar se o mês atual foi carregado do cache compartilhado ou atualizado pela RFB."
  },
  {
    title: "Registrar homologação",
    detail: "Usar o Checklist funcional para marcar OK/Ajustar/Falhou e copiar o resumo ao final da rodada."
  }
];

export const weeklyOperationalGuide = [
  {
    title: "Revisar usuários",
    detail: "Confirmar admins, gestores, colaboradores ativos e remover/desativar acessos que não devem permanecer."
  },
  {
    title: "Revisar biblioteca",
    detail: "Organizar arquivos por pastas, excluir duplicados e deixar documentos importantes com comentario ou grifo."
  },
  {
    title: "Revisar Coordenação",
    detail: "Atualizar colaboradores, atividades, pautas e usar os botões manuais de e-mail quando a comunicação estiver pronta."
  },
  {
    title: "Conferir Make da Agenda",
    detail: "Verificar se o cenario mensal esta ativo e chamando /api/agenda-tributaria com o AGENDA_SYNC_TOKEN."
  },
  {
    title: "Preflight antes de deploy",
    detail: "Rodar npm.cmd run preflight e npm.cmd run build localmente antes de liberar builds do Netlify."
  }
];

export const homologationStatusLabels: Record<HomologationStatus, string> = {
  pendente: "Pendente",
  ok: "OK",
  ajustar: "Ajustar",
  falhou: "Falhou"
};

export const homologationBlocks: HomologationBlock[] = [
  {
    id: "acesso",
    title: "Login e perfis",
    items: [
      { id: "login-admin", title: "Login admin", detail: "Admin entra, vê Configurações e Coordenação." },
      { id: "login-colaborador", title: "Login colaborador", detail: "Colaborador entra e não vê áreas restritas." },
      { id: "logout", title: "Logout", detail: "Saída pelo menu lateral encerra a sessão." }
    ]
  },
  {
    id: "lembretes",
    title: "Lembretes",
    items: [
      { id: "lembrete-crud", title: "Criar/editar/concluir/excluir", detail: "Permissões corretas para criador, marcado, gestor e admin." },
      { id: "lembrete-confidencial", title: "Confidencialidade", detail: "Sem marcados fica visível só para criador/admin; com marcados inclui usuários selecionados." },
      { id: "lembrete-anexo", title: "Anexos", detail: "Arquivo anexado salva e permanece acessivel." }
    ]
  },
  {
    id: "tarefas",
    title: "Tarefas",
    items: [
      { id: "tarefa-sidebar", title: "Sidebar", detail: "Cria tarefa com responsáveis e anexo." },
      { id: "tarefa-calendario", title: "Calendário original", detail: "Criação no calendário aparece no painel lateral." },
      { id: "tarefa-acoes", title: "Ações", detail: "Editar, concluir/reabrir e excluir respeitam permissão." }
    ]
  },
  {
    id: "arquivos",
    title: "Arquivos",
    items: [
      { id: "arquivo-biblioteca", title: "Biblioteca", detail: "Pastas, upload, edição e exclusão controlada." },
      { id: "arquivo-visualizador", title: "Visualizador", detail: "Busca, zoom, grifo, comentários e exportação de notas." },
      { id: "arquivo-ocr", title: "OCR manual", detail: "Botão Rodar OCR aciona o agente local quando houver pendentes." }
    ]
  },
  {
    id: "comunicacao",
    title: "E-mails e notificações",
    items: [
      { id: "email-fila", title: "Fila email_outbox", detail: "Consultar, enfileirar vencimentos e processar fila." },
      { id: "email-manual", title: "Envio manual", detail: "Disparo pontual pelo console operacional." },
      { id: "notificacoes", title: "Sino", detail: "Contador, marcar lida e visibilidade por usuário." }
    ]
  },
  {
    id: "agenda-tributaria",
    title: "Agenda Tributária",
    items: [
      { id: "agenda-cache", title: "Cache compartilhado", detail: "Mês abre com dados persistidos em agenda_tributaria_cache quando disponível." },
      { id: "agenda-rfb", title: "Atualização RFB", detail: "Botão de atualizar busca RFB e preserva fallback local se a Function falhar." },
      { id: "agenda-make", title: "Make mensal", detail: "Cenario mensal chama /api/agenda-tributaria com AGENDA_SYNC_TOKEN configurado." }
    ]
  },
  {
    id: "pomodoro",
    title: "Pomodoro",
    items: [
      { id: "pomodoro-open", title: "App Pomodoro", detail: "Menu Pomodoro abre sem erro dentro do HUB." },
      { id: "pomodoro-notes", title: "Anotações", detail: "Sidebar de anotações abre, edita e salva o conteúdo." },
      { id: "pomodoro-floating", title: "Janela flutuante", detail: "Anotações ficam flutuantes, opacas e acessíveis ao navegar por outros menus." },
      { id: "pomodoro-return", title: "Retorno ao painel", detail: "Fechar a janela flutuante recolhe para o Pomodoro preservando o texto salvo." }
    ]
  },
  {
    id: "coordenacao",
    title: "Coordenação Tributária",
    items: [
      { id: "coord-layout", title: "Layout simplificado", detail: "Busca, colaborador e ações na mesma linha." },
      { id: "coord-pautas", title: "Pautas e lembretes", detail: "Criar pauta/lembrete com anexos e histórico." },
      { id: "coord-email", title: "E-mails da Coordenação", detail: "Enviar pauta e avaliações por comando manual." }
    ]
  },
  {
    id: "publicacao",
    title: "Pre-deploy",
    items: [
      { id: "supabase-check", title: "Supabase check", detail: "check_hub_status.sql retorna todos os itens como OK." },
      { id: "preflight", title: "Preflight local", detail: "npm.cmd run preflight aprovado antes do deploy de marco." },
      { id: "netlify-controlado", title: "Deploy controlado", detail: "Builds Netlify liberados somente para marco final." }
    ]
  }
];

// Telas próprias do HUB. Os apps incorporados (Agenda, Pomodoro, Coordenação e os próximos)
// vêm do cadastro único em ./appsRegistry.ts.
const nativeRoutes: Array<{ id: HubRoute; label: string; icon: typeof Home }> = [
  { id: "home", label: "Pautas", icon: ListChecks },
  { id: "tarefas", label: "Calendário de Tarefas", icon: CalendarDays },
  { id: "lembretes", label: "Lembretes", icon: Bell },
  { id: "arquivos", label: "Arquivos", icon: FileArchive },
  { id: "links", label: "Links úteis", icon: Link2 },
  { id: "admin", label: "Configurações", icon: Settings }
];

export const routes: Array<{ id: HubRoute; label: string; icon: typeof Home }> = [
  ...nativeRoutes,
  ...hubApps.map((app) => ({ id: getAppRoute(app), label: app.label, icon: app.icon }))
];

const appRoutesOf = (group: HubAppGroup) => hubApps.filter((app) => app.group === group).map(getAppRoute);

export const routeGroups: Array<{ label: string; items: HubRoute[] }> = [
  { label: "Principal", items: ["home", ...appRoutesOf("Principal")] },
  { label: "Ferramentas", items: ["tarefas", "arquivos", ...appRoutesOf("Ferramentas"), "links"] },
  { label: "Sistema", items: [...appRoutesOf("Sistema"), "admin"] }
];

// OCR (conversao em PDF pesquisavel) adiado para outra versao: arquivos digitalizados ficam
// guardados como enviados, para visualizar e baixar. Para reativar, troque para true.
export const OCR_ENABLED = false;

export const POMODORO_STORAGE_KEY = "pomo_complete_data_v7";

export const POMODORO_ARCHIVE_STORAGE_KEY = "hub_pomodoro_notes_archive";

export const roleOptions: Array<{ value: UserRole; label: string }> = [
  { value: "admin", label: "Administrador" },
  { value: "gestor", label: "Gestor" },
  { value: "colaborador", label: "Colaborador" }
];

export const fileCategoryOptions: Array<{ value: FileResourceCategory | "todos"; label: string }> = [
  { value: "todos", label: "Todos" },
  { value: "drive", label: "Google Drive" },
  { value: "modelo", label: "Modelos" },
  { value: "guia", label: "Guias" },
  { value: "anexo", label: "Anexos" },
  { value: "outro", label: "Outros" }
];
