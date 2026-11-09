// Cadastro único dos apps incorporados ao HUB.
//
// Para acrescentar um app:
//   1. coloque o arquivo HTML em public/apps/ (e inclua <script src="/apps/hub-app-shell.js" defer></script>
//      antes de </body>, para ter o botão de tela cheia também fora do HUB);
//   2. acrescente uma entrada em `hubApps` abaixo.
// O menu lateral, a rota, as permissões e a moldura (tela cheia, nova janela, recarregar) saem daqui.
import type { LucideIcon } from "lucide-react";
import { Award, CalendarRange, FileText, ClipboardCheck, FileSpreadsheet, ListChecks, NotebookPen, Timer, Truck, UserPlus, UserRoundCog } from "lucide-react";
import type { HubRoute, UserRole } from "../types";

export type HubAppGroup = "Principal" | "Ferramentas" | "Escritório" | "Sistema";

// Quem vê o app no menu: todos, gestores e administradores, ou só administradores.
export type HubAppAccess = "todos" | "gestores" | "admin";

// "embutido": abre dentro do HUB (arquivo em public/apps ou site HTTPS que permita moldura).
// "janela": abre só em janela própria (ex.: apps do HTSERVER, que existem apenas na rede do escritório).
export type HubAppMode = "embutido" | "janela";

export type HubApp = {
  id: string;
  label: string;
  title: string;
  icon: LucideIcon;
  group: HubAppGroup;
  access: HubAppAccess;
  src: string;
  mode: HubAppMode;
  description?: string;
  // Rotas antigas mantidas por compatibilidade (notificações apontam para elas).
  route?: HubRoute;
};

const coordStandaloneVersion = "2026-07-01-coord-list-cards";

export const hubApps: HubApp[] = [
  {
    id: "agenda",
    route: "agenda",
    label: "Agenda tributária",
    title: "Agenda tributária",
    icon: ListChecks,
    group: "Ferramentas",
    access: "todos",
    src: "/apps/agenda-tributaria.html",
    mode: "embutido"
  },
  {
    id: "pomodoro",
    route: "pomodoro",
    label: "Pomodoro",
    title: "Pomodoro",
    icon: Timer,
    group: "Ferramentas",
    access: "todos",
    src: "/apps/pomodoro.html",
    mode: "embutido"
  },
  {
    id: "coord",
    route: "coord",
    label: "Coordenação",
    title: "Coordenação tributária",
    icon: UserRoundCog,
    group: "Sistema",
    access: "gestores",
    src: `/apps/coord-tributaria.html?v=${coordStandaloneVersion}`,
    mode: "embutido"
  },
  {
    id: "checklist",
    label: "Checklist",
    title: "Checklist",
    icon: ClipboardCheck,
    group: "Ferramentas",
    access: "todos",
    src: "/apps/checklist.html",
    mode: "embutido",
    description: "Checklist pessoal; os dados ficam guardados neste navegador (use o backup do próprio app para levar de um computador a outro)."
  },
  {
    id: "consultor-cte",
    label: "Consultor CT-e/MDF-e",
    title: "Consultor CT-e / MDF-e",
    icon: Truck,
    group: "Ferramentas",
    access: "todos",
    src: "/apps/consultor-cte-mdfe.html",
    mode: "embutido"
  },
  // Controle de Apuração reconstruído no HUB: mesma tela do app do servidor, dados no Supabase.
  // Fica em paralelo com a versão do HTSERVER até a validação e a migração da base.
  {
    id: "apuracao",
    label: "Controle de Apuração",
    title: "Controle de Apuração",
    icon: FileSpreadsheet,
    group: "Escritório",
    access: "todos",
    src: "/apps/apuracao/index.html",
    mode: "embutido",
    description: "Versão no HUB (em construção): usa o login do HUB e funciona de qualquer lugar."
  },
  // Controle de Férias no HUB: mesma tela e mesmas regras do app do servidor, com os usuários do HUB.
  // Administradores e gestores do HUB são ADM do app. Começa sem histórico (o do servidor fica para consulta).
  {
    id: "ferias",
    label: "Controle de Férias",
    title: "Controle de Férias",
    icon: CalendarRange,
    group: "Escritório",
    access: "todos",
    src: "/apps/ferias/index.html",
    mode: "embutido",
    description: "Férias e ausências da equipe, com saldo por semestre. Usa o login do HUB e funciona de qualquer lugar."
  },
  // Apps do escritório: por enquanto abrem a versão que roda no HTSERVER ou no site de origem.
  // A base de dados será unificada no fim do projeto.
  {
    id: "controle-apuracao",
    label: "Controle de Apuração (servidor)",
    title: "Controle de Apuração (servidor)",
    icon: FileSpreadsheet,
    group: "Escritório",
    access: "todos",
    src: "http://192.168.0.200:8790/",
    mode: "janela",
    description: "Abre em janela própria. Funciona nos computadores da rede do escritório; os dados continuam no servidor do escritório (HTSERVER)."
  },
  {
    id: "controle-ferias",
    label: "Controle de Férias (servidor)",
    title: "Controle de Férias (servidor)",
    icon: CalendarRange,
    group: "Escritório",
    access: "todos",
    src: "http://192.168.0.200:8805/",
    mode: "janela",
    description: "Versão antiga, para consulta. Abre em janela própria e funciona só nos computadores da rede do escritório (HTSERVER). Os novos lançamentos vão no Controle de Férias do HUB."
  },
  {
    id: "onboarding",
    label: "Onboarding",
    title: "Onboarding",
    icon: UserPlus,
    group: "Escritório",
    access: "todos",
    src: "http://192.168.0.200:8767/",
    mode: "janela",
    description: "Abre em janela própria. Funciona nos computadores da rede do escritório; os dados continuam no servidor do escritório (HTSERVER)."
  },
  {
    id: "pautas-app",
    label: "Pautas (app)",
    title: "Pautas (app)",
    icon: NotebookPen,
    group: "Escritório",
    access: "todos",
    src: "https://pautas-hteixeira.netlify.app/",
    mode: "janela",
    description: "Abre em janela própria (o site não permite ser exibido dentro de outro). Funciona de qualquer lugar, com o login do próprio app."
  },
  {
    id: "informativos",
    label: "Informativos",
    title: "Informativos",
    icon: FileText,
    group: "Escritório",
    access: "todos",
    src: "http://127.0.0.1:8766/",
    mode: "janela",
    description: "Programa instalado neste computador. Abra antes o atalho \"Infos HT\" da área de trabalho; depois use o botão abaixo."
  }
];

export function getAppRoute(app: HubApp): HubRoute {
  return app.route || (`app:${app.id}` as HubRoute);
}

export function findAppByRoute(route: HubRoute): HubApp | undefined {
  return hubApps.find((app) => getAppRoute(app) === route);
}

export function canUserSeeApp(app: HubApp, role: UserRole): boolean {
  if (app.access === "admin") return role === "admin";
  if (app.access === "gestores") return role === "admin" || role === "gestor";
  return true;
}
