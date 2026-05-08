# Projeto HUB Depto. Tributário

## 1. Objetivo

Criar um HUB interno para o Departamento Tributário, com acesso por login e senha, atualização por múltiplos usuários, integração com planilhas e apps HTML existentes, notificações, anexos, notícias tributárias e módulos de trabalho diário.

O produto deve funcionar como um app web interno/PWA, acessível pelo navegador e instalável como atalho no computador/celular, com controle de permissões e área administrativa.

## 2. Decisão de arquitetura

### Recomendação principal

Construir um app web/PWA separado do site institucional da empresa, publicado em subdomínio próprio, por exemplo:

- `hub.ht.com.br`
- `tributario.ht.com.br`
- `hubtributario.ht.com.br`

Essa opção é melhor que uma landing page ou HTML estático porque o HUB exige:

- login por usuário;
- permissões por perfil;
- dados dinâmicos;
- anexos;
- notificações;
- envio de e-mails;
- integração com Google Sheets, Google Drive e apps HTML;
- histórico e manutenção contínua.

### Stack recomendada para execução

- Frontend: React + Vite + TypeScript.
- Experiência PWA: service worker, manifest, ícone instalável e cache controlado.
- UI: CSS modular ou Tailwind, com layout responsivo.
- Backend: Supabase como primeira recomendação para banco, autenticação, storage e políticas de acesso.
- Hospedagem: Netlify ou Vercel.
- Integrações Google: Google Sheets API e Google Drive API via função server-side.
- E-mails: provedor transacional ou integração Gmail/Google Workspace, a definir conforme conta corporativa.
- Notícias: fase 1 com cadastro/admin manual ou curadoria semiautomática; fase 2 com RSS/API quando houver fonte confiável.

### Observação de segurança

O administrador não deve visualizar senhas dos usuários em texto aberto. O correto é o admin poder criar usuários, alterar perfis, bloquear/desbloquear acesso e disparar redefinição de senha. Senhas devem ser armazenadas somente pelo provedor de autenticação, em formato seguro.

## 3. Perfis de usuário

### Administrador

Usuário inicial: `fiscal10.heixeira@gmail.com`.

Permissões:

- acessar todos os módulos;
- criar, editar e desativar usuários;
- definir perfis e permissões;
- cadastrar notícias;
- visualizar pautas, lembretes e tarefas de todos;
- administrar integrações;
- auditar alterações principais;
- configurar fontes, planilhas e pastas integradas.

### Colaborador

Permissões:

- acessar a própria página inicial;
- visualizar pautas gerais ou atribuídas;
- criar e gerenciar seus lembretes;
- visualizar lembretes em que foi marcado;
- anexar documentos aos próprios registros;
- acessar arquivos autorizados;
- adicionar links úteis pessoais;
- visualizar orientações da coordenação atribuídas a ele.

### Gestor/Coordenação

Permissões:

- criar orientações para usuários;
- acompanhar pautas e tarefas da equipe;
- criar lembretes para outros usuários;
- consultar status e prazos;
- editar conteúdos sob responsabilidade da coordenação.

## 4. Módulos do HUB

## 4.1 Login

Primeira tela do app.

Campos:

- e-mail;
- senha;
- opção de recuperação de senha.

Regras:

- usuário sem login não acessa nenhuma rota interna;
- sessão deve expirar conforme configuração de segurança;
- perfil do usuário define os menus e dados visíveis;
- login deve registrar data/hora do último acesso.

## 4.2 Página inicial

Layout baseado no desenho fornecido:

- cabeçalho com logotipo e nome: `HUB Depto Tributário - H. Teixeira`;
- ícone de notificações;
- quadro `Pautas`;
- quadro `Lembretes`;
- menu lateral;
- rodapé com notícias tributárias em carrossel.

Comportamento:

- cards carregam dados reais após login;
- dados são filtrados pelo usuário/perfil;
- layout deve funcionar em desktop primeiro e depois em mobile/tablet;
- PWA deve permitir instalação como aplicativo.

## 4.3 Pautas

Origem desejada:

- `Sheets HUB Tributário`;
- aba `HUB`.

Dados mínimos:

- tema;
- prazo;
- prioridade;
- responsável;
- status;
- origem da pauta;
- data da última atualização.

Comportamento:

- listar pautas no quadro da home;
- destacar vencidas e próximas do vencimento;
- permitir abrir detalhe da pauta;
- opcionalmente sincronizar em intervalos definidos.

