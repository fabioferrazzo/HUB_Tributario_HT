# Status de Execucao - HUB Depto. Tributario

## Concluido

- Projeto React/Vite/PWA criado.
- Apps HTML copiados para `public/apps`.
- Layout base ajustado ao mockup aprovado.
- Menu lateral retratil implementado.
- Pautas nativas do HUB configuradas como fonte ativa, sem dependencia ativa de Google Sheets/CSV.
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
- Botao Nova em Pautas restringido a administradores e direcionado para criacao nativa no HUB.
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
- Modulo Arquivos recebeu visualizador interno de documentos com painel grande, zoom, pagina, busca, abertura em nova aba, grifos amarelos e comentarios locais por arquivo.
- Visualizador de Arquivos evoluido para persistir grifos e comentarios no Supabase pela tabela `arquivo_anotacoes`, mantendo fallback local.
- Visualizador de Arquivos ampliado com exportacao de grifos e comentarios em Markdown para estudo/auditoria interna.
- Visualizador de Arquivos ajustado com botao visivel de fechar, fechamento por `Esc`, tela cheia propria do HUB, pesquisa com botao/Enter, fallback para links bloqueados e tentativa de preview interno para arquivos Office/Google.
- Visualizador de Arquivos evoluido com PDF.js para renderizar PDFs internamente com camada de texto, selecao de trechos e grifo visual quando o PDF possui texto pesquisavel.
- Visualizador de Arquivos evoluido com Mammoth para converter DOCX internamente para HTML, permitindo selecao de trechos e grifo visual no conteudo convertido.
- Patch SQL `supabase/patch_arquivos_biblioteca.sql` criado para tabelas `arquivo_pastas`, `arquivo_recursos`, policies RLS e Storage.
- Patch SQL `supabase/patch_arquivo_anotacoes.sql` criado para tabela de anotacoes, trigger e RLS por permissao do arquivo.
- Textos residuais com mojibake `Â·` removidos da interface React e fallback do e-mail admin corrigido para `fiscal10.hteixeira@gmail.com`.
- Painel `Saude operacional do HUB` adicionado em Configuracoes para checklist pre-deploy sem acionar builds Netlify.
- Checklist funcional interativo adicionado em Configuracoes para registrar OK/Ajustar/Falhou/Pendente por bloco de homologacao, com resumo copiavel.
- Console operacional de Lembretes e E-mails adicionado em Configuracoes para consultar fila, enfileirar avisos de vencimento, processar e-mails pendentes e enviar e-mail manual.
- Script local `npm.cmd run preflight` criado para validar arquivos essenciais, TypeScript e Netlify Functions antes de qualquer deploy de marco.
- Guia `GUIA_DEPLOY_MARCO.md` e consulta `supabase/check_hub_status.sql` criados para conferencia final antes de reativar builds no Netlify.
- Checklist `CHECKLIST_HOMOLOGACAO_FINAL.md` criado para homologacao final sem consumir creditos Netlify.
- Roteiro `ROTEIRO_HOMOLOGACAO_FUNCIONAL.md` criado para executar e registrar a rodada funcional final antes do deploy de marco.
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
- Notificacoes persistentes implementadas para o sino, com origem Supabase/local, lido individual, marcar todas, eventos de lembretes e alertas de pautas.
- Patch SQL `supabase/patch_notificacoes_persistentes.sql` criado para registrar notificacoes no banco, preservar leitura e sincronizar avisos ativos por usuario.
- Base de e-mails criada com fila `email_outbox`, funcoes SQL para enfileirar e-mails de lembretes e Netlify Function `email-outbox`.
- Eventos de e-mail homologados em modo teste: criacao de lembrete e rotina diaria de vencimentos enviaram via Resend com `EMAIL_FORCE_TEST_TO`.
- E-mails manuais da Coordenacao Tributaria conectados ao endpoint interno `coord-email`, com envio de pautas e avaliacoes pela fila `email_outbox`.
- App da Coordenacao Tributaria simplificado conforme rascunho: resumo geral, colaboradores, atividades/pautas, relatorios/e-mails, lembretes por prioridade, concluir/editar/excluir, historico e cadastro de colaboradores.
- Modulo Tarefas ativado com formulario completo, responsaveis, anexos, filtros, edicao, conclusao/reabertura, exclusao e persistencia Supabase/local.
- Patch SQL `supabase/patch_tarefas.sql` criado para tabelas `tarefas`, `tarefa_usuarios`, `tarefa_anexos` e RLS por criador/responsavel/admin/gestor.
- Tarefas preparadas para ativacao Supabase com migracao unica do calendario local para o banco quando `VITE_TAREFAS_SUPABASE=true` for habilitada.
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

