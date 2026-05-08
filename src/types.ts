export type UserRole = "admin" | "gestor" | "colaborador";

export type HubUser = {
  id?: string;
  email: string;
  nome: string;
  role: UserRole;
};

export type TeamMember = {
  nome: string;
  email: string;
  iniciais: string;
  role: UserRole;
};

export type HubProfile = TeamMember & {
  id?: string;
  active: boolean;
  createdAt?: string;
  updatedAt?: string;
};

export type Pauta = {
  id: string;
  tema: string;
  acoes: string;
  prazo: string;
  prioridade: string;
  responsavel: string;
  email: string;
  pendenciasObs: string;
  retorno: string;
  status: string;
  periodicidade: string;
  modificadoEm: string;
  concluidoEm: string;
  origem: string;
};

export type Lembrete = {
  id: string;
  titulo: string;
  descricao: string;
  prazo: string;
  prioridade: "alta" | "normal" | "baixa";
  status: "aberto" | "concluido" | "vencido";
  responsaveis: string[];
  anexos: string[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

export type Noticia = {
  id: string;
  titulo: string;
  fonte: string;
  url: string;
  data: string;
};

export type HubRoute =
  | "home"
  | "tarefas"
  | "lembretes"
  | "arquivos"
  | "agenda"
  | "pomodoro"
  | "links"
  | "coord"
  | "admin";
