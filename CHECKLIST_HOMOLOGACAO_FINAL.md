# Checklist de homologacao final - HUB Depto Tributario

## Objetivo

Usar este checklist para fechar a homologacao local e funcional antes de reativar builds no Netlify.

O HUB tambem possui um checklist funcional interativo em `Configuracoes`, util para registrar a rodada diretamente na interface e copiar um resumo ao final.

Enquanto estivermos economizando creditos, nao acione deploy no Netlify. Suba arquivos no GitHub apenas para versionamento e deixe o Netlify em `Stopped builds`.

## Regra de ouro

- So reativar o Netlify quando todos os itens criticos abaixo estiverem `OK`.
- Se algum item falhar, corrigir localmente, rodar preflight e subir somente os arquivos alterados no GitHub.
- Depois do deploy final, voltar para `Stopped builds` se ainda estivermos em desenvolvimento.

## 1. Conferencia local

Na pasta do projeto, executar:

```powershell
npm.cmd run preflight
```

Opcional, quando quisermos validar build completo local:

```powershell
npm.cmd run preflight:build
```

Resultado esperado:

```text
OK. Preflight local aprovado.
```

## 2. Conferencia Supabase

No Supabase SQL Editor, rodar o arquivo:

```text
supabase/check_hub_status.sql
```

Resultado esperado:

- tabelas essenciais: `OK`;
- funcoes RPC essenciais: `OK`;
- buckets de anexos/arquivos: `OK`;
- nenhum item novo como `PENDENTE`.

Se algo aparecer como `PENDENTE`, executar o patch correspondente antes do deploy.

## 3. Login e perfis

Validar com usuario administrador:

- login abre o HUB;
- menu `Configuracoes` aparece;
- menu `Coordenacao` aparece;
- usuario consegue sair pelo menu lateral.

Validar com usuario colaborador:

- login abre o HUB;
- menu `Configuracoes` nao aparece;
- menu `Coordenacao` nao aparece;
- usuario consegue sair pelo menu lateral.

## 4. Usuarios e perfis

Como administrador:

- criar usuario teste;
- editar nome, e-mail, perfil e status;
- desativar e reativar usuario;
- testar reset de senha provisoria;
- confirmar que o usuario aparece como ativo/inativo corretamente.

## 5. Pautas

Como administrador:

- confirmar que o menu principal aparece como `Pautas`;
- criar pauta nativa;
- editar pauta nativa;
- anexar arquivo em pauta;
- destacar pauta e remover destaque;
- ligar/desligar rolagem da lista;
- alterar mes/ano exibido;
- exportar pauta em PDF;
- exportar pauta em XLSX real;
- criar pauta na Coordenacao e confirmar reflexo no menu `Pautas`;
- criar pauta no menu `Pautas` e confirmar reflexo na Coordenacao;
- confirmar que anexo criado pela Coordenacao abre/baixa no menu `Pautas`.

Como colaborador:

- visualizar pauta geral;
- visualizar pauta atribuida ao usuario;
- baixar anexo quando autorizado;
- concluir pauta geral ou atribuida;
- nao visualizar pauta restrita a outro usuario.

## 6. Lembretes

Como administrador:

- criar lembrete publico;
- criar lembrete confidencial com usuario marcado;
- criar lembrete confidencial sem usuario marcado;
- editar, concluir, reabrir e excluir lembrete;
- anexar arquivo e conferir exibicao do anexo.

Como colaborador:

- criar lembrete proprio;
- editar, concluir e excluir apenas lembrete proprio;
- visualizar lembretes publicos de terceiros;
- nao editar/concluir/excluir lembretes de terceiros;
- nao visualizar lembrete confidencial sem estar marcado;
- visualizar lembrete confidencial quando estiver marcado.

## 7. Tarefas

Validar os dois caminhos:

- criar tarefa pela sidebar;
- criar tarefa pelo calendario original, com duplo clique no dia ou botao `+ Novo`;
- marcar responsaveis;
- anexar arquivo;
- editar tarefa;
- concluir/reabrir;
- excluir tarefa permitida;
- conferir se o calendario e a lista lateral ficam sincronizados.

Observacao: a sincronizacao multiusuario Supabase de Tarefas esta preparada para ativacao futura por variavel. O fluxo atual preserva a integracao com o calendario original.

## 8. Arquivos

Como administrador:

- criar pasta global;
- criar subpasta;
- cadastrar link;
- arrastar e soltar arquivo;
- editar registro salvo;
- abrir arquivo em nova aba;
- abrir visualizador interno;
- salvar grifo;
- salvar comentario;
- excluir anotacao propria;
- exportar notas em Markdown;
- clicar em `Rodar OCR` e confirmar que o Windows abre/processa via `hubocr://rodar`, quando houver arquivo pendente;
- confirmar que arquivo processado exibe selo `Versao pesquisavel pronta`;
- excluir arquivo/pasta permitida.

Como colaborador:

- visualizar arquivos globais;
- criar arquivo/pasta pessoal, se permitido;
- nao excluir recursos globais de terceiros.

## 9. Links uteis

Como administrador/gestor:

- criar link global;
- editar link global;
- excluir link permitido.

Como colaborador:

- visualizar link global;
- criar link pessoal;
- editar/excluir apenas link pessoal.

## 10. Noticias e legislacoes

Noticias:

- rodape deve rolar em velocidade legivel;
- sidebar deve abrir ao clicar;
- listar somente noticias de cunho tributario;
- priorizar as 3 noticias tributarias mais relevantes do dia;
- URLs devem abrir a noticia especifica, nao a home do portal.

Legislacoes:

- rodape deve rolar em velocidade semelhante ao rodape de noticias;
- sidebar deve abrir ao clicar;
- listar apenas normas oficiais;
- titulos devem trazer nome da norma e data;
- se nao houver norma publicada no dia, trazer normas oficiais recentes anteriores.

## 11. Notificacoes

No sino:

- lembretes vencidos aparecem;
- lembretes de hoje/proximos aparecem;
- notificacao marcada como lida some ou reduz contador;
- `marcar todas` funciona;
- colaborador recebe apenas notificacoes visiveis para ele.

## 12. E-mails

Enquanto o dominio proprio nao estiver verificado no Resend, manter:

```text
EMAIL_FORCE_TEST_TO=fiscal10.hteixeira@gmail.com
```

Validar:

- criar lembrete enfileira e-mail;
- rotina diaria de vencimentos enfileira e-mail;
- reset de senha provisoria enfileira e-mail;
- Coordenacao envia pauta por e-mail por comando manual;
- Coordenacao envia avaliacoes por e-mail por comando manual;
- tabela `email_outbox` registra `sent` em modo teste.

## 13. Coordenacao Tributaria

Validar no app integrado:

- abrir app sem erro;
- confirmar topo compacto com busca, filtro por colaborador e botoes de acao;
- criar pauta;
- criar lembrete;
- anexar arquivo em pauta/lembrete;
- confirmar que anexos aparecem no card;
- confirmar que anexo de pauta criada na Coordenacao permanece disponivel no menu `Pautas`;
- abrir historico dos ultimos 30 dias;
- gerar relatorio e conferir pautas, lembretes e anexos;
- usar botao manual de envio de pauta por e-mail;
- usar botao manual de envio de avaliacoes por e-mail;
- conferir registros na `email_outbox`.
- apos executar `supabase/patch_coord_tributaria.sql` e publicar a Function, confirmar selo `supabase`;
- confirmar que dados salvos por um admin/gestor continuam apos recarregar e aparecem para outro admin/gestor;
- confirmar que, se a Function falhar, o app preserva fallback `local` sem bloquear o uso.

## 14. Criterios para liberar deploy final

Liberar Netlify somente se:

- `npm.cmd run preflight` passou;
- `supabase/check_hub_status.sql` passou;
- login admin e colaborador passaram;
- pautas nativas passaram;
- lembretes passaram;
- tarefas passaram;
- arquivos e visualizador passaram;
- OCR manual pelo HUB passou, quando houver arquivo pendente para processar;
- noticias/legislacoes passaram;
- e-mails pelo menos enfileiram e, em modo teste, enviam para `fiscal10`;
- nao ha erro vermelho em fluxo principal.

## 15. Pendencias planejadas para depois

Estas pendencias nao bloqueiam o deploy final, salvo decisao em contrario:

- avaliar futuramente app substituto externo, se voltar a ser necessario; Pautas nativas sao a fonte ativa;
- verificar dominio proprio no Resend para envio real a todos os colaboradores;
- evoluir precisao de OCR/grifo quando o documento original tiver baixa qualidade ou layout complexo;
- ativar sincronizacao multiusuario Supabase de Tarefas quando o fluxo local estiver totalmente aprovado.