- Subir no GitHub os arquivos alterados nesta atualizacao de saude operacional e e-mails.
- Usar o painel `Saude operacional do HUB` em Configuracoes para conferencia rapida do ambiente.
- Usar o checklist funcional interativo em Configuracoes para registrar a rodada de homologacao sem depender apenas do Markdown.
- Homologar o console operacional: consultar fila, enfileirar vencimentos, processar fila e enviar e-mail manual.
- Rodar `npm.cmd run preflight` antes de qualquer nova reativacao de build/deploy no Netlify.
- Rodar `supabase/check_hub_status.sql` no SQL Editor antes do proximo deploy de marco.
- Percorrer `CHECKLIST_HOMOLOGACAO_FINAL.md` e `ROTEIRO_HOMOLOGACAO_FUNCIONAL.md`, registrando itens `OK`, `Ajustar` ou `Falhou`.
- Manter `EMAIL_FORCE_TEST_TO=fiscal10.hteixeira@gmail.com` ate verificar dominio proprio no Resend.
- Manter Google Sheets apenas como historico/stand-by externo; Pautas nativas do HUB sao a fonte ativa.

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
- `npm.cmd run typecheck`: OK em 13/05/2026 apos notificacoes persistentes.
- `npm.cmd run build`: OK em 13/05/2026 apos notificacoes persistentes.
- `node --check netlify/functions/email-outbox.mjs`: OK em 13/05/2026 apos base futura de e-mails.
- `npm.cmd run typecheck`: OK em 13/05/2026 apos base futura de e-mails.
- `npm.cmd run build`: OK em 13/05/2026 apos base futura de e-mails.
- `node --check netlify/functions/email-outbox.mjs`: OK em 13/05/2026 apos eventos de e-mail.
- `npm.cmd run typecheck`: OK em 13/05/2026 apos eventos de e-mail.
- `npm.cmd run build`: OK em 13/05/2026 apos eventos de e-mail.
- `node --check netlify/functions/email-outbox.mjs`: OK em 13/05/2026 apos modo teste de e-mails e Idempotency-Key.
- `node --check netlify/functions/email-outbox.mjs`: OK em 13/05/2026 apos suporte a token por URL para teste protegido no navegador.
- `node --check netlify/functions/email-outbox.mjs`: OK em 13/05/2026 apos diagnostico de envio e processamento por URL com `action=process`.
- E-mail real: OK em 13/05/2026, envio Resend testado com `EMAIL_FORCE_TEST_TO` para criacao de lembrete.
- E-mail real: OK em 13/05/2026, rotina `action=daily` enfileirou vencimento e enviou com sucesso em modo teste.
- `npm.cmd run typecheck`: OK em 13/05/2026 apos modulo Tarefas Supabase/local.
- `npm.cmd run build`: OK em 13/05/2026 apos modulo Tarefas Supabase/local.
- `npm.cmd run typecheck`: OK em 13/05/2026 apos Tarefas integrar com IndexedDB do calendario original.
- `npm.cmd run build`: OK em 13/05/2026 apos Tarefas integrar com IndexedDB do calendario original.
- `npm.cmd run typecheck`: OK em 13/05/2026 apos ponte de Tarefas calendario/Supabase e guia de ativacao futura.
- `npm.cmd run build`: OK em 13/05/2026 apos ponte de Tarefas calendario/Supabase e guia de ativacao futura.
- `npm.cmd audit --omit=dev`: 0 vulnerabilidades.
- App local `http://127.0.0.1:5173`: HTTP 200.
- `node --check netlify/functions/admin-users.mjs`: OK em 13/05/2026 apos reset de senha provisoria.
- `npm.cmd run typecheck`: OK em 13/05/2026 apos reset de senha provisoria.
- `npm.cmd run build`: OK em 13/05/2026 apos reset de senha provisoria.
- `node --check netlify/functions/coord-email.mjs`: OK em 14/05/2026 apos integracao de e-mails manuais da Coordenacao Tributaria.
- `node --check netlify/functions/email-outbox.mjs`: OK em 14/05/2026 apos exportar processamento reutilizavel pela Coordenacao Tributaria.
- Parse do script `public/apps/coord-tributaria.html`: OK em 14/05/2026 apos endpoint interno de e-mail.
- `npm.cmd run typecheck`: OK em 14/05/2026 apos integracao de e-mails manuais da Coordenacao Tributaria.
- `npm.cmd run build`: OK em 14/05/2026 apos integracao de e-mails manuais da Coordenacao Tributaria.
- `npm.cmd run typecheck`: OK em 14/05/2026 apos visualizador interno de Arquivos.
- `npm.cmd run build`: OK em 14/05/2026 apos visualizador interno de Arquivos.
- `npm.cmd run typecheck`: OK em 14/05/2026 apos persistencia Supabase de grifos/comentarios em Arquivos.
- `npm.cmd run build`: OK em 14/05/2026 apos persistencia Supabase de grifos/comentarios em Arquivos.
- `npm.cmd run typecheck`: OK em 14/05/2026 apos limpeza de mojibake e correcao do e-mail admin padrao.
- `npm.cmd run build`: OK em 14/05/2026 apos limpeza de mojibake e correcao do e-mail admin padrao.
- `npm.cmd run typecheck`: OK em 14/05/2026 apos painel Saude operacional do HUB.
- `npm.cmd run build`: OK em 14/05/2026 apos painel Saude operacional do HUB.
- `npm.cmd run preflight`: OK em 14/05/2026 apos script local de pre-deploy.
- `npm.cmd run preflight:build`: OK em 14/05/2026 apos script local de pre-deploy com build Vite.
- `npm.cmd run preflight`: OK em 14/05/2026 apos guia de deploy de marco e consulta Supabase de conferencia.
- `npm.cmd run typecheck`: OK em 14/05/2026 apos exportacao Markdown das anotacoes do visualizador de Arquivos.
- `npm.cmd run preflight`: OK em 14/05/2026 apos exportacao Markdown das anotacoes do visualizador de Arquivos.
- `npm.cmd run preflight`: OK em 14/05/2026 apos checklist final de homologacao pre-Netlify.
- `supabase/check_hub_status.sql`: OK em 14/05/2026, validado no Supabase SQL Editor sem itens pendentes.
- `npm.cmd run preflight:build`: OK em 14/05/2026 antes do deploy de marco para homologacao funcional em producao.
- Deploy de marco em 14/05/2026 falhou no Netlify por arquivo duplicado/incorreto `src/lib/App.tsx` existente no GitHub; correcao indicada: remover o duplicado e manter apenas `src/App.tsx`.
- `npm.cmd run preflight`: OK em 14/05/2026 apos incluir alerta contra arquivos React principais em pastas incorretas.
- Deploy de marco no Netlify: OK em 15/05/2026 apos remover arquivos duplicados/incorretos do GitHub.
- `npm.cmd run typecheck`: OK em 15/05/2026 apos ajustes no visualizador de Arquivos.
- `npm.cmd run build`: OK em 15/05/2026 apos ajustes no visualizador de Arquivos.
- `npm.cmd run preflight`: OK em 15/05/2026 apos ajustes no visualizador de Arquivos.
- Limitacao tecnica registrada em 15/05/2026: PPTX/XLSX/Google/links externos continuam dependendo de preview externo; para grifo preciso em PPTX, recomenda-se converter para PDF pesquisavel ou implementar conversao/OCR futura.
- `npm.cmd run preflight`: OK em 15/05/2026 apos tela cheia HUB e pesquisa explicita no visualizador.
- `npm.cmd run typecheck`: OK em 15/05/2026 apos integrar PDF.js e Mammoth ao visualizador de Arquivos.
- `npm.cmd run build`: OK em 15/05/2026 apos integrar PDF.js e Mammoth ao visualizador de Arquivos.
- `npm.cmd run preflight`: OK em 15/05/2026 apos integrar PDF.js e Mammoth ao visualizador de Arquivos.
- `npm.cmd run typecheck`: OK em 15/05/2026 apos busca verde navegavel e remocao de grifo amarelo no visualizador de Arquivos.
- `npm.cmd run build`: OK em 15/05/2026 apos busca verde navegavel e remocao de grifo amarelo no visualizador de Arquivos.
- `npm.cmd run preflight`: OK em 15/05/2026 apos busca verde navegavel e remocao de grifo amarelo no visualizador de Arquivos.
- `npm.cmd run typecheck`: OK em 15/05/2026 apos trocar PDF para camada oficial de texto do PDF.js.
- `npm.cmd run build`: OK em 15/05/2026 apos trocar PDF para camada oficial de texto do PDF.js.
- `npm.cmd run preflight`: OK em 15/05/2026 apos trocar PDF para camada oficial de texto do PDF.js.
- Teste em Chrome real em 15/05/2026: producao ainda nao apresentava spans de texto no PDF antes deste ajuste, confirmando necessidade do novo upload/deploy.
- `npm.cmd run typecheck`: OK em 15/05/2026 apos fallback manual de camada de texto para PDF.
- `npm.cmd run build`: OK em 15/05/2026 apos fallback manual de camada de texto para PDF.
- `npm.cmd run preflight`: OK em 15/05/2026 apos fallback manual de camada de texto para PDF.
- `npm.cmd run typecheck`: OK em 19/05/2026 apos preparar campos de OCR/conversao de Arquivos.
- `npm.cmd run build`: OK em 19/05/2026 apos preparar campos de OCR/conversao de Arquivos.
- `npm.cmd run preflight`: OK em 19/05/2026 apos preparar campos de OCR/conversao de Arquivos.
- Arquivos: preparada a estrutura para versao pesquisavel/OCR com status de processamento, URL processada e guia tecnico; worker de OCR/conversao fica como proxima etapa.
- `node --check scripts/process-arquivos.mjs`: OK em 19/05/2026 apos criar processador local de documentos.
- `npm.cmd run typecheck`: OK em 19/05/2026 apos criar processador local de documentos.
- `npm.cmd run preflight`: OK em 19/05/2026 apos incluir processador local de documentos.
- `npm.cmd run build`: OK em 19/05/2026 apos incluir processador local de documentos.
- Arquivos: criada rotina local `npm run arquivos:process` para processar pendentes no Supabase, usando LibreOffice/OCRmyPDF/Tesseract quando instalados.
- `npm.cmd run arquivos:diagnose`: OK em 19/05/2026; apontou pendencias esperadas de `.env.local` e ferramentas locais de OCR/conversao.
- `npm.cmd run typecheck`: OK em 19/05/2026 apos incluir diagnostico do processador de arquivos.
- `npm.cmd run preflight`: OK em 19/05/2026 apos incluir diagnostico do processador de arquivos.
- Processador local de Arquivos: OK em 19/05/2026 apos instalar LibreOffice, OCRmyPDF, Tesseract e idioma `por`; dois arquivos processados como `ready`.
- `npm.cmd run typecheck`: OK em 19/05/2026 apos corrigir visualizador para usar a versao OCR/processada no painel interno.
- `npm.cmd run build`: OK em 19/05/2026 apos corrigir visualizador para usar a versao OCR/processada no painel interno.
- `npm.cmd run preflight`: OK em 19/05/2026 apos corrigir visualizador para usar a versao OCR/processada no painel interno.
- `npm.cmd run typecheck`: OK em 19/05/2026 apos corrigir navegacao de paginas e cancelamento de renderizacao no visualizador PDF.
- `npm.cmd run build`: OK em 19/05/2026 apos corrigir navegacao de paginas e cancelamento de renderizacao no visualizador PDF.
- `npm.cmd run preflight`: OK em 19/05/2026 apos corrigir navegacao de paginas e cancelamento de renderizacao no visualizador PDF.
- Arquivos: em 19/05/2026, preparado botao `Rodar OCR` para chamar agente local em `http://127.0.0.1:8787`, permitindo processar a fila de documentos pelo proprio menu Arquivos.
- `node --check scripts/ocr-local-agent.mjs`: OK em 19/05/2026 apos criar agente local para botao `Rodar OCR`.
- `npm.cmd run typecheck`: OK em 19/05/2026 apos criar agente local para botao `Rodar OCR`.
- `npm.cmd run build`: OK em 19/05/2026 apos criar agente local para botao `Rodar OCR`.
- `npm.cmd run preflight`: OK em 19/05/2026 apos criar agente local para botao `Rodar OCR`.
- OCR local: criado `INICIAR_OCR_HUB.cmd` para abrir o agente por duplo clique e `scripts/registrar-agente-ocr-login.ps1` para agendamento opcional ao login do Windows.
- `powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/registrar-agente-ocr-login.ps1 -ValidateOnly`: OK em 19/05/2026.
- `npm.cmd run preflight`: OK em 19/05/2026 apos incluir iniciador/agendamento opcional do agente OCR local.
- `scripts/preflight.mjs`: atualizado em 20/05/2026 para barrar `App.tsx`, `styles.css`, `main.tsx` e `types.ts` soltos na raiz do GitHub, pois esses arquivos devem ficar dentro de `src/`.
- OCR local: em 20/05/2026, implementado fallback por protocolo Windows `hubocr://rodar` para permitir acionar OCR pelo botao do HUB sem abrir PowerShell manualmente.
- `powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\registrar-protocolo-ocr.ps1 -ValidateOnly`: OK em 20/05/2026.
- `npm.cmd run typecheck`: OK em 20/05/2026 apos incluir protocolo `hubocr://rodar`.
- `npm.cmd run preflight`: OK em 20/05/2026 apos incluir protocolo `hubocr://rodar`.
- `npm.cmd run typecheck`: OK em 20/05/2026 apos console operacional de Lembretes e E-mails.
- `npm.cmd run preflight`: OK em 20/05/2026 apos console operacional de Lembretes e E-mails.
- `npm.cmd run build`: OK em 20/05/2026 apos console operacional de Lembretes e E-mails.
- `node --check`: OK em 20/05/2026 para o JavaScript standalone da nova Coordenacao Tributaria.
- `npm.cmd run build`: OK em 20/05/2026 apos simplificacao da aba Coordenacao Tributaria.
- `npm.cmd run preflight`: OK em 20/05/2026 apos simplificacao da aba Coordenacao Tributaria.
- `npm.cmd run build`: OK em 20/05/2026 apos incluir protocolo `hubocr://rodar`.
- Coordenacao Tributaria: em 20/05/2026, adicionados botao `Criar pauta`, anexos em lembretes/pautas e topo compacto com busca + filtro por colaborador + acoes na mesma linha.
- `node --check`: OK em 20/05/2026 para o JavaScript standalone da Coordenacao apos anexos/pautas/topo compacto.
- `npm.cmd run typecheck`: OK em 20/05/2026 apos ajustes de anexos/pautas na Coordenacao.
- `npm.cmd run preflight`: OK em 20/05/2026 apos ajustes de anexos/pautas na Coordenacao.
- `npm.cmd run build`: OK em 20/05/2026 apos ajustes de anexos/pautas na Coordenacao.
- Coordenacao Tributaria: em 20/05/2026, adicionado cache-buster no iframe (`coord-pautas-anexos`) para evitar que o HUB abra HTML antigo apos deploy.
- Roteiro/checklist de homologacao atualizados em 20/05/2026 com testes especificos de `Criar pauta`, anexos e topo compacto da Coordenacao.
- Coordenacao Tributaria: em 20/05/2026, preparada persistencia multiusuario Supabase com `coord_colaboradores`, `coord_itens` e Function `coord-data`; o app mantem fallback local quando a sincronizacao nao estiver disponivel.
- `node --check netlify/functions/coord-data.mjs`: OK em 20/05/2026.
- `node --check`: OK em 20/05/2026 para o JavaScript standalone da Coordenacao com sincronizacao Supabase.
- `npm.cmd run typecheck`: OK em 20/05/2026 apos persistencia Supabase da Coordenacao.
- `npm.cmd run preflight`: OK em 20/05/2026 apos persistencia Supabase da Coordenacao.
- `npm.cmd run build`: OK em 20/05/2026 apos persistencia Supabase da Coordenacao.
- Supabase: em 20/05/2026, usuario validou `supabase/check_hub_status.sql` com todas as tabelas, funcoes e buckets em `OK`, incluindo `coord_colaboradores` e `coord_itens`.
- Saude operacional: em 20/05/2026, adicionada checagem da Function `coord-data` no painel de Configuracoes para sinalizar sincronizacao Supabase da Coordenacao apos o proximo deploy.
- `npm.cmd run typecheck`: OK em 20/05/2026 apos checagem de Coordenacao na Saude operacional.
- `npm.cmd run preflight`: OK em 20/05/2026 apos checagem de Coordenacao na Saude operacional.
- `npm.cmd run build`: OK em 20/05/2026 apos checagem de Coordenacao na Saude operacional.
- Saude operacional: em 20/05/2026, painel de Tarefas ajustado para avaliar a origem com o usuario logado e documentada migracao unica calendario -> Supabase.
- `npm.cmd run typecheck`: OK em 20/05/2026 apos preparo de migracao unica das Tarefas para Supabase.
- `npm.cmd run preflight`: OK em 20/05/2026 apos preparo de migracao unica das Tarefas para Supabase.
- `npm.cmd run build`: OK em 20/05/2026 apos preparo de migracao unica das Tarefas para Supabase.
- Homologacao: em 21/05/2026, criado checklist funcional interativo em Configuracoes com progresso, status por item e resumo copiavel.
- `npm.cmd run typecheck`: OK em 21/05/2026 apos checklist funcional interativo.
- `npm.cmd run preflight`: OK em 21/05/2026 apos checklist funcional interativo.
- `npm.cmd run build`: OK em 21/05/2026 apos checklist funcional interativo.
- Saude operacional: em 21/05/2026, adicionada etiqueta `2026-05-21-checklist-operacional` para confirmar a versao carregada pelo navegador/Netlify no proximo deploy de marco.
- `npm.cmd run typecheck`: OK em 21/05/2026 apos etiqueta de versao na Saude operacional.
- `npm.cmd run preflight`: OK em 21/05/2026 apos etiqueta de versao na Saude operacional.
- `npm.cmd run build`: OK em 21/05/2026 apos etiqueta de versao na Saude operacional.
- Operacao: em 21/05/2026, adicionado painel `Guia rapido do administrador` em Configuracoes e criado `MANUAL_OPERACIONAL_HUB.md` com rotinas diaria/semanal e criterios antes de deploy de marco.
- `npm.cmd run typecheck`: OK em 21/05/2026 apos guia rapido operacional.
- `npm.cmd run preflight`: OK em 21/05/2026 apos guia rapido operacional.
- `npm.cmd run build`: OK em 21/05/2026 apos guia rapido operacional.
- Homologacao: em 21/05/2026, preparados ajustes solicitados: clique em lembrete do painel inicial abre edicao quando permitido, exportacao de pautas/lembretes em PDF/Excel compativel, sidebar de Tarefas passa a iniciar por `Minhas tarefas` com formulario oculto em `Nova tarefa`, e console de e-mails esclarece token manual versus agendamento Netlify.
- `npm.cmd run typecheck`: OK em 21/05/2026 apos ajustes de homologacao em Lembretes/Tarefas/exportacao.
- `npm.cmd run preflight`: OK em 21/05/2026 apos ajustes de homologacao em Lembretes/Tarefas/exportacao.
- `npm.cmd run build`: OK em 21/05/2026 apos ajustes de homologacao em Lembretes/Tarefas/exportacao.
- E-mails: em 21/05/2026, a Function `email-outbox` passou a aceitar operacao manual pela sessao Supabase de admin/gestor, mantendo `EMAIL_DISPATCH_TOKEN` como alternativa; roteiro de homologacao atualizado para testar ambos os caminhos.
- `node --check netlify/functions/email-outbox.mjs`: OK em 21/05/2026 apos autorizacao por sessao admin/gestor na fila de e-mails.
- `npm.cmd run typecheck`: OK em 21/05/2026 apos autorizacao por sessao admin/gestor na fila de e-mails.
- `npm.cmd run preflight`: OK em 21/05/2026 apos autorizacao por sessao admin/gestor na fila de e-mails.
- `npm.cmd run build`: OK em 21/05/2026 apos autorizacao por sessao admin/gestor na fila de e-mails.
- Exportacao: em 22/05/2026, botoes de Pautas e Lembretes passaram a gerar `.xlsx` real no navegador, com pacote OpenXML e planilha filtrada conforme a tela.
- Visualizador: em 22/05/2026, PDF/PPTX convertido para PDF pesquisavel passou a pesquisar todas as paginas e navegar automaticamente entre resultados, mantendo grifo amarelo manual e busca verde.
- `npm.cmd run typecheck`: OK em 22/05/2026 apos XLSX real e busca global no visualizador PDF.
- `npm.cmd run preflight`: OK em 22/05/2026 apos XLSX real e busca global no visualizador PDF.
- `npm.cmd run build`: OK em 22/05/2026 apos XLSX real e busca global no visualizador PDF.
- Pautas: em 26/05/2026, o menu `Inicio` foi renomeado para `Pautas`, passou a operar com fonte nativa do HUB, seletor mensal, destaques, anexos, conclusoes por usuario, exportacao PDF/XLSX e sem dependencia ativa do Google Sheets/CSV.
- Tarefas: em 26/05/2026, o menu foi renomeado para `Calendario de Tarefas` e recebeu a sidebar de Lembretes com busca, exportacao e abertura para edicao quando o usuario tem permissao.
- Coordenacao Tributaria: em 26/05/2026, os quadros foram renomeados para `Lembretes Avaliacao Colaboradores` e `Pautas`; a Function `coord-data` passou a ler/gravar pautas nativas para espelhar o menu principal.
- Notificacoes e rodapes: em 26/05/2026, notificacoes ganharam exportacao DOCX e envio por e-mail, e as sidebars de noticias/legislacoes ganharam exportacao PDF/XLSX.
- Supabase: em 26/05/2026, `supabase/check_hub_status.sql` passou a validar as tabelas/funcoes de Pautas nativas.
- `node --check netlify/functions/coord-data.mjs`: OK em 26/05/2026 apos ponte entre Coordenacao e Pautas nativas.
- `node --check netlify/functions/coord-email.mjs`: OK em 26/05/2026 apos ajustes de notificacoes/e-mails.
- `npm.cmd run typecheck`: OK em 26/05/2026 apos reestruturacao Pautas/Tarefas/Coordenacao.
- `npm.cmd run preflight`: OK em 26/05/2026 apos reestruturacao Pautas/Tarefas/Coordenacao.
- `npm.cmd run build`: OK em 26/05/2026 apos reestruturacao Pautas/Tarefas/Coordenacao.
- Pautas/Sheets: em 28/05/2026, removidos os residuos ativos da antiga integracao Sheets: Function `sheets-pautas`, variaveis `VITE_SHEETS_*`/Google do exemplo de ambiente, chamadas de fetch antigas e exigencia no preflight.
- `npm.cmd run typecheck`: OK em 28/05/2026 apos limpeza da integracao Sheets.
- `npm.cmd run preflight`: OK em 28/05/2026 apos limpeza da integracao Sheets.
- `npm.cmd run build`: OK em 28/05/2026 apos limpeza da integracao Sheets.
- Coordenacao/Pautas: em 28/05/2026, anexos criados em pautas pela Coordenacao passaram a ser sincronizados para o Storage `hub-anexos` e para `pauta_anexos`, preservando abertura/download quando a pauta e lida pelo modulo nativo.
- `node --check netlify/functions/coord-data.mjs`: OK em 28/05/2026 apos sincronizacao de anexos da Coordenacao com Pautas nativas.
- `node --check`: OK em 28/05/2026 para o JavaScript standalone da Coordenacao apos suporte a anexos por URL do Storage.
- `npm.cmd run typecheck`: OK em 28/05/2026 apos sincronizacao de anexos Coordenacao/Pautas.
- `npm.cmd run preflight`: OK em 28/05/2026 apos sincronizacao de anexos Coordenacao/Pautas.
- `npm.cmd run build`: OK em 28/05/2026 apos sincronizacao de anexos Coordenacao/Pautas.
- Homologacao final: em 28/05/2026, roteiro/checklist/manual foram alinhados com Pautas nativas, Calendario de Tarefas, Coordenacao espelhada e ausencia de dependencia ativa do Sheets.
- Agenda Tributaria: em 19/06/2026, preparada integracao Make/RFB com cache Supabase `agenda_tributaria_cache`, endpoint Netlify `/api/agenda-tributaria`, token `AGENDA_SYNC_TOKEN` e guia operacional para atualizacao mensal automatizada.
- Supabase: em 19/06/2026, `supabase/check_hub_status.sql` passou a validar a tabela/cache da Agenda Tributaria, colunas essenciais e trigger de `updated_at`.
- Saude operacional: em 19/06/2026, painel de Configuracoes atualizado com versao `2026-06-19-agenda-make-pomodoro`, checklist de Agenda Tributaria/Make e cartao operacional especifico para o endpoint `/api/agenda-tributaria`.
- Pomodoro: em 19/06/2026, janela flutuante de anotacoes ajustada para fundo branco opaco, sem translucidez sobre os demais menus do HUB.
- Manual operacional: em 19/06/2026, rotina diaria/semanal atualizada com verificacao da Agenda Tributaria, cenario Make mensal e notas flutuantes do Pomodoro.
- Homologacao: em 19/06/2026, roteiro externo e checklist interno em Configuracoes alinhados com Agenda Tributaria/Make e Pomodoro flutuante.
- `npm.cmd run typecheck`: OK em 19/06/2026 apos checklist Pomodoro/Agenda.
- `npm.cmd run build`: OK em 19/06/2026 apos checklist Pomodoro/Agenda.
- GitHub: em 19/06/2026, usuario informou upload dos arquivos do bloco Pomodoro/Agenda; `.gitignore` e `.env.example` ficaram monitorados porque o upload web do GitHub bloqueou arquivos ocultos, mas ambos existem no workspace local e ja constavam em versoes anteriores.
- Sanidade: em 19/06/2026, busca local nao encontrou referencias ativas antigas a `tasks`, `Sheets HUB`, `CSV HUB` ou `SHEETS` em `src`, `public`, `netlify` e `supabase`.
- `npm.cmd run typecheck`: OK em 19/06/2026 apos conferencia de upload/arquivos ocultos.
- Saude operacional: em 19/06/2026, painel de Configuracoes passou a exibir o host Supabase ativo e alertar se o HUB nao estiver apontando para `kgorlrpparhcrprwamlc.supabase.co`.
- `npm.cmd run typecheck`: OK em 19/06/2026 apos indicador de projeto Supabase ativo.
- `npm.cmd run preflight`: OK em 19/06/2026 apos indicador de projeto Supabase ativo.
- `npm.cmd run build`: OK em 19/06/2026 apos indicador de projeto Supabase ativo.
- Coordenacao/e-mails: em 19/06/2026, o app standalone da Coordenacao passou a usar a sessao Supabase do HUB para envio manual de e-mails quando disponivel; `EMAIL_DISPATCH_TOKEN` permanece apenas como contingencia operacional.
- `npm.cmd run typecheck`: OK em 19/06/2026 apos ajuste de envio manual por sessao na Coordenacao.
- `npm.cmd run preflight`: OK em 19/06/2026 apos ajuste de envio manual por sessao na Coordenacao.
- `npm.cmd run build`: OK em 19/06/2026 apos ajuste de envio manual por sessao na Coordenacao.
- Planejamento: adicionado bloco futuro para Coordenacao gerar relatorio XLSX de bonificacao por template, com botao `Preencher avaliacoes`, upload do XLSX do colaborador, edicao em espelho da planilha, notas/recomendacoes e exportacao final.
- Pautas: em 22/06/2026, ajustada regra de conclusao para impedir usuario comum de concluir pauta geral; usuario comum so conclui quando estiver marcado, e pautas ja concluidas por ele saem da sua visualizacao ativa.
- Supabase: em 22/06/2026, criado `supabase/patch_pautas_completion_permissions.sql` para alinhar `can_complete_pauta` e a policy de insercao em `pauta_conclusoes` a regra de conclusao por usuario marcado.
- `npm.cmd run typecheck`: OK em 22/06/2026 apos regra de conclusao de Pautas.
- `npm.cmd run build`: OK em 22/06/2026 apos regra de conclusao de Pautas.
- Pautas: em 22/06/2026, e-mails e relatorios exportados passaram a usar base Arial 12pt, preservando estilo global da pauta (fonte, negrito e italico) no corpo do e-mail; formulario ganhou previa visual da formatacao antes de salvar.
- `npm.cmd run typecheck`: OK em 22/06/2026 apos ajuste de fonte/estilo de Pautas.
- `npm.cmd run build`: OK em 22/06/2026 apos ajuste de fonte/estilo de Pautas.
- Calendario de Tarefas: em 22/06/2026, Bloco 01 ajustou a exclusao da sidebar `Minhas tarefas` para arquivar a tarefa no Supabase via RPC `archive_tarefa` e arquivar tambem o espelho do calendario, removendo a tarefa da lista ativa sem apagar o historico.
- Supabase: em 22/06/2026, criado `supabase/patch_tarefas_archive_rpc.sql` para permitir exclusao logica segura de tarefas por criador, admin ou gestor.
- `npm.cmd run typecheck`: OK em 22/06/2026 apos ajuste de exclusao de tarefas.
- `npm.cmd run build`: OK em 22/06/2026 apos ajuste de exclusao de tarefas.
- Coordenacao: em 22/06/2026, Bloco 02 limpou a linguagem do standalone para reduzir ambiguidade: criacao passou a usar `Criar lembrete colaborador` e `Criar item de pauta`, mantendo os tipos internos existentes para preservar compatibilidade dos dados.
- `npm.cmd run typecheck`: OK em 22/06/2026 apos ajuste de linguagem da Coordenacao.
- `npm.cmd run build`: OK em 22/06/2026 apos ajuste de linguagem da Coordenacao.
- Pautas: em 22/06/2026, Bloco 03 consolidou a formatacao visual dos itens: tamanho de fonte, negrito, italico e grifo amarelo passam a ser preservados na descricao, refletidos no campo de edicao, exibidos no card e mantidos nos e-mails/relatorios por metadados embutidos.
- `npm.cmd run typecheck`: OK em 22/06/2026 apos consolidacao da formatacao de Pautas.
- `npm.cmd run build`: OK em 22/06/2026 apos consolidacao da formatacao de Pautas.
- Pomodoro: em 22/06/2026, Bloco 04 ajustou a janela flutuante de anotacoes para permitir arrastar pelo cabecalho, minimizar/reabrir e manter fundo branco opaco sobre qualquer menu do HUB.
- `npm.cmd run typecheck`: OK em 22/06/2026 apos janela flutuante arrastavel/minimizavel do Pomodoro.
- `npm.cmd run build`: OK em 22/06/2026 apos janela flutuante arrastavel/minimizavel do Pomodoro.
- Calendario de Tarefas: em 25/06/2026, Bloco 05 reforcou a identificacao de tarefas do usuario para que `Minhas tarefas` considere criador e responsaveis por ID, e-mail, nome ou iniciais vindos dos perfis.
- `npm.cmd run typecheck`: OK em 25/06/2026 apos reforco do filtro `Minhas tarefas`.
- `npm.cmd run build`: OK em 25/06/2026 apos reforco do filtro `Minhas tarefas`.
- Calendario de Tarefas: em 25/06/2026, Bloco 06 consolidou o fluxo unico de criacao/edicao: duplo clique no calendario aciona a sidebar principal do HUB, com data local estavel, e o iframe recebeu nova versao para evitar cache antigo.
- `npm.cmd run typecheck`: OK em 25/06/2026 apos consolidacao do fluxo unico do Calendario de Tarefas.
- `npm.cmd run build`: OK em 25/06/2026 apos consolidacao do fluxo unico do Calendario de Tarefas.
- Coordenacao: em 25/06/2026, Bloco 07 iniciou o fluxo de bonificacao por template XLSX: upload do XLSX do colaborador, espelho editavel em tabela, botao `Preencher avaliacoes`, campos de colaborador/periodo/recomendacoes e exportacao final em XLSX.
- `npm.cmd run typecheck`: OK em 25/06/2026 apos painel de template XLSX de bonificacao na Coordenacao.
- `npm.cmd run build`: OK em 25/06/2026 apos painel de template XLSX de bonificacao na Coordenacao.
- Homologacao: em 26/06/2026, Bloco 08 atualizou o roteiro/checklist/manual com os criterios finais de Pautas, Calendario de Tarefas, Coordenacao, integracao de lembretes ao calendario e template XLSX de bonificacao.
- `npm.cmd run typecheck`: OK em 26/06/2026 apos atualizacao do roteiro/checklist/manual de homologacao.
- `npm.cmd run preflight`: OK em 26/06/2026 apos atualizacao do roteiro/checklist/manual de homologacao.
- `npm.cmd run build`: OK em 26/06/2026 apos atualizacao do roteiro/checklist/manual de homologacao.
- Limpeza: em 26/06/2026, Bloco 09 removeu o CSV legado `public/data/pautas-hub.csv` e criou `GUIA_LIMPEZA_NETLIFY_SUPABASE.md` para orientar a remocao das variaveis antigas de Sheets e confirmar o projeto Supabase correto do HUB.
- `npm.cmd run typecheck`: OK em 26/06/2026 apos limpeza final de variaveis/artefatos legados do Sheets.
- `npm.cmd run preflight`: OK em 26/06/2026 apos limpeza final de variaveis/artefatos legados do Sheets.
- `npm.cmd run build`: OK em 26/06/2026 apos limpeza final de variaveis/artefatos legados do Sheets.

