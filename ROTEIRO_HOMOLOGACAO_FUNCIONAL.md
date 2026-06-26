# Roteiro de homologacao funcional final - HUB Depto Tributario

## Como usar

Marque cada item como:

- `OK`: passou sem erro.
- `Ajustar`: passou parcialmente ou exige melhoria.
- `Falhou`: bloqueia o deploy final.

Enquanto estivermos economizando creditos, nao acione deploy no Netlify durante ajustes intermediarios. Use este roteiro em dois momentos: antes do deploy final, para conferir estrutura/local, e depois do deploy unico, para validar o HUB publicado.

Opcionalmente, use tambem `Configuracoes > Checklist funcional` dentro do HUB para marcar `OK`, `Ajustar`, `Falhou` ou `Pendente` durante a rodada. O painel salva a marcacao no navegador e permite copiar um resumo.

## Situacao antes da rodada

- GitHub atualizado: `OK`
- `npm.cmd run preflight`: `OK`
- `npm.cmd run build`: `OK`
- `supabase/check_hub_status.sql`: `OK`
- Netlify builds pausados para economia de creditos: confirmar visualmente no Netlify
- Apos o deploy final, o menu lateral deve exibir `Pautas` e `Calendario de Tarefas`, com Pautas nativas sem dependencia ativa do Sheets.
- Agenda Tributaria deve ter `AGENDA_SYNC_TOKEN` configurado no Netlify e no Make, quando a automacao mensal for ativada.

## Bloco 1 - Login e perfis

| Teste | Perfil | Resultado |
| --- | --- | --- |
| Login admin abre o HUB | Admin | Pendente |
| Admin visualiza `Configuracoes` | Admin | Pendente |
| Admin visualiza `Coordenacao` | Admin | Pendente |
| Login colaborador abre o HUB | Colaborador | Pendente |
| Colaborador nao visualiza `Configuracoes` | Colaborador | Pendente |
| Colaborador nao visualiza `Coordenacao` | Colaborador | Pendente |
| Logout funciona pelo menu lateral | Ambos | Pendente |

## Bloco 2 - Usuarios e perfis

| Teste | Resultado |
| --- | --- |
| Criar usuario teste | Pendente |
| Editar nome/e-mail/perfil/status | Pendente |
| Desativar usuario | Pendente |
| Reativar usuario | Pendente |
| Reset de senha provisoria enfileira e-mail | Pendente |

## Bloco 3 - Pautas

| Teste | Resultado |
| --- | --- |
| Menu principal aparece como `Pautas` | Pendente |
| Admin cria nova pauta nativa | Pendente |
| Admin edita pauta nativa | Pendente |
| Admin adiciona anexo em pauta | Pendente |
| Usuario baixa anexo quando pauta for geral ou atribuida a ele | Pendente |
| Filtro mensal altera mes/ano exibido | Pendente |
| Botao destacar deixa pauta em alto relevo | Pendente |
| Botao de rolagem liga/desliga rolagem da lista | Pendente |
| Usuario comum nao conclui pauta geral sem estar marcado | Pendente |
| Usuario marcado conclui pauta atribuida a ele | Pendente |
| Pauta concluida pelo usuario marcado sai da visualizacao ativa dele | Pendente |
| Conclusao de pauta gera notificacao/e-mail para admin | Pendente |
| Admin visualiza item concluido no historico/Coordenacao e consegue reabrir quando aplicavel | Pendente |
| Exportar pautas em PDF | Pendente |
| Exportar pautas em XLSX real | Pendente |
| Enviar pautas por e-mail preserva fonte legivel e estilos principais | Pendente |
| Pauta criada na Coordenacao aparece no menu Pautas apos recarregar | Pendente |
| Pauta criada no menu Pautas aparece na Coordenacao apos recarregar | Pendente |
| Pauta criada na Coordenacao com anexo aparece no menu Pautas com anexo abrindo/baixando | Pendente |
| Pauta criada no menu Pautas com anexo fica disponivel para usuarios autorizados | Pendente |

## Bloco 4 - Lembretes