Decisão de MVP:

- iniciar com leitura da planilha para exibição;
- escrita de volta na planilha fica para fase 2, salvo se for requisito obrigatório.

## 4.4 Lembretes

Dados:

- título;
- descrição;
- prazo com data e hora;
- criador;
- usuários marcados;
- anexos;
- status: aberto, concluído, vencido, cancelado;
- prioridade;
- data de criação;
- data de alteração.

Comportamento:

- criar lembrete;
- editar lembrete;
- anexar PDF, DOCX, imagem, XLSX e outros formatos permitidos;
- marcar usuários;
- gerar notificação interna para usuários marcados;
- indicador amarelo para lembrete próximo do vencimento;
- indicador vermelho para lembrete vencido;
- enviar e-mail um dia antes do vencimento.

Regra de envio de e-mail:

- se não houver usuários marcados, enviar para o criador;
- se houver usuários marcados, enviar para o criador e para todos os marcados;
- evitar envio duplicado para o mesmo usuário;
- registrar que o e-mail foi enviado.

## 4.5 Notificações

Tipos iniciais:

- usuário foi marcado em lembrete;
- lembrete está próximo do vencimento;
- lembrete venceu;
- nova orientação da coordenação;
- pauta atribuída ao usuário.

Comportamento:

- badge no ícone de notificações;
- lista de notificações;
- marcar como lida;
- link para o item relacionado;
- filtro por lidas/não lidas.

## 4.6 Menu

Itens previstos:

1. Tarefas.
2. Arquivos.
3. Agenda Tributária.
4. Pomodoro Timer.
5. Links úteis.

## 4.7 Tarefas

Conteúdo:

- calendário;
- sidebar de lista de tarefas;
- anexos;
- prazo;
- status;
- orientação da coordenação.

Integrações:

- app HTML de calendário a ser fornecido;
- app Coordenação Tributária;
- aba `avaliações`, conforme estrutura atual do app externo.

Decisão de MVP:

- integrar visualmente o app HTML em rota interna;
- depois adaptar para gravar dados no banco central, se necessário.

## 4.8 Arquivos

Origem:

- pasta compartilhada do Google Drive.

Comportamento:

- listar arquivos e pastas autorizados;
- abrir arquivo em nova aba;
- permitir upload somente para perfis autorizados;
- opcionalmente anexar arquivos do Drive aos lembretes/tarefas.

Decisão de MVP:

- iniciar com link/visualização controlada da pasta;
- API completa de listagem/upload fica como fase 2 caso demande permissão Google Workspace.

## 4.9 Agenda Tributária

Origem:

- app HTML existente a ser fornecido.

Comportamento:

- abrir dentro do HUB em rota própria;
- manter aparência integrada ao layout;
- revisar se o app HTML usa arquivos locais, scripts externos ou armazenamento próprio.

## 4.10 Pomodoro Timer

Origem:

- app HTML existente a ser fornecido.

Comportamento:

- abrir dentro do HUB em rota própria;
- preservar timer, controles e estado local;
- opcionalmente registrar uso por usuário em fase futura.

## 4.11 Links úteis

Dados:

- título;
- URL;
- categoria;
- usuário dono;
- público ou privado;
- data de criação.

Comportamento:

- usuário pode cadastrar links próprios;
- admin pode cadastrar links globais;
- validação básica de URL;
- edição e exclusão.

## 4.12 Notícias tributárias

Fontes desejadas:

- Sefaz/RS;
- Receita Federal;
- Ministério da Fazenda;
- Gov.br;
- Planalto;
- Senado;
- Jota;
- Portal Contábeis;
- outras fontes confiáveis.

Comportamento:

- carrossel no rodapé;
- alternância a cada 10 segundos;
- clique abre a notícia;
- mostrar título, fonte e data;
- ocultar notícias expiradas.

Decisão de MVP:

- cadastro manual/curado pelo admin.

Evolução:

- buscar RSS/API quando a fonte oferecer;
- criar job diário/semanal para atualização;
- validar duplicidade e fonte antes de publicar.

## 5. Modelo de dados inicial

Tabelas principais:

- `profiles`: dados públicos internos do usuário, perfil, cargo, status.
- `roles`: perfis do sistema.
- `user_roles`: vínculo entre usuário e perfil.
- `pautas`: espelho normalizado das pautas vindas do Sheets.
- `lembretes`: lembretes criados no HUB.
- `lembrete_usuarios`: usuários marcados em lembretes.
- `anexos`: metadados de arquivos anexados.
- `notificacoes`: notificações internas.
- `tarefas`: tarefas internas do usuário.
- `orientacoes`: orientações da coordenação.
- `links_uteis`: links pessoais e globais.
- `noticias`: notícias do rodapé.
- `audit_logs`: registros de ações sensíveis.
- `integracao_sync_logs`: logs de sincronização com Sheets/Drive/apps externos.

## 6. Integrações previstas

## 6.1 Google Sheets

Finalidade:

- ler pautas da aba `HUB`;
- ler orientações/avaliações de app Coordenação Tributária;
- eventualmente escrever dados de volta.

Itens necessários do usuário:

- link da planilha;
- ID da planilha;
- nomes exatos das abas;
- cabeçalhos das colunas;
- regra de quem pode editar;
- autorização para criar credenciais Google Cloud ou Apps Script.

## 6.2 Google Drive

Finalidade:

- acessar pasta compartilhada;
- exibir arquivos no HUB;
- armazenar ou referenciar anexos.

Itens necessários do usuário:

- link da pasta compartilhada;
- regra de permissão por usuário;
- decisão: anexos ficam no Supabase Storage ou no Google Drive;
- conta Google/Workspace que será dona da integração.

## 6.3 Apps HTML existentes

Apps informados:

- calendário;
- agenda tributária;
- Pomodoro Timer;
- outros que surgirem.

Itens necessários do usuário:

- arquivo `.html`;
- arquivos `.css`, `.js`, imagens e assets relacionados;
- indicação se cada app salva dados em localStorage, planilha, arquivo ou outro lugar;
- descrição do que deve ser mantido exatamente e do que pode ser redesenhado.

Estratégia:

- fase 1: incorporar como módulos internos preservando funcionamento;
- fase 2: refatorar para componentes React integrados ao banco central.

## 6.4 E-mail

Uso:

- avisos de vencimento de lembrete;
- recuperação de senha pelo provedor de autenticação;
- avisos administrativos, se necessário.

Opções:

- Supabase Auth para e-mails de autenticação;
- Gmail API/Google Workspace para envio institucional;
- provedor transacional dedicado, como Resend, SendGrid ou equivalente.

Decisão recomendada:

- autenticação e recuperação de senha pelo Supabase;
- avisos operacionais por provedor transacional ou Gmail Workspace, conforme política da empresa.

## 7. Ambientes

### Desenvolvimento local

Usado para construção e teste antes de publicar.

Itens:

- Node.js;
- projeto React/Vite;
- Supabase local ou projeto Supabase de desenvolvimento;
- variáveis em `.env.local`;
- dados fictícios.

### Homologação

Ambiente para você e usuários-chave testarem.

Itens:

- deploy em URL temporária;
- banco de homologação;
- usuários de teste;
- integrações com planilhas/pastas de teste ou cópias controladas;
- checklist de aprovação.

### Produção

Ambiente final.

Itens:

- domínio/subdomínio definitivo;
- banco de produção;
- variáveis de produção;
- usuários reais;
- backup e política de suporte;
- monitoramento básico.

## 8. Configurações que o usuário deve providenciar

Antes da execução técnica:

- definir nome oficial do HUB;
- confirmar domínio ou subdomínio desejado;
- informar se a empresa usa Google Workspace, Microsoft 365 ou e-mails Gmail avulsos;
- definir lista inicial de usuários;
- definir perfis: admin, gestor, colaborador;
- fornecer os arquivos HTML dos apps existentes;
- fornecer links das planilhas e pastas do Drive;
- confirmar se podemos criar conta/projeto Supabase;
- confirmar se o deploy será Netlify, Vercel ou outro;
- definir identidade visual: logotipo, cores principais e nome da empresa;
- indicar se há exigências internas de LGPD, TI ou segurança.

Para Google Sheets/Drive:

- criar ou liberar acesso a uma conta de serviço/integração;
- manter planilha com cabeçalhos estáveis;
- evitar mesclar células nas abas usadas por API;
- separar planilha de produção e planilha de teste, se possível.

Para domínio/deploy:

- criar conta Netlify/Vercel ou liberar acesso;
- conectar repositório GitHub/GitLab, se aplicável;
- configurar DNS do subdomínio quando chegar a fase de produção;
- cadastrar variáveis de ambiente no painel da hospedagem.

## 9. Configurações técnicas previstas

Variáveis de ambiente esperadas:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `GOOGLE_CLIENT_EMAIL`
- `GOOGLE_PRIVATE_KEY`
- `GOOGLE_SHEETS_ID`
- `GOOGLE_DRIVE_FOLDER_ID`
- `EMAIL_PROVIDER_API_KEY`
- `APP_BASE_URL`

Regras:

- variáveis públicas podem usar prefixo do frontend;
- chaves secretas ficam apenas em funções server-side;
- nenhuma chave sensível deve ser enviada para Git;
- produção e homologação devem usar variáveis separadas.

## 10. Etapas de execução

## Etapa 0 - Preparação do projeto

Objetivo:

- organizar repositório, stack e decisões finais.

Entregas:

- estrutura inicial do projeto;
- documentação base;
- ambiente local funcionando;
- checklist de insumos pendentes.

Critério de aceite:

- app abre localmente;
- projeto compila;
- estrutura de pastas aprovada.

## Etapa 1 - Protótipo navegável

Objetivo:

- criar interface inicial fiel ao desenho.

Entregas:

- tela de login visual;
- layout da home;
- cards de Pautas e Lembretes;
- menu lateral;
- rodapé de notícias;
- rotas dos módulos.

Critério de aceite:

- navegação básica funcionando;
- layout adaptado para desktop;
- identidade visual inicial aplicada.

## Etapa 2 - Autenticação e perfis

Objetivo:

- transformar o protótipo em app restrito.

Entregas:

- login real;
- logout;
- recuperação de senha;
- perfis de usuário;
- proteção de rotas;
- usuário administrador inicial.

Critério de aceite:

- usuário sem login não acessa o HUB;
- admin entra em área administrativa;
- colaborador vê apenas áreas permitidas.

## Etapa 3 - Banco e módulos internos

Objetivo:

- implementar dados reais do HUB.

Entregas:

- lembretes;
- notificações;
- links úteis;
- notícias cadastráveis;
- anexos;
- painel administrativo inicial.

Critério de aceite:

- criar/editar/concluir lembrete;
- marcar usuários;
- anexar arquivo;
- gerar notificação;
- cadastrar notícia e exibir no rodapé.

## Etapa 4 - Integrações com Sheets e Drive

Objetivo:

- conectar dados externos.

Entregas:

- leitura de pautas do Sheets;
- sincronização programada ou sob demanda;
- listagem/link de arquivos do Drive;
- logs de sincronização.

Critério de aceite:

- pauta criada/alterada na planilha aparece no HUB;
- falha de sincronização fica registrada;
- permissões impedem acesso indevido.

## Etapa 5 - Integração dos apps HTML

Objetivo:

- trazer os apps existentes para dentro do HUB.

Entregas:

- módulo Calendário;
- módulo Agenda Tributária;
- módulo Pomodoro Timer;
- ajustes de CSS/JS para coexistirem com o HUB;
- revisão de responsividade.

Critério de aceite:

- cada app abre dentro do HUB;
- scripts não quebram o app principal;
- navegação de volta ao HUB funciona.

## Etapa 6 - E-mails e automações

Objetivo:

- automatizar alertas e rotinas.

Entregas:

- job diário de lembretes a vencer;
- envio de e-mail um dia antes do prazo;
- atualização programada de pautas;
- atualização programada de notícias, se aprovada.

Critério de aceite:

- lembrete de teste gera e-mail correto;
- e-mail não duplica destinatários;
- envio fica registrado.

## Etapa 7 - Homologação

Objetivo:

- validar com usuários reais antes da produção.

Entregas:

- ambiente de homologação;
- massa de dados de teste;
- rodada de testes guiada;
- correções.

Critério de aceite:

- administrador aprova fluxos principais;
- ao menos 2 colaboradores testam login, lembretes, pautas e menu;
- bugs críticos resolvidos.

## Etapa 8 - Produção

Objetivo:

- publicar o HUB para uso da equipe.

Entregas:

- domínio/subdomínio configurado;
- ambiente de produção;
- usuários reais;
- backup/configurações de segurança;
- manual rápido de uso/admin.

Critério de aceite:

