// Menu Avaliações — avaliação por desempenho no formato da planilha do Depto Tributário.
// Colaboradores (todos os usuários, exceto administradores) preenchem a autoavaliação do mês;
// a coordenação (administradores) corrige, finaliza, reabre e responde réplicas pelo painel.
import type { HubUser } from "../types";
import { isCoordenacao } from "../lib/avaliacoes";
import { AreaColaborador } from "./avaliacoes/AreaColaborador";
import { AreaCoordenacao } from "./avaliacoes/AreaCoordenacao";
import "./avaliacoes/avaliacoes.css";

export function AvaliacoesModule({ user }: { user: HubUser }) {
  return isCoordenacao(user) ? <AreaCoordenacao user={user} /> : <AreaColaborador user={user} />;
}
