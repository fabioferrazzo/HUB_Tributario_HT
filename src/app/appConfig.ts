import { Bell, CalendarDays, FileArchive, Home, Link2, ListChecks, Settings, Timer, UserRoundCog } from "lucide-react";
import type { FileResourceCategory, HubRoute, UserRole } from "../types";
import type { HomologationBlock, HomologationStatus } from "./appTypes";

export const HOMOLOGATION_STORAGE_KEY = "hub_homologation_status_v1";

export const APP_RELEASE_LABEL = "2026-06-19-agenda-make-pomodoro";

export const APP_RELEASE_DATE = "19/06/2026";

export const HUB_SUPABASE_HOST = "kgorlrpparhcrprwamlc.supabase.co";

export const dailyOperationalGuide = [
  {
    title: "Abrir Saude operacional",
    detail: "Conferir a etiqueta de versao, origens Supabase/local, Functions e avisos antes de mexer em dados reais."
  },
  {
    title: "Conferir sino e pendencias",
    detail: "Abrir notificacoes, revisar lembretes vencidos/proximos e pautas criticas do dia."
  },
  {
    title: "Rodar e-mails do dia",
    detail: "No console de Lembretes e e-mails, consultar fila, enfileirar vencimentos e processar pendentes quando necessario."
  },
  {
    title: "Conferir Agenda Tributaria",
    detail: "Abrir Agenda tributaria e confirmar se o mes atual foi carregado do cache compartilhado ou atualizado pela RFB."
  },
  {
    title: "Registrar homologacao",
    detail: "Usar o Checklist funcional para marcar OK/Ajustar/Falhou e copiar o resumo ao final da rodada."
  }
];

