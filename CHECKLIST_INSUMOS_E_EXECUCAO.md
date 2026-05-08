# Checklist de Insumos e Execução - HUB Depto. Tributário

## 1. Decisões iniciais

- [ ] Confirmar nome oficial do HUB.
- [ ] Confirmar domínio/subdomínio desejado.
- [ ] Confirmar hospedagem: Netlify, Vercel ou outra.
- [ ] Confirmar backend/autenticação: recomendação inicial é Supabase.
- [ ] Confirmar se o login será e-mail/senha ou SSO corporativo.
- [ ] Confirmar onde ficarão anexos: Supabase Storage ou Google Drive.
- [ ] Confirmar se notícias serão inicialmente manuais ou automáticas.

## 2. Identidade visual

- [ ] Enviar logotipo da empresa.
- [ ] Enviar cores institucionais, se houver.
- [ ] Enviar preferência de nome exibido no topo.
- [ ] Enviar ícones ou imagens obrigatórias, se houver.

## 3. Usuários e permissões

- [x] Enviar lista inicial de usuários.
- [x] Informar e-mail de cada usuário.
- [x] Informar perfil de cada usuário: admin, gestor ou colaborador.
- [ ] Confirmar administrador inicial: `fiscal10.heixeira@gmail.com`.
- [ ] Informar usuários que devem receber acesso à coordenação.
- [ ] Informar usuários que devem ter acesso a upload/edição de arquivos.

## 4. Apps HTML a integrar

Para cada app:

- [ ] Enviar arquivo `.html`.
- [ ] Enviar arquivos `.css`.
- [ ] Enviar arquivos `.js`.
- [ ] Enviar imagens/assets usados pelo app.
- [ ] Informar se o app usa `localStorage`, planilha, API ou outro armazenamento.
- [ ] Informar se o app pode ser redesenhado ou deve ser mantido visualmente igual.

Apps previstos:

- [ ] Calendário.
- [ ] Agenda Tributária.
- [ ] Pomodoro Timer.
- [ ] Outros apps auxiliares, se houver.

## 5. Google Sheets

- [x] Enviar link do `Sheets HUB Tributário`.
- [x] Informar ID da planilha.
- [ ] Informar nome exato da aba `HUB`.
- [ ] Informar cabeçalhos das colunas da aba `HUB`.
- [ ] Enviar exemplo de pauta preenchida.
- [ ] Enviar link/app da Coordenação Tributária.
- [ ] Informar nome exato da aba de avaliações/orientações.
- [ ] Informar regra de correspondência entre usuário e orientação.
- [ ] Criar cópia de teste da planilha, se possível.
- [ ] Liberar leitura da planilha por link ou configurar conta de serviço Google. O teste CSV retornou `401 Não Autorizado`.
- [x] Fornecer CSV local da aba `HUB` para desenvolvimento inicial.

## 6. Google Drive

- [ ] Enviar link da pasta compartilhada.
- [ ] Informar se a pasta é Meu Drive ou Drive compartilhado.
- [ ] Definir quem pode visualizar.
- [ ] Definir quem pode fazer upload.
- [ ] Definir se anexos de lembretes ficam nessa pasta ou no storage do app.

## 7. E-mail e notificações

- [ ] Confirmar e-mail remetente dos avisos.
- [ ] Confirmar se será usado Gmail/Google Workspace.
- [ ] Confirmar se pode usar provedor transacional externo.
- [ ] Aprovar texto-padrão do e-mail de vencimento.
- [ ] Definir horário do job diário de lembretes.

## 8. Notícias tributárias

- [ ] Confirmar fontes permitidas.
- [ ] Definir se Jota/Portal Contábeis entram desde o MVP.
- [ ] Definir prazo de expiração das notícias.
- [ ] Definir se admin poderá cadastrar notícia manualmente.
- [ ] Definir se notícias automáticas ficam para fase 2.

## 9. Contas e acessos técnicos

- [ ] Criar conta/projeto Supabase.
- [ ] Executar `supabase/schema.sql` no SQL Editor do Supabase.
- [ ] Preencher `VITE_SUPABASE_URL`.
- [ ] Preencher `VITE_SUPABASE_ANON_KEY`.
- [ ] Guardar `SUPABASE_SERVICE_ROLE_KEY` apenas para funcoes server-side.
- [ ] Criar usuarios no Supabase Auth ou validar criacao pelo Admin via Netlify Function.
- [ ] Criar registros correspondentes na tabela `profiles`.
- [ ] Confirmar bucket privado `hub-anexos`.
- [ ] Criar conta/projeto Netlify ou Vercel.
- [ ] Criar repositório GitHub/GitLab, se aplicável.
- [ ] Criar/liberar projeto Google Cloud, se usarmos APIs Google.
- [ ] Liberar acesso às planilhas/pastas para a conta de integração.
- [ ] Separar variáveis de homologação e produção.

## 10. Homologação

- [ ] Definir usuários de teste.
- [ ] Validar login.
- [x] Validar permissões locais de menu por perfil.
- [ ] Validar pautas vindas da planilha.
- [ ] Validar criação de lembretes.
- [ ] Validar marcação de usuários.
- [ ] Validar anexos.
- [ ] Validar notificações internas.
- [ ] Validar e-mail de vencimento.
- [ ] Validar notícias.
- [ ] Validar apps HTML integrados.
- [ ] Aprovar layout desktop.
- [ ] Aprovar layout mobile.

## 11. Produção

- [ ] Confirmar URL definitiva.
- [ ] Configurar DNS.
- [ ] Cadastrar variáveis de produção.
- [ ] Criar usuários reais.
- [ ] Migrar/ativar dados reais.
- [ ] Rodar teste final de login.
- [ ] Rodar teste final de integração.
- [ ] Aprovar entrada em operação.
