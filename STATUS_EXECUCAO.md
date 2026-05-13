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
- Login real Supabase validado em producao.
- Criacao real de usuario Supabase Auth pelo Admin validada em producao.
- Controle de menu por perfil validado: colaborador nao visualiza Configuracoes nem Coordenacao Tributaria.
- Botao Novo em Lembretes no painel inicial ajustado para abrir o modulo de cadastro.
- Botao Nova em Pautas restringido a administradores e direcionado para a planilha HUB.
- Botao Sair duplicado do cabecalho removido; permanece apenas no menu lateral.
- Policy de insert em `profiles` adicionada ao schema Supabase para uso por administradores.
- Patch SQL criado para usuarios ativos poderem listar usuarios ativos e marcar responsaveis em Lembretes.
- Patch SQL criado para corrigir RLS de leitura/gravar Lembretes, usuarios marcados e anexos.
- Patch SQL criado para definir automaticamente o criador real dos Lembretes via auth.uid().
- Repositorio Supabase de Lembretes ajustado para usar o usuario real da sessao Supabase ao salvar.
- Criacao de Lembretes migrada para RPC `create_lembrete` com security definer.
- Acoes de Lembretes ajustadas por permissao: criador, gestor e admin podem editar/concluir/excluir; usuario apenas marcado fica em modo visualizacao.
- Fluxo de concluir/reabrir ajustado para persistir somente o lembrete alterado, evitando atualizacoes em lote que poderiam conflitar com RLS.
- Upload de anexos ajustado para gerar caminho tecnico seguro no Supabase Storage, preservando o nome original do arquivo na exibicao.
- Quadro de Pautas ajustado com filtros funcionais por todas, minhas, alta, atrasadas e sem prazo.
- Visibilidade de Pautas ajustada por perfil: admin/gestor veem tudo; colaborador ve pautas gerais ou atribuidas ao proprio usuario.
- Lista de Pautas ordenada por urgencia, prioridade e prazo.
- Lembretes ajustados com campo confidencial para administradores.
- Regras de Lembretes ajustadas: admin gerencia todos; usuario padrao gerencia apenas lembretes criados por ele; lembretes nao confidenciais ficam visiveis para todos.
- Patch SQL `supabase/patch_lembretes_confidencial.sql` criado para coluna, RPC e policies RLS.
- Visibilidade de Lembretes sem usuarios marcados ajustada: apenas criador e admin visualizam, mesmo quando nao confidencial.
- Modulo Arquivos convertido de placeholder para area operacional com cadastro de links/documentos, categorias, busca, escopo global/pessoal e exclusao controlada.
- Modulo Arquivos ampliado com edicao de registros, upload por arrastar e soltar, bucket `hub-arquivos` e pastas para organizar biblioteca.
- Patch SQL `supabase/patch_arquivos_biblioteca.sql` criado para tabelas `arquivo_pastas`, `arquivo_recursos`, policies RLS e Storage.
- Modulo Links uteis migrado para repositorio Supabase/local com busca, escopo global/pessoal, edicao e exclusao controlada.
- Patch SQL `supabase/patch_links_uteis.sql` criado para garantir tabela, trigger e policies RLS de Links uteis.
- Rodapes de Noticias Tributarias e Legislacoes Reforma Tributaria migrados para leitura dinamica no Supabase.
- Sidebar dos rodapes implementada com lista dos ultimos 7 dias contendo data, titulo, fonte e URL.
- Funcao Netlify agendada `refresh-updates` criada para buscar fontes diariamente e limpar itens antigos.
- Patch SQL `supabase/patch_updates_automaticos.sql` criado para classificar noticias/legislacoes e fontes oficiais/especializadas.
- Rodapes automaticos ajustados para ignorar URLs genericas/home, exibir noticias com URL especifica e manter legislacoes oficiais relevantes quando nao houver novidade na semana.
- Rodape de Noticias desacelerado e com pausa ao passar o mouse.
- Rodape de Legislacoes ajustado para aceitar apenas normas oficiais especificas, normalizar titulos por nome/data da norma e remover materias gravadas indevidamente como legislacao.
- Patch SQL `supabase/patch_updates_legislacao_cleanup.sql` criado para limpar legislacoes antigas/incorretas e semear normas oficiais recentes.
- Noticias refinadas para exibir somente itens com cunho tributario e limitar o rodape/sidebar as 3 noticias tributarias mais relevantes.
- Legislacoes ajustadas para completar a lista com normas oficiais anteriores quando nao houver publicacao no dia.
- Velocidade do ticker ajustada dinamicamente pelo tamanho do conteudo, evitando que Legislacoes fique lenta quando houver poucos itens.
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

