import {
  Bell,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Edit3,
  FileArchive,
  Filter,
  Home,
  Link2,
  ListChecks,
  LogOut,
  Menu,
  Newspaper,
  Paperclip,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  Tag,
  Timer,
  Trash2,
  UserRoundCog,
  UserRound,
  X
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { loadPautas, mockLegislacoes, mockNoticias, sheetsHubUrl, teamMembers } from "./data/hubData";
import { getStoredSession, signIn, signOut } from "./lib/auth";
import {
  deleteAppLembrete,
  getLembretesSource,
  listAppLembretes,
  saveAppLembrete,
  saveAppLembretesCollection
} from "./lib/lembretesRepository";
import { readStorage, writeStorage } from "./lib/storage";
import { getUsersSource, listAppUsers, saveAppUserWithOptions, setAppUserActive } from "./lib/usersRepository";
import type { HubProfile, HubRoute, HubUser, Lembrete, Noticia, Pauta, UserRole } from "./types";

type TaskItem = {
  id: string;
  titulo: string;
  prazo: string;
  status: "aberta" | "concluida";
  anexos: string[];
};

type UsefulLink = {
  id: string;
  titulo: string;
  url: string;
  scope: "privado" | "global";
};

type NotificationItem = {
  id: string;
  title: string;
  detail: string;
  meta: string;
  tone: "danger" | "warning";
  route: HubRoute;
};

const routes = [
  { id: "home", label: "Inicio", icon: Home },
  { id: "tarefas", label: "Tarefas", icon: CalendarDays },
  { id: "lembretes", label: "Lembretes", icon: Bell },
  { id: "arquivos", label: "Arquivos", icon: FileArchive },
  { id: "agenda", label: "Agenda tributaria", icon: ListChecks },
  { id: "pomodoro", label: "Pomodoro", icon: Timer },
  { id: "links", label: "Links uteis", icon: Link2 },
  { id: "coord", label: "Coordenacao", icon: UserRoundCog },
  { id: "admin", label: "Configuracoes", icon: Settings }
] satisfies Array<{ id: HubRoute; label: string; icon: typeof Home }>;

const routeGroups = [
  { label: "Principal", items: ["home"] },
  { label: "Ferramentas", items: ["tarefas", "arquivos", "agenda", "pomodoro", "links"] },
  { label: "Sistema", items: ["coord", "admin"] }
] satisfies Array<{ label: string; items: HubRoute[] }>;

const appFrames: Record<"agenda" | "pomodoro" | "coord", { title: string; src: string }> = {
  agenda: { title: "Agenda tributaria", src: "/apps/agenda-tributaria.html" },
  pomodoro: { title: "Pomodoro Timer", src: "/apps/pomodoro.html" },
  coord: { title: "Coordenacao tributaria", src: "/apps/coord-tributaria.html" }
};

const roleOptions: Array<{ value: UserRole; label: string }> = [
  { value: "admin", label: "Administrador" },
  { value: "gestor", label: "Gestor" },
  { value: "colaborador", label: "Colaborador" }
];

export function App() {
  const [user, setUser] = useState<HubUser | null>(() => getStoredSession());
  const [route, setRoute] = useState<HubRoute>("home");
  const [menuOpen, setMenuOpen] = useState(false);