## Atualizacao 05/11/2026 - Retomada apos troca de HD

### Ambiente

- Git 2.56 instalado no PC novo; variavel de usuario `NODE_OPTIONS=--use-system-ca` (a rede/antivirus intercepta HTTPS e o npm so funciona com os certificados do Windows).
- Nova pasta de trabalho: `HUB_Tributario_HT_git` (clone do GitHub). A pasta antiga foi arquivada como `_ARQUIVO_App HUB TRIB (versao ate 13-07-2026)`; backup em `_backups\HUB_Tributario_HT_local_2026-11-05_1549.zip`.
- Atalho "HUB Depto Tributario" recriado na Area de Trabalho (Chrome, perfil fiscal10, modo app).
- `.env.local` recebeu `VITE_SUPABASE_ANON_KEY`: o app local passa a usar o banco real (testes locais alteram dados reais; usar itens de teste identificados).

### GitHub

- Commit `2e26496`: sincronizado o trabalho local de 13/07 (Quadro de Avisos v2) e os patches SQL de Pautas/Tarefas de 02 a 22/06 que estavam apenas no PC.
- Commit `cd766fd`: `check_hub_status.sql` confere os objetos do Quadro v2 e corrige o teste de buckets, que marcava OK mesmo sem o bucket existir.

### Seguranca (branch `seguranca-anexos-privados`)