| Teste | Resultado |
| --- | --- |
| Admin cria lembrete publico | Pendente |
| Admin cria confidencial com usuario marcado | Pendente |
| Admin cria confidencial sem usuario marcado | Pendente |
| Colaborador cria lembrete proprio | Pendente |
| Colaborador edita/conclui/exclui apenas proprio | Pendente |
| Colaborador visualiza publico de terceiros | Pendente |
| Colaborador nao edita lembrete de terceiro | Pendente |
| Confidencial sem marcado aparece so para criador/admin | Pendente |
| Confidencial com marcado aparece para criador/admin/marcado | Pendente |
| Anexo em lembrete salva e abre | Pendente |
| Lembretes aparecem na sidebar do Calendario de Tarefas | Pendente |
| Clicar em lembrete na sidebar abre edicao para admin/gestor/criador | Pendente |
| Exportar lista de lembretes em PDF | Pendente |
| Exportar lista de lembretes em XLSX real | Pendente |

## Bloco 5 - Calendario de Tarefas

| Teste | Resultado |
| --- | --- |
| Menu lateral aparece como `Calendario de Tarefas` | Pendente |
| Criar tarefa pela sidebar `Nova tarefa` | Pendente |
| Sidebar inicia como `Minhas tarefas` com formulario oculto | Pendente |
| Botao `Nova tarefa` abre formulario lateral | Pendente |
| Duplo clique no dia do calendario abre o mesmo formulario lateral | Pendente |
| Botao redundante `+ Novo` do calendario nao aparece ou nao cria fluxo duplicado | Pendente |
| Responsaveis aparecem e salvam | Pendente |
| Anexo em tarefa salva | Pendente |
| Editar tarefa/notas pela sidebar | Pendente |
| Botoes salvar/cancelar aparecem e funcionam ao editar tarefa | Pendente |
| Concluir/reabrir tarefa | Pendente |
| Excluir tarefa permitida remove da lista ativa e mantem historico na Agenda | Pendente |
| Usuario marcado visualiza em `Minhas tarefas` e recebe notificacao | Pendente |
| Usuario comum nao edita/exclui tarefa criada por outro | Pendente |
| Calendario e painel lateral ficam sincronizados | Pendente |

## Bloco 6 - Arquivos e visualizador

| Teste | Resultado |
| --- | --- |
| Criar pasta global | Pendente |
| Criar subpasta | Pendente |
| Cadastrar link/documento | Pendente |
| Upload por arrastar e soltar | Pendente |
| Editar arquivo salvo | Pendente |
| Abrir arquivo em nova aba | Pendente |
| Abrir visualizador interno | Pendente |
| Zoom funciona | Pendente |
| Busca no documento/painel funciona | Pendente |
| Salvar grifo | Pendente |
| Salvar comentario | Pendente |
| Excluir anotacao propria | Pendente |
| Exportar notas em Markdown | Pendente |
| Rodar OCR pelo botao do HUB/protocolo hubocr://rodar | Pendente |
| Arquivo processado mostra `Versao pesquisavel pronta` | Pendente |
| Colaborador nao exclui global de terceiro | Pendente |

## Bloco 7 - Links uteis

| Teste | Resultado |
| --- | --- |
| Admin cria link global | Pendente |
| Admin edita link global | Pendente |
| Colaborador visualiza link global | Pendente |
| Colaborador cria link pessoal | Pendente |
| Colaborador edita/exclui apenas link pessoal | Pendente |

## Bloco 8 - Agenda Tributaria

| Teste | Resultado |
| --- | --- |
| Menu Agenda tributaria abre sem erro | Pendente |
| Mes atual carrega dados do cache compartilhado quando disponivel | Pendente |
| Botao de atualizar mes chama a Function da RFB | Pendente |
| Falha da Function preserva fallback/local sem quebrar a tela | Pendente |
| Make mensal chama `/api/agenda-tributaria` com `AGENDA_SYNC_TOKEN` | Pendente |
| Depois do Make, agenda abre com dados atualizados para o mes sincronizado | Pendente |

## Bloco 9 - Pomodoro

| Teste | Resultado |
| --- | --- |
| Pomodoro abre sem erro | Pendente |
| Sidebar de anotacoes abre dentro do Pomodoro | Pendente |
| Botao flutuante abre anotacoes sobre outros menus | Pendente |
| Janela flutuante fica opaca, legivel e sem transparencia | Pendente |
| Botao salvar persiste o texto editado | Pendente |
| Botao fechar recolhe a janela e preserva anotacoes | Pendente |