- acesso em URL definitiva;
- login real funcionando;
- dados reais integrados;
- plano de suporte definido.

## 11. Rodadas de testes

### Testes funcionais

- login com usuário válido;
- erro com senha inválida;
- recuperação de senha;
- proteção de rota interna;
- criação de lembrete;
- marcação de usuário;
- upload de anexo;
- notificação interna;
- e-mail de vencimento;
- criação de link útil;
- cadastro de notícia;
- clique em notícia;
- leitura de pauta do Sheets;
- abertura de arquivo do Drive;
- abertura dos apps HTML.

### Testes por perfil

- admin acessa tudo;
- gestor acessa módulos de coordenação;
- colaborador não acessa admin;
- colaborador vê apenas registros permitidos;
- usuário desativado não consegue logar.

### Testes de integração

- planilha indisponível;
- aba renomeada;
- coluna ausente;
- arquivo Drive sem permissão;
- e-mail inválido;
- app HTML com script conflitante;
- anexo muito grande.

### Testes de interface

- desktop padrão;
- notebook;
- mobile;
- menu lateral;
- carrossel de notícias;
- textos longos em pautas/lembretes;
- prazos vencidos/próximos.

### Testes de segurança

- tentar acessar rota interna sem login;
- tentar abrir item de outro usuário;
- tentar acessar arquivo sem permissão;
- confirmar que chaves secretas não aparecem no frontend;
- confirmar que senhas não são visíveis ao admin;
- validar políticas de acesso do banco.

## 12. Riscos e decisões pendentes

### Riscos

- planilhas com estrutura instável podem quebrar integrações;
- apps HTML existentes podem precisar de refatoração;
- Google APIs exigem configuração correta de credenciais;
- notícias automáticas podem trazer conteúdo irrelevante;
- anexos grandes podem impactar custo/storage;
- permissões mal definidas podem expor informação interna.

### Decisões pendentes

- Netlify ou Vercel;
- Supabase ou outro backend;
- anexos no Supabase Storage ou Google Drive;
- autenticação por e-mail/senha ou SSO corporativo;
- notícias manual, semiautomática ou automática;
- quais campos exatos existem nas planilhas;
- quais usuários e perfis entram no MVP.

## 13. MVP recomendado

Para primeira versão utilizável:

- login real;
- home com layout do HUB;
- perfis admin/colaborador;
- lembretes com anexos, usuários marcados e notificações;
- links úteis;
- notícias cadastradas manualmente;
- leitura de pautas do Sheets;
- menu com rotas dos apps HTML;
- integração inicial dos apps HTML;
- deploy de homologação.

Fora do MVP, para evolução:

- notícias 100% automáticas;
- escrita bidirecional com Sheets;
- dashboard gerencial avançado;
- auditoria completa;
- integração profunda com Drive;
- SSO corporativo, se não entrar no início;
- relatórios e indicadores.

## 14. Ordem prática para começarmos

1. Você fornece os apps HTML e assets relacionados.
2. Você confirma hospedagem preferida: Netlify ou Vercel.
3. Você confirma backend/autenticação: recomendação inicial é Supabase.
4. Você fornece links/IDs das planilhas e pastas do Drive.
5. Eu crio o projeto base React/Vite/PWA.
6. Eu monto o layout inicial e rotas.
7. Eu adiciono autenticação e banco.
8. Eu implemento módulos internos.
9. Eu integro planilhas/apps HTML.
10. Rodamos homologação, corrigimos e publicamos.

## 15. Referências técnicas oficiais usadas como base

- Netlify Functions: https://docs.netlify.com/build/functions/overview/
- Netlify Scheduled Functions: https://docs.netlify.com/functions/scheduled-functions/
- Netlify Environment Variables: https://docs.netlify.com/build/environment-variables/overview/
- Supabase Auth: https://supabase.com/docs/guides/auth
- Supabase Password Auth: https://supabase.com/docs/guides/auth/passwords
- Google Sheets API values: https://developers.google.com/workspace/sheets/api/guides/values
- Google Sheets append: https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets.values/append
- Google Drive shared drives: https://developers.google.com/workspace/drive/api/guides/about-shareddrives
- Google Drive uploads: https://developers.google.com/drive/api/v3/manage-uploads
- Gmail API sending: https://developers.google.com/workspace/gmail/api/guides/sending
- Microsoft identity platform: https://learn.microsoft.com/en-us/entra/identity-platform/

