# Status de Execucao - HUB Depto. Tributario

## Concluido

- Projeto React/Vite/PWA criado.
- Apps HTML copiados para `public/apps`.
- Layout base ajustado ao mockup aprovado.
- Menu lateral retratil implementado.
- CSV da aba HUB integrado como fonte local de Pautas.
- Rodape dividido entre noticias tributarias e legislacoes da Reforma Tributaria.
- Logo do escritorio incorporado ao cabecalho.
- Modulo Lembretes com persistencia local implementado.
- Schema Supabase com RLS, tabelas e bucket de anexos preparado.
- Cliente Supabase e auth com fallback local preparados.
- Repositorio unificado de Lembretes ligado ao app, com modo local e modo Supabase.
- Upload de anexos dos Lembretes preparado para o bucket `hub-anexos` quando Supabase estiver configurado.
- Painel de notificacoes no sino do cabecalho implementado para lembretes vencidos ou proximos do vencimento.
- Modulo administrativo de usuarios/perfis implementado.
- Login local de homologacao integrado aos usuarios ativos cadastrados no Admin.
- Policy de insert em `profiles` adicionada ao schema Supabase para uso por administradores.
- Funcao server-side `admin-users` criada para o Admin criar usuarios no Supabase Auth com `service_role_key` protegida.
- Pacote-fonte limpo para GitHub/Netlify preparado.
- Guia GitHub -> Netlify criado para deploy completo.

## Usuarios e perfis - Entrega atual

- Listar usuarios ativos e inativos.
- Criar usuario no modo local.
- Editar nome, e-mail, perfil e status.
- Desativar e reativar usuarios.
- Impedir que o usuario logado desative o proprio acesso.
- Atualizar a lista de usuarios marcaveis nos Lembretes.
- Preparar leitura/gravacao na tabela `profiles` quando Supabase estiver configurado.
- Criar usuario real no Supabase Auth pelo Admin quando o app estiver rodando com Netlify Functions.

## Lembretes - Entrega atual

- Criar lembrete.
- Editar lembrete.
- Excluir lembrete.
- Concluir e reabrir lembrete.
- Definir titulo, descricao, prazo e prioridade.
- Marcar usuarios da equipe.
- Registrar nomes de anexos selecionados no modo local.
- Enviar arquivos para Storage no modo Supabase.
- Persistir no `localStorage` quando Supabase nao estiver configurado.
- Persistir em `lembretes`, `lembrete_usuarios` e `lembrete_anexos` quando Supabase estiver configurado.
- Atualizar painel inicial com os lembretes reais da origem ativa.
- Atualizar badge de notificacoes para lembretes vencidos ou proximos do vencimento.
- Abrir painel de notificacoes pelo sino e navegar para o modulo Lembretes.

## Em andamento / proxima etapa

- Criar projeto Supabase e preencher variaveis.
- Executar `supabase/schema.sql`.
- Criar usuarios no Auth e linhas correspondentes em `profiles`.
- Testar fluxo Supabase real: login, criar lembrete, marcar usuarios, anexar arquivo e excluir.
- Criar notificacoes persistentes no banco para eventos alem dos lembretes calculados em tela.
- Preparar envio de e-mail um dia antes do vencimento.
- Criar repositorio GitHub e conectar ao Netlify usando `GUIA_GITHUB_NETLIFY.md`.
- Testar criacao real de usuario Auth no ambiente Supabase/Netlify.
- Implementar reset de senha ou convite por e-mail para usuarios reais.

## Validacoes da rodada

- `npm.cmd run build`: OK em 07/05/2026 apos funcao server-side de usuarios.
- `npm.cmd audit --omit=dev`: 0 vulnerabilidades.
- App local `http://127.0.0.1:5173`: HTTP 200.