- `supabase/patch_anexos_privados.sql`: bucket `hub-anexos` privado; arquivos do Quadro lidos conforme a permissao do aviso; envio de arquivo do Quadro apenas na pasta do proprio usuario ativo; links publicos antigos migrados para `quadro_avisos.file_path`.
- App: Pautas, Quadro de Avisos e Coordenacao (`coord-data`) passam a usar links assinados de 1 hora, gerados apenas para itens que o usuario pode ver.
- `supabase/patch_quadro_notify_seguro.sql`: notificacao de aviso particular so pode ser disparada pelo autor do aviso ou por admin.
- `patch_quadro_avisos.sql` e `patch_quadro_avisos_v2.sql` nao tornam mais o bucket publico.
- Login de demonstracao restrito a `npm run dev`; senha removida do pacote de producao e da documentacao.
- Dependencias: `npm audit fix` (0 vulnerabilidades no pacote de producao).
- `check_hub_status.sql` passa a conferir bucket privado, regras de arquivo do Quadro e a protecao da notificacao.
- Testes: patches validados em PostgreSQL 16 simulando o Supabase (execucao repetida, migracao de links, leitura/envio por perfil admin, gestor, autor, marcado, nao marcado, inativo e visitante); `npm.cmd run typecheck`, `npm.cmd run preflight` e `npm.cmd run build` OK em 05/11/2026.

