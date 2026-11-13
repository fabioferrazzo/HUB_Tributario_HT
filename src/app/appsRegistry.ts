// Cadastro único dos apps incorporados ao HUB.
//
// Para acrescentar um app:
//   1. coloque o arquivo HTML em public/apps/ (e inclua <script src="/apps/hub-app-shell.js" defer></script>
//      antes de </body>, para ter o botão de tela cheia também fora do HUB);
//   2. acrescente uma entrada em `hubApps` abaixo.
// O menu lateral, a rota, as permissões e a moldura (tela cheia, nova janela, recarregar) saem daqui.
import type { LucideIcon } from "lucide-react";
import { Award, BookUser, CalendarRange, FileText, ClipboardCheck, FileSpreadsheet, Landmark, ListChecks, Map as MapIcon, NotebookPen, Percent, Timer, Truck, UserPlus, UserRoundCog } from "lucide-react";
import type { HubRoute, UserRole } from "../types";

export type HubAppGroup = "Principal" | "Ferramentas" | "Escritório" | "Simuladores" | "Sistema";

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
  // Checklist no HUB: cada usuário tem os seus (no banco do HUB) e pode compartilhar com colegas.
  // Começa sem histórico; o Checklist pessoal do Fábio segue em uso à parte, fora do HUB.
  {
    id: "checklist",
    label: "Checklist",
    title: "Checklist",
    icon: ClipboardCheck,
    group: "Ferramentas",
    access: "todos",
    src: "/apps/checklist/index.html",
    mode: "embutido",
    description: "Checklists pessoais guardados no HUB (abrem de qualquer computador). Só você vê, a menos que compartilhe com colegas ou com a equipe."
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
  // A versão do HTSERVER segue em uso à parte, fora do HUB.
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
  // Administradores e gestores do HUB são ADM do app. Começa sem histórico (o app do servidor segue em uso à parte).
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
  // Apps do escritório que ainda não estão dentro do HUB: abrem a versão que roda no HTSERVER ou no site de origem.
  // As versões antigas do Controle de Apuração e do Controle de Férias saíram do menu (são usadas à parte).
  // Onboarding: só o ambiente contratual (Contrato, Adendo, matriz, checklist) entra no HUB. Clientes, portal e
  // pacotes continuam no Onboarding do servidor (HTSERVER), aberto por um botão dentro do próprio app.
  {
    id: "onboarding",
    label: "Onboarding",
    title: "Onboarding",
    icon: UserPlus,
    group: "Escritório",
    access: "todos",
    src: "/apps/onboarding/index.html",
    mode: "embutido",
    description: "Ambiente contratual do onboarding: Contrato, Adendo, matriz de responsabilidades e checklist (recriação do Onboarding 1.1.35)."
  },
  // Carteira de Clientes: recriação da Carteira V2 2.1.0 com a base no Supabase (competências, empresas e auditoria).
  {
    id: "carteira",
    label: "Carteira de clientes",
    title: "Carteira de Clientes",
    icon: BookUser,
    group: "Escritório",
    access: "todos",
    // no HUB é o espelho só para consulta; inclusões e alterações são feitas no app individual (/apps/carteira/)
    src: "/apps/carteira/index.html?modo=consulta",
    mode: "embutido",
    description: "Consulta da relação de empresas por competência mensal, sempre atualizada com o app Carteira de Clientes, onde o ADM faz inclusões e alterações."
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
  // Informativos: recriação do Infos HT no HUB (dados no Supabase). O Infos HT do computador do Fábio segue à parte.
  {
    id: "informativos",
    label: "Informativos",
    title: "Informativos",
    icon: FileText,
    group: "Escritório",
    access: "todos",
    src: "/apps/informativos/index.html",
    mode: "embutido",
    description: "Biblioteca de informativos do Departamento Tributário (recriação do Infos HT dentro do HUB)."
  },
  // Simuladores: cada um é um item do submenu "Simuladores" (public/apps/simuladores/<nome>/).
  {
    id: "sim-aplicacoes-financeiras",
    label: "Aplicações financeiras",
    title: "Analista de Aplicações Financeiras",
    icon: Landmark,
    group: "Simuladores",
    access: "todos",
    src: "/apps/simuladores/aplicacoes-financeiras/index.html",
    mode: "embutido",
    description: "Rendimentos, resgates, IR retido e simulação de IRPJ/CSLL e PIS/Cofins sobre aplicações financeiras. Os projetos ficam guardados neste navegador; use backup .htaf para levar a outro computador."
  },
  {
    id: "sim-mapa-icms",
    label: "Mapa de alíquotas ICMS",
    title: "Mapa do ICMS interestadual (saídas do RS)",
    icon: MapIcon,
    group: "Simuladores",
    access: "todos",
    src: "/apps/simuladores/mapa-icms-rs/index.html",
    mode: "embutido"
  },
  {
    id: "sim-ibs-cbs-simples",
    label: "Alíquota IBS/CBS no Simples",
    title: "Calculadora de alíquota de IBS/CBS no Simples Nacional",
    icon: Percent,
    group: "Simuladores",
    access: "todos",
    src: "/apps/simuladores/calculadora-ibs-cbs-simples/index.html",
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