export const weeklyOperationalGuide = [
  {
    title: "Revisar usuarios",
    detail: "Confirmar admins, gestores, colaboradores ativos e remover/desativar acessos que nao devem permanecer."
  },
  {
    title: "Revisar biblioteca",
    detail: "Organizar arquivos por pastas, excluir duplicados e deixar documentos importantes com comentario ou grifo."
  },
  {
    title: "Revisar Coordenacao",
    detail: "Atualizar colaboradores, atividades, pautas e usar os botoes manuais de e-mail quando a comunicacao estiver pronta."
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
      { id: "login-admin", title: "Login admin", detail: "Admin entra, ve Configuracoes e Coordenacao." },
      { id: "login-colaborador", title: "Login colaborador", detail: "Colaborador entra e nao ve areas restritas." },
      { id: "logout", title: "Logout", detail: "Saida pelo menu lateral encerra a sessao." }
    ]
  },
  {
    id: "lembretes",
    title: "Lembretes",
    items: [
      { id: "lembrete-crud", title: "Criar/editar/concluir/excluir", detail: "Permissoes corretas para criador, marcado, gestor e admin." },
      { id: "lembrete-confidencial", title: "Confidencialidade", detail: "Sem marcados fica visivel so para criador/admin; com marcados inclui usuarios selecionados." },
      { id: "lembrete-anexo", title: "Anexos", detail: "Arquivo anexado salva e permanece acessivel." }
    ]
  },
  {
    id: "tarefas",
    title: "Tarefas",
    items: [
      { id: "tarefa-sidebar", title: "Sidebar", detail: "Cria tarefa com responsaveis e anexo." },
      { id: "tarefa-calendario", title: "Calendario original", detail: "Criacao no calendario aparece no painel lateral." },
      { id: "tarefa-acoes", title: "Acoes", detail: "Editar, concluir/reabrir e excluir respeitam permissao." }
    ]
  },
  {
    id: "arquivos",
    title: "Arquivos",
    items: [
      { id: "arquivo-biblioteca", title: "Biblioteca", detail: "Pastas, upload, edicao e exclusao controlada." },
      { id: "arquivo-visualizador", title: "Visualizador", detail: "Busca, zoom, grifo, comentarios e exportacao de notas." },
      { id: "arquivo-ocr", title: "OCR manual", detail: "Botao Rodar OCR aciona o agente local quando houver pendentes." }
    ]
  },
  {
    id: "comunicacao",
    title: "E-mails e notificacoes",
    items: [
      { id: "email-fila", title: "Fila email_outbox", detail: "Consultar, enfileirar vencimentos e processar fila." },
      { id: "email-manual", title: "Envio manual", detail: "Disparo pontual pelo console operacional." },
      { id: "notificacoes", title: "Sino", detail: "Contador, marcar lida e visibilidade por usuario." }
    ]
  },
  {
    id: "agenda-tributaria",
    title: "Agenda Tributaria",
    items: [
      { id: "agenda-cache", title: "Cache compartilhado", detail: "Mes abre com dados persistidos em agenda_tributaria_cache quando disponivel." },
      { id: "agenda-rfb", title: "Atualizacao RFB", detail: "Botao de atualizar busca RFB e preserva fallback local se a Function falhar." },
      { id: "agenda-make", title: "Make mensal", detail: "Cenario mensal chama /api/agenda-tributaria com AGENDA_SYNC_TOKEN configurado." }
    ]
  },
  {
    id: "pomodoro",
    title: "Pomodoro",
    items: [
      { id: "pomodoro-open", title: "App Pomodoro", detail: "Menu Pomodoro abre sem erro dentro do HUB." },
      { id: "pomodoro-notes", title: "Anotacoes", detail: "Sidebar de anotacoes abre, edita e salva o conteudo." },
      { id: "pomodoro-floating", title: "Janela flutuante", detail: "Anotacoes ficam flutuantes, opacas e acessiveis ao navegar por outros menus." },
      { id: "pomodoro-return", title: "Retorno ao painel", detail: "Fechar a janela flutuante recolhe para o Pomodoro preservando o texto salvo." }
    ]
  },
  {
    id: "coordenacao",
    title: "Coordenacao Tributaria",
    items: [
      { id: "coord-layout", title: "Layout simplificado", detail: "Busca, colaborador e acoes na mesma linha." },
      { id: "coord-pautas", title: "Pautas e lembretes", detail: "Criar pauta/lembrete com anexos e historico." },
      { id: "coord-email", title: "E-mails da Coordenacao", detail: "Enviar pauta e avaliacoes por comando manual." }
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

export const routes = [
  { id: "home", label: "Pautas", icon: ListChecks },
  { id: "tarefas", label: "Calendario de Tarefas", icon: CalendarDays },
  { id: "lembretes", label: "Lembretes", icon: Bell },
  { id: "arquivos", label: "Arquivos", icon: FileArchive },
  { id: "agenda", label: "Agenda tributaria", icon: ListChecks },
  { id: "pomodoro", label: "Pomodoro", icon: Timer },
  { id: "links", label: "Links uteis", icon: Link2 },
  { id: "coord", label: "Coordenacao", icon: UserRoundCog },
  { id: "admin", label: "Configuracoes", icon: Settings }
] satisfies Array<{ id: HubRoute; label: string; icon: typeof Home }>;

export const routeGroups = [
  { label: "Principal", items: ["home"] },
  { label: "Ferramentas", items: ["tarefas", "arquivos", "agenda", "pomodoro", "links"] },
  { label: "Sistema", items: ["coord", "admin"] }
] satisfies Array<{ label: string; items: HubRoute[] }>;

export const coordStandaloneVersion = "2026-07-01-coord-list-cards";

export const appFrames: Record<"agenda" | "pomodoro" | "coord", { title: string; src: string }> = {
  agenda: { title: "Agenda tributaria", src: "/apps/agenda-tributaria.html" },
  pomodoro: { title: "Pomodoro Timer", src: "/apps/pomodoro.html" },
  coord: { title: "Coordenacao tributaria", src: `/apps/coord-tributaria.html?v=${coordStandaloneVersion}` }
};

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