### Ordem de aplicacao (deploy de marco)

1. SQL Editor do Supabase: rodar `supabase/check_hub_status.sql`.
2. Se os itens "(Quadro v2)" estiverem PENDENTE: rodar `supabase/patch_quadro_avisos_v2.sql`.
3. Rodar `supabase/patch_anexos_privados.sql` e `supabase/patch_quadro_notify_seguro.sql`.
4. Juntar o branch `seguranca-anexos-privados` ao `main`.
5. Netlify: Deploys > Trigger deploy > Deploy site.
6. Rodar `check_hub_status.sql` (nenhum PENDENTE) e testar: anexo de pauta, imagem do Quadro e anexo pela Coordenacao.

Os passos 3 a 5 devem ser feitos em sequencia: com o app antigo, os anexos de Pautas e do Quadro deixam de abrir apos o passo 3.

### Pendencias registradas

- `vite`/`esbuild` (apenas servidor de testes local): correcao exige atualizar para vite 8.
- Agente OCR local (protocolo `hubocr://` e tarefa de login) nao esta registrado no PC novo; registrar a partir da nova pasta quando for usar.
- Usuario logado ainda consegue gravar (sem ler) arquivo na pasta de lembrete de outro usuario.
- Tokens em URL (`?token=`) na Agenda e na fila de e-mails; preferir cabecalho.
- E-mail de senha provisoria grava a senha em texto na fila `email_outbox`.
- `src/App.tsx` monolitico (~300 KB): dividir em modulos.
- Menu Lembretes fora do menu lateral (acesso pelo Calendario de Tarefas e pelo sino): confirmar se e intencional.