- Executar `supabase/patch_profiles_read_active.sql` no SQL Editor.
- Executar `supabase/patch_lembretes_rls.sql` no SQL Editor.
- Executar `supabase/patch_lembretes_insert_owner.sql` no SQL Editor.
- Executar `supabase/patch_create_lembrete_rpc.sql` no SQL Editor.
- Testar fluxo Supabase real: editar lembrete, concluir/reabrir, anexar arquivo e excluir.
- Testar quadro de Pautas por perfil: admin/gestor com visao completa e colaborador com visao restrita.
- Executar `supabase/patch_lembretes_confidencial.sql` no SQL Editor.
- Testar Lembretes por perfil: admin gerencia todos; colaborador apenas visualiza lembretes de terceiros; lembrete sem marcados aparece somente para criador/admin; confidencial aparece somente para criador/admin/marcados.
- Executar `supabase/patch_arquivos_biblioteca.sql` no SQL Editor.
- Testar modulo Arquivos: criar pasta global/admin, pasta pessoal/usuario, editar link, arrastar arquivo, abrir upload e excluir somente registros permitidos.
- Executar `supabase/patch_links_uteis.sql` no SQL Editor.
- Testar modulo Links uteis: admin/gestor com links globais; colaborador com links pessoais e visualizacao de globais.
- Executar `supabase/patch_updates_automaticos.sql` no SQL Editor.
- Subir funcao `netlify/functions/refresh-updates.mjs` e testar rodapes apos deploy.
- Criar notificacoes persistentes no banco para eventos alem dos lembretes calculados em tela.
- Preparar envio de e-mail um dia antes do vencimento.
- Criar repositorio GitHub e conectar ao Netlify usando `GUIA_GITHUB_NETLIFY.md`.
- Testar criacao real de usuario Auth no ambiente Supabase/Netlify.
- Implementar reset de senha ou convite por e-mail para usuarios reais.

## Validacoes da rodada

- `npm.cmd run typecheck`: OK em 12/05/2026 apos biblioteca de Arquivos com upload/pastas.
- `npm.cmd run build`: OK em 12/05/2026 apos biblioteca de Arquivos com upload/pastas.
- `npm.cmd run typecheck`: OK em 12/05/2026 apos Links uteis Supabase/local.
- `npm.cmd run build`: OK em 12/05/2026 apos Links uteis Supabase/local.
- `npm.cmd run typecheck`: OK em 12/05/2026 apos rodapes automaticos.
- `node --check netlify/functions/refresh-updates.mjs`: OK em 12/05/2026.
- `npm.cmd run build`: OK em 12/05/2026 apos rodapes automaticos.
- `npm.cmd run typecheck`: OK em 13/05/2026 apos filtro de URLs especificas nos rodapes.
- `node --check netlify/functions/refresh-updates.mjs`: OK em 13/05/2026.
- `npm.cmd run build`: OK em 13/05/2026 apos filtro de URLs especificas e fallback oficial de legislacoes.
- `npm.cmd run typecheck`: OK em 13/05/2026 apos refinamento de Noticias/Legislacoes.
- `node --check netlify/functions/refresh-updates.mjs`: OK em 13/05/2026 apos refinamento de Legislacoes.
- `npm.cmd run typecheck`: OK em 13/05/2026 apos filtro estrito de Noticias tributarias e fallback ampliado de Legislacoes.
- `node --check netlify/functions/refresh-updates.mjs`: OK em 13/05/2026 apos filtro estrito de Noticias tributarias.
- `npm.cmd run build`: OK em 13/05/2026 apos filtro estrito de Noticias tributarias e ticker dinamico.
- `npm.cmd audit --omit=dev`: 0 vulnerabilidades.
- App local `http://127.0.0.1:5173`: HTTP 200.
