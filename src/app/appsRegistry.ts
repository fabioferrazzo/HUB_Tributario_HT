// Cadastro único dos apps incorporados ao HUB.
//
// Para acrescentar um app:
//   1. coloque o arquivo HTML em public/apps/ (e inclua <script src="/apps/hub-app-shell.js" defer></script>
//      antes de </body>, para ter o botão de tela cheia também fora do HUB);
//   2. acrescente uma entrada em `hubApps` abaixo.
// O menu lateral, a rota, as permissões e a moldura (tela cheia, nova janela, recarregar) saem daqui.
import type { LucideIcon } from "lucide-react";
import { ListChecks, Timer, UserRoundCog } from "lucide-react";
import type { HubRoute, UserRole } from "../types";

export type HubAppGroup = "Principal" | "Ferramentas" | "Sistema";

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