## Atualização 06/11/2026 - Melhorias de uso, Agenda automática e segurança

### Publicado no `main` (produção)

- Quadro de Avisos (`7694f3f`, `7e7d532`): layout legível, painéis laterais de leitura e edição, editor com formatação, cor do post-it com prévia, edição e exclusão de avisos (com remoção do arquivo substituído).
- Pautas (`5814a16`): editor por trecho (5 tamanhos, negrito, itálico, sublinhado, grifo que liga e desliga, listas e limpar formatação), compartilhado com o Quadro; pautas antigas convertidas ao editar.
- Pomodoro (`1c84f1f`): notificação de fim de ciclo sem `sw.js` próprio (o registro do service worker do Pomodoro sobrescrevia o do HUB).
- Revisão geral (`1bc0b92`): Agenda Tributária abre no mês atual e não trava após mês sem dados; contrastes corrigidos; confirmação antes de toda exclusão; edição de pastas em Arquivos; mensagem clara quando o e-mail de senha não é enviado.
- Agenda Tributária automática (`ceeaf9c`): função agendada `agenda-sync` (diária, 06h15 de Brasília) atualiza o mês atual e o seguinte a partir da RFB, soma os prazos do ICMS/RS por regra (`netlify/lib/agenda-regras.mjs`, com feriados e dias não úteis) e o ISS de São Francisco de Paula fixo no dia 20, com observação para consultar a Prefeitura. Avisa os administradores (sino e e-mail) quando há mudança. Execução manual de 06/11 gravou novembro/2026 (12 datas, 60 itens).
- Lembretes fora do menu lateral, por decisão do usuário (o Quadro de Avisos cumpre a função).

### Branch `seguranca-etapas` (aguardando publicação)

1. Senha provisória (`1f53ec4`): o e-mail é enviado na hora quando o envio real está ativo; a fila `email_outbox` registra apenas "[senha omitida por segurança]". E-mails antigos com senha foram apagados da fila (autorizado pelo usuário).
2. Chaves de acesso (`18a776e`): tokens da Agenda e da fila de e-mails aceitos somente pelo cabeçalho; o token de disparo fica no `sessionStorage`.
3. Permissões (`b954225`):
   - Arquivos: qualquer usuário ativo envia arquivos e cria pastas, para todos (global) ou só para si; editar e excluir somente o autor ou o administrador; os demais apenas visualizam e baixam (botão Baixar).
   - Anexos (`hub-anexos`): gravação restrita a quem gerencia a pauta (admin), a tarefa ou o lembrete.
   - Patch `supabase/patch_permissoes_arquivos_anexos.sql`, validado em PostgreSQL simulando o Supabase.
4. Dependências (`c45d309`): Vite 7.3 e plugin-react 5.2 (`npm audit`: 0 vulnerabilidades); Node 22 no Netlify; ajustes de contraste e ícone do HUB nas páginas internas.
5. OCR local (`73a028f`): instalador `INSTALAR_OCR_HUB.cmd` (Tesseract com português, LibreOffice, OCRmyPDF sem Ghostscript, protocolo `hubocr://`, início automático e diagnóstico); agente recusa origens não autorizadas.
6. Código (`6e73dea`, `c4a7af2`): `src/App.tsx` (8.982 linhas) dividido em `src/modules`, `src/components`, `src/lib` e `src/app` sem mudança de comportamento; textos visíveis acentuados.

Testes desta rodada: `tsc` e `npm.cmd run build` OK; testes automatizados em navegador (Pautas, Quadro, Links, Arquivos com três perfis, Pomodoro, varredura de todas as seções e contraste) aprovados em 06/11/2026.

### Ordem de publicação

1. SQL Editor do Supabase: rodar `supabase/patch_permissoes_arquivos_anexos.sql`.
2. Juntar o branch `seguranca-etapas` ao `main` (o Netlify publica sozinho).
3. Conferir: envio de arquivo por colaborador, anexo de tarefa e redefinição de senha.

### Pendências

- Executar `INSTALAR_OCR_HUB.cmd` como administrador no PC novo e testar um PDF digitalizado.
- E-mails: ativar `EMAIL_SCHEDULE_ENABLED=true`; para envio real, `EMAIL_DELIVERY_ENABLED=true` com `EMAIL_PROVIDER_API_KEY` e `EMAIL_FROM` (Resend).
- Netlify: corrigir ou remover `APP_BASE_URL` (aponta para `hub-depto-tributario-hteix.netlify.app`, que responde 404); o endereço correto é `https://hub-depto-tributario-ht.netlify.app`.
- Apagar as pautas e os avisos de teste criados durante a homologação.
- SEFAZ-RS bloqueia consultas automáticas (WAF); os prazos estaduais seguem regras configuradas e devem ser revistos se a legislação mudar.

