# Roteiro de homologacao funcional final - HUB Depto Tributario

## Como usar

Marque cada item como:

- `OK`: passou sem erro.
- `Ajustar`: passou parcialmente ou exige melhoria.
- `Falhou`: bloqueia o deploy de marco.

Nao acione deploy no Netlify durante esta rodada. O objetivo e testar o HUB ja publicado/ambiente disponivel e registrar o que ainda precisa de ajuste antes do deploy de marco.

Opcionalmente, use tambem `Configuracoes > Checklist funcional` dentro do HUB para marcar `OK`, `Ajustar`, `Falhou` ou `Pendente` durante a rodada. O painel salva a marcacao no navegador e permite copiar um resumo.

## Situacao antes da rodada

- GitHub atualizado: `OK`
- `npm.cmd run preflight`: `OK`
- `supabase/check_hub_status.sql`: `OK`
- Netlify builds pausados para economia de creditos: confirmar visualmente no Netlify
- Apos o proximo deploy de marco, `Configuracoes > Saude operacional` deve exibir `Versao do HUB: 2026-05-21-checklist-operacional`

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

## Bloco 3 - Lembretes

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

## Bloco 4 - Tarefas

| Teste | Resultado |
| --- | --- |
| Criar tarefa pela sidebar | Pendente |
| Criar tarefa pelo calendario original | Pendente |
| Responsaveis aparecem e salvam | Pendente |
| Anexo em tarefa salva | Pendente |
| Editar tarefa | Pendente |
| Concluir/reabrir tarefa | Pendente |
| Excluir tarefa permitida | Pendente |
| Calendario e painel lateral ficam sincronizados | Pendente |

## Bloco 5 - Arquivos e visualizador

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

## Bloco 6 - Links uteis

| Teste | Resultado |
| --- | --- |
| Admin cria link global | Pendente |
| Admin edita link global | Pendente |
| Colaborador visualiza link global | Pendente |
| Colaborador cria link pessoal | Pendente |
| Colaborador edita/exclui apenas link pessoal | Pendente |

## Bloco 7 - Rodapes

| Teste | Resultado |
| --- | --- |
| Noticias rolam em velocidade legivel | Pendente |
| Noticias abrem sidebar | Pendente |
| Noticias sao de cunho tributario | Pendente |
| Links de noticias abrem noticia especifica | Pendente |
| Legislacoes rolam em velocidade legivel | Pendente |
| Legislacoes abrem sidebar | Pendente |
| Legislacoes trazem apenas normas oficiais | Pendente |
| Titulos de legislacoes mostram norma/data | Pendente |

## Bloco 8 - Notificacoes

| Teste | Resultado |
| --- | --- |
| Sino mostra contador correto | Pendente |
| Lembrete vencido aparece | Pendente |
| Lembrete do dia/proximo aparece | Pendente |
| Marcar uma como lida funciona | Pendente |
| Marcar todas como lidas funciona | Pendente |
| Colaborador recebe somente notificacoes visiveis | Pendente |

## Bloco 9 - E-mails

| Teste | Resultado |
| --- | --- |
| Criacao de lembrete enfileira e-mail | Pendente |
| Vencimento de lembrete enfileira e-mail | Pendente |
| Reset de senha enfileira e-mail | Pendente |
| Coordenacao envia pauta por e-mail | Pendente |
| Coordenacao envia avaliacoes por e-mail | Pendente |
| `email_outbox` registra `sent` em modo teste | Pendente |

## Bloco 10 - Coordenacao Tributaria

| Teste | Resultado |
| --- | --- |
| App abre sem erro | Pendente |
| Topo compacto exibe busca, colaborador e acoes na mesma linha | Pendente |
| Botao `Criar pauta` aparece no topo e nas acoes rapidas | Pendente |
| Criar pauta registra item na lista de atividades | Pendente |
| Criar lembrete registra item na lista de atividades | Pendente |
| Anexo em pauta/lembrete salva e aparece no card | Pendente |
| Historico dos ultimos 30 dias abre | Pendente |
| Gerar relatorio inclui pautas, lembretes e anexos | Pendente |
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
| Ha ajustes antes do deploy de marco | Pendente |
| Liberado para reativar Netlify e fazer deploy de marco | Pendente |

## Observacoes da rodada

Use este espaco para registrar falhas, telas, sintomas e decisoes.

- 