## Bloco 10 - Rodapes

| Teste | Resultado |
| --- | --- |
| Noticias rolam em velocidade legivel | Pendente |
| Noticias abrem sidebar | Pendente |
| Noticias sao de cunho tributario | Pendente |
| Links de noticias abrem noticia especifica | Pendente |
| Sidebar de noticias exporta PDF/XLSX | Pendente |
| Legislacoes rolam em velocidade legivel | Pendente |
| Legislacoes abrem sidebar | Pendente |
| Legislacoes trazem apenas normas oficiais | Pendente |
| Titulos de legislacoes mostram norma/data | Pendente |
| Sidebar de legislacoes exporta PDF/XLSX | Pendente |

## Bloco 11 - Notificacoes

| Teste | Resultado |
| --- | --- |
| Sino mostra contador correto | Pendente |
| Lembrete vencido aparece | Pendente |
| Lembrete do dia/proximo aparece | Pendente |
| Marcar uma como lida funciona | Pendente |
| Marcar todas como lidas funciona | Pendente |
| Colaborador recebe somente notificacoes visiveis | Pendente |
| Exportar notificacoes em DOCX | Pendente |
| Enviar notificacoes por e-mail | Pendente |
| Notificacoes antigas sao removidas apos 5 dias pela rotina de sincronizacao | Pendente |

## Bloco 12 - E-mails

| Teste | Resultado |
| --- | --- |
| Criacao de lembrete enfileira e-mail | Pendente |
| Vencimento de lembrete enfileira e-mail | Pendente |
| Reset de senha enfileira e-mail | Pendente |
| Coordenacao envia pauta por e-mail | Pendente |
| Coordenacao envia avaliacoes por e-mail | Pendente |
| Consultar/processar fila funciona com admin/gestor logado sem colar token | Pendente |
| Consultar/processar fila tambem funciona com `EMAIL_DISPATCH_TOKEN` colado | Pendente |
| `email_outbox` registra `sent` em modo teste | Pendente |

## Bloco 13 - Coordenacao Tributaria

| Teste | Resultado |
| --- | --- |
| App abre sem erro | Pendente |
| Topo compacto exibe busca, colaborador e acoes na mesma linha | Pendente |
| Quadro `Lembretes Avaliacao Colaboradores` aparece no resumo | Pendente |
| Quadro `Pautas` aparece no resumo | Pendente |
| Botao `Criar pauta` aparece no topo e nas acoes rapidas | Pendente |
| Criar pauta registra item na lista de atividades | Pendente |
| Criar lembrete registra item na lista de atividades | Pendente |
| Linguagem usa `Criar lembrete colaborador` e `Criar item de pauta` sem ambiguidade | Pendente |
| Anexo em pauta/lembrete salva e aparece no card | Pendente |
| Anexo de pauta criada na Coordenacao permanece disponivel no menu Pautas nativo | Pendente |
| Lembrete de avaliacao marcado para integrar/repetir cria tambem tarefa no Calendario de Tarefas | Pendente |
| Historico dos ultimos 30 dias abre | Pendente |
| Gerar relatorio inclui pautas, lembretes e anexos | Pendente |
| Template de bonificacao aceita upload XLSX e abre espelho editavel | Pendente |
| Botao `Preencher avaliacoes` cria/preenche bloco de avaliacao | Pendente |
| Exportar XLSX do template gera arquivo real `.xlsx` | Pendente |
| Botao enviar pauta por e-mail funciona | Pendente |
| Botao enviar avaliacoes por e-mail funciona | Pendente |
| Registros aparecem em `email_outbox` | Pendente |
| Dados carregam com selo `supabase` quando o SQL/Function estiverem publicados | Pendente |
| Alteracao feita por admin/gestor aparece para outro admin/gestor apos recarregar | Pendente |
| Sem token ou sem backend, app continua funcionando em modo `local` | Pendente |

## Resultado final

| Item | Resultado |
| --- | --- |
| Todos os blocos criticos passaram | Pendente |
| Ha ajustes antes do deploy final | Pendente |
| Liberado para reativar Netlify e fazer deploy final | Pendente |

## Observacoes da rodada

Use este espaco para registrar falhas, telas, sintomas e decisoes.

- 