### Pendências de 05/11/2026 resolvidas

- `vite`/`esbuild` (item 4 acima), agente OCR (item 5, falta só executar o instalador), gravação em pasta de lembrete alheia (item 3), tokens em URL (item 2), senha na fila de e-mails (item 1), `App.tsx` monolítico (item 6) e Lembretes fora do menu (confirmado como intencional).

### Publicado em 06/11/2026 (tarde)

- `patch_permissoes_arquivos_anexos.sql` aplicado no Supabase e branch `seguranca-etapas` publicado.
- Netlify: `APP_BASE_URL` corrigida para `https://hub-depto-tributario-ht.netlify.app`; `EMAIL_SCHEDULE_ENABLED` e `EMAIL_DELIVERY_ENABLED` já estavam `true`; `EMAIL_FORCE_TEST_TO` mantém todos os e-mails na caixa fiscal10 (modo de teste).
- Arquivos sem OCR nesta versão (`OCR_ENABLED = false` em `src/app/appConfig.ts`): digitalizados ficam guardados como enviados, para visualizar, baixar e excluir. O instalador `INSTALAR_OCR_HUB.cmd` fica pronto para uma versão futura.
- Testes em navegador dentro do projeto: `npm.cmd run test:e2e` (ver `tests/e2e/LEIAME.md`), rodar antes de cada publicação.
- Acentuação das mensagens do app, e-mails, respostas das Functions e apps internos (exceto palavras-chave de busca de notícias, filtros de consulta e cabeçalhos técnicos).
- E-mails pelo Gmail: novo provedor `EMAIL_PROVIDER=gmail` (SMTP com senha de app; variáveis `GMAIL_USER`, `GMAIL_APP_PASSWORD` e, opcional, `EMAIL_FROM_NAME`). O Resend continua disponível; o domínio próprio no Resend deixou de ser necessário.
- Segurança local: `SUPABASE_SERVICE_ROLE_KEY` retirada do `.env.local` (projeto e pasta arquivada). Só o OCR local usa essa chave; ao reativá-lo, gerar chave secreta nova no Supabase. Uma cópia antiga permanece no backup `_backups\HUB_Tributario_HT_local_2026-11-05_1549.zip`: recomenda-se trocar a chave no Supabase e no Netlify.
- Ramos de trabalho já incorporados ao `main` apagados do GitHub.

### Pendências (atualizadas)

- Envio pelo Gmail ativo desde 06/11/2026: conta remetente `hub.hteixeira@gmail.com` (verificação em duas etapas e senha de app), `EMAIL_PROVIDER=gmail`; teste confirmado na caixa fiscal10 e `EMAIL_FORCE_TEST_TO` retirada — cada usuário recebe os próprios e-mails. Manter atualizados os e-mails cadastrados em Configurações > Usuários.
- Trocar a chave `service_role` (Supabase e Netlify), por causa da cópia no backup.
- Conferir em 07/11/2026 as rotinas agendadas no Node 22 (Agenda 06h15, fila de e-mails 09h, notícias).
- OCR em versão futura.

## Atualização 09/11/2026 — telas do HUB e Avaliações

- Todas as telas e apps abrem dentro do HUB, com botões **Tela cheia** e **Abrir em nova janela** (`?janela=1#/rota`). Os apps ficam cadastrados em `src/app/appsRegistry.ts` (modo `embutido` ou `janela`).
- Acesso: todos os menus para todos os usuários; Configurações (administrador) e Coordenação (gestores) continuam restritos. A edição é controlada por permissões em cada módulo.
- Rotinas agendadas conferidas em 09/11/2026: Agenda às 06h15 rodou normalmente.
- **Avaliações** (menu Escritório, `src/modules/AvaliacoesModule.tsx`):
  - colaborador preenche competência, notas de 0 a 10 e justificativas dos 7 critérios e o feedback; salva rascunho ou envia à coordenação (trava após o envio e avisa os administradores por e-mail e notificação — Function `avaliacao-email`);
  - administrador vê todas, filtra por competência e situação, corrige a autoavaliação, lança notas e justificativas do coordenador e recomendações, e devolve ou reabre ao colaborador;
  - as notas da coordenação só ficam visíveis ao colaborador depois da devolução (tabela separada `avaliacoes_coordenacao`, protegida por RLS);
  - mostra média aritmética, faixa (Péssimo a Excelente) e notas de referência; imprime ou gera PDF pelo navegador;
  - coluna Subcoordenação preparada para um usuário com permissão específica (versão futura);
  - o app anterior (Apps Script) continua disponível pelo link "App anterior".
- Banco: rodar `supabase/patch_avaliacoes.sql` no SQL Editor (pode rodar mais de uma vez).

### Próximas etapas

- Reconstruir dentro do HUB, um por vez: Controle de Apuração, Controle de Férias e Onboarding (dados no Supabase agora; base migra para o servidor no fim do projeto).

### Avaliações — ajustes de 09/11/2026 (tarde)

- Média geral: média das médias da autoavaliação, do coordenador e da subcoordenação (quando houver); aparece para o administrador e, após a devolução, para o colaborador; também na lista, na impressão e no e-mail de devolução.
- Feedback com o item 4 "Sugestões e críticas".
- Recomendações da coordenação em itens: 5 campos por padrão, com inclusão, edição e exclusão; só os preenchidos são gravados e mostrados ao colaborador.
- Réplica do colaborador a cada recomendação depois da devolução ("Salvar réplicas" ou "Salvar e avisar a coordenação"); o banco só permite ao colaborador alterar as réplicas de uma avaliação devolvida.
- Avisos (e-mail e sino): envio do colaborador → administradores; devolução → colaborador; réplica → administradores. A autoavaliação do próprio administrador não dispara o aviso de envio.
- Banco: rodar `supabase/patch_avaliacoes_v2.sql` (depois de `patch_avaliacoes.sql`; pode rodar mais de uma vez) antes de publicar esta versão.
- Painel da coordenação (administrador): ao abrir Avaliações, quatro colunas — Aguardando análise, Avaliadas e devolvidas, Com réplica do colaborador e Em preenchimento —, com filtro por competência; botão "Painel" volta a ele.
- "Salvar e devolver ao colaborador" sempre envia o aviso (e-mail e sino), inclusive ao devolver de novo uma avaliação já devolvida.
- Botão "Preencher notas do coordenador com 10" (administrador), acima da tabela: lança 10 nos 7 critérios da coluna do coordenador, mantendo as justificativas; depois basta reduzir as notas necessárias e salvar.
- Resposta da coordenação a cada item do feedback (campo do administrador; o colaborador lê após a devolução; vai também no e-mail de devolução e na impressão). Banco: `supabase/patch_avaliacoes_v3.sql`.
- Seções minimizáveis (Notas por critério, Feedback, Notas de referência, Recomendações), com "Minimizar tudo / Expandir tudo"; a escolha fica guardada no navegador. A média geral fica sempre visível.

## Controle de Apuração no HUB (reconstrução em etapas, a partir de 09/11/2026)

Base: app "Controle de Apuração" v0.11.8 FIX13 do HTSERVER (com SALVARFECHAR01, COLRENAME01, CELLNOTE01, IMPORT02, DELALL01). O app antigo segue em paralelo até a validação.

### Etapa 1 — Base de dados e regras (concluída)

- `supabase/patch_apuracao_etapa1.sql`: tabelas `apur_*` (empresas, períodos, fotografias mensais, checklist, notas de célula, pendência mensal, notas do ADM, grifos, documentos, alertas, auditoria), leitura por RLS (ADM vê tudo; usuário vê a própria carteira e o histórico) e gravação só por funções que repetem as regras do servidor antigo:
  - empresa: criar/editar/excluir, inclusive em competência histórica reaberta (só a fotografia do mês);
  - ordem (arrastar), status e nota de célula, pendência mensal, grifos, notas do ADM;
  - + Coluna e renomear coluna; importação e prévia (a planilha será lida no navegador);
  - ciclo: Salvar apuração (até 10/2026 fecha), Salvar / Fechar apuração (de 11/2026), reabrir (usuário só sem mês posterior; ADM sempre), gerar novo período (trava FIX13 para usuário comum; período vazio para ADM);
  - excluir todas (ADM, digitar EXCLUIR), transferir carteira, Dashboard ADM, Histórico ADM;
  - migração da base antiga em lotes (`apur_migrate_rows`, somente ADM, pode ser repetida).
- Usuários: administrador do HUB = ADM do app; demais usuários ativos = donos de carteira. Login, senha e cadastro de usuários ficam com o HUB.
- Testes: `tests/sql/apuracao_etapa1.sql` (50 verificações no simulador Postgres, todas conforme o app antigo).

### Etapa 2 — Grade mensal no HUB (concluída)

- Novo item no menu (Escritório): **Controle de Apuração**, embutido no HUB (`public/apps/apuracao/`). O item antigo passa a se chamar **Controle de Apuração (servidor)** e continua abrindo o HTSERVER.
- A tela é a mesma do app 0.11.8.13 (`index.html`, `app.js`, `styles.css` copiados com ajustes mínimos: janelas flutuantes no endereço do HUB, sem service worker próprio, sem login/conta/backup local).
- `hub-apuracao.js` atende os endereços `/api/...` da tela com as funções `apur_*` do Supabase e o login do HUB (o HUB envia o token, o endereço e a chave pública; fora da moldura, usa a sessão salva no navegador). Ao trocar de usuário no mesmo navegador, o cache local do usuário anterior é descartado.
- Funciona nesta etapa: carga da carteira, status dos itens, notas de célula, pendência do mês, grifos, notas do ADM, ordem das empresas, + Empresa / editar / excluir, + Coluna e renomear, Salvar / Fechar / Reabrir / Gerar novo período, Excluir todas, Dashboard ADM, Histórico ADM, alertas gerais (exibição), janela flutuante e painel da empresa.
- Ainda não (avisam "entra numa próxima etapa"): leitura de planilha XLS/XLSX (etapa 3), documentos e exportação XLSX (etapa 5), cadastro de alertas, backup e auditoria (etapa 6). Usuários são cadastrados no HUB.
- Banco: rodar `supabase/patch_apuracao_etapa2.sql` (depois da etapa 1; pode rodar mais de uma vez): `apur_bootstrap`, `apur_me`, `apur_alerts_list` e nota ADM com o id gerado pela tela (reenvio não duplica).
- Testes: simulador do HUB com a tela real (26 verificações: usuária comum, troca de usuário, ADM, nota ADM, dashboard, salvar, janela flutuante) e a suíte e2e do HUB.

### Etapa 3 — Cadastro, importação XLS/XLSX e excluir todas (concluída)

- "Importar XLS/XLSX" funciona no HUB: a planilha é lida no próprio navegador (`public/apps/apuracao/importador.js`, tradução do importador IMPORT02 do servidor antigo, com a biblioteca SheetJS 0.20.3 em `vendor/`, carregada só ao importar). As duplicidades com a carteira são conferidas pelo banco (`apur_import_preview`) e a gravação continua em `apur_import_companies`.
- Paridade conferida com o servidor antigo: o modelo do app, 5 planilhas de teste (seções por regime, abas mensais, aba de controle, cabeçalho legado, fórmulas, .xls) e 6 planilhas reais do departamento geram a mesma prévia. Única diferença: número gravado como decimal aparece "430" em vez de "430.0" nas linhas ignoradas.
- "+ Empresa", editar, duplicidades (CNPJ, Domínio, nome) e CNPJ inválido conferidos na tela.
- "Excluir todas": texto ajustado ao HUB (sem backup local; as empresas ficam marcadas como excluídas, com o histórico preservado).
- Sem SQL novo nesta etapa.

### Etapa 4 — Ciclo mensal (concluída)

- Comparação passo a passo entre o servidor antigo (0.11.8.13, base nova) e o HUB: dois roteiros com 109 operações (cadastro, status, notas, grifos, nota ADM, Salvar/Fechar/Reabrir/Gerar novo período em 09, 10, 11 e 12/2026, regra até 10/2026 × a partir de 11/2026, trava FIX13, reabertura com mês posterior, alterações históricas do ADM, exclusão e ordem no mês, + Coluna, transferência e excluir todas). Depois de cada operação são comparados o resultado, a mensagem e o estado completo das carteiras, o Dashboard ADM (5 competências) e o Histórico ADM.
- Resultado: estado, Dashboard e Histórico iguais em todas as operações. Diferenças encontradas e tratadas:
  - mensagens com a competência em "MM/AAAA" no HUB e "AAAA-MM" no antigo → corrigido (`supabase/patch_apuracao_etapa4.sql`);
  - arquivar nota ADM ou excluir empresa em mês fechado: o antigo responde erro 500 (a alteração fica presa na fila de sincronização); o HUB responde 400 com a mesma mensagem e a tela descarta a alteração. Mantido o comportamento do HUB.
- Tela: Salvar (continua aberta), Fechar Apuração, bloqueio de novo período com empresa não concluída, Reabrir, Gerar novo período (tela vai para o novo mês, itens pendentes) e bloqueio de reabertura com mês posterior — 12 verificações.

### Etapa 5 — Painel da empresa, documentos e exportação XLSX (concluída)

- Biblioteca de documentos no Storage do Supabase (pasta privada `apuracao-docs`, até 25 MB por arquivo, mesmas extensões do app antigo). Envio em duas fases (o banco reserva o documento, a tela envia o arquivo, o banco confere o tamanho e ativa); download e exclusão só para quem pode ver a empresa naquela competência; o Storage recusa arquivo sem reserva no banco. SHA-256 registrado.
- Exportação XLSX gerada no navegador (`exportador.js`, ExcelJS 4.4.0 em `vendor/`, carregado só ao exportar) a partir de `apur_export_data`: mesmas 5 abas, colunas, cores, comentários das notas de célula, filtros, painéis, larguras e nome de arquivo do servidor antigo.
- Progresso com o mesmo arredondamento do servidor antigo (metade para o par, como no Python).
- Comparação com o servidor antigo: 8 exportações célula a célula (valores, cores, formatos, comentários, fontes, alinhamento, larguras, alturas, filtros, painéis, mesclagens e página) — todas iguais; envio, download e exclusão de documentos incluídos no roteiro de paridade (58 operações, estado igual).
- Painel da empresa (checklist, particularidades, observações e janela própria) conferido na tela.
- Banco: rodar `supabase/patch_apuracao_etapa5.sql` antes de publicar.

### Etapa 6 — Administração (parte 1 concluída: alertas, usuários, auditoria)

- Alertas gerais: criar, editar (público, vigência, pausa, fonte, negrito, grifo) e excluir pela Administração, com as mesmas validações e mensagens do servidor antigo (`apur_alert_save`, `apur_alert_delete`). Roteiro de paridade com 22 operações (inclusive 10 recusas) — igual em todas.
- Usuários: cadastro, perfil, senha e ativação ficam no HUB (Configurações → Usuários e perfis); na Administração do app ficam a lista com as carteiras e a transferência de carteira (o formulário de novo usuário, a política de ADM, a senha e a exclusão foram ocultados no HUB, com aviso).
- Auditoria: `apur_audit_list` (últimos 300 registros, somente ADM).
- Tela: 13 verificações (alerta pela tela, público só da Bia, Davi não vê, editor de usuário só com a carteira, transferência, exclusão, auditoria).
- Banco: rodar `supabase/patch_apuracao_etapa6.sql`.
- Parte 2 (a seguir): backup e restauração no HUB e migração da base do HTSERVER.
