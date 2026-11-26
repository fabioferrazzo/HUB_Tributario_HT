# Registros por e-mail: do WhatsApp ao HUB

Fluxo: quem posta no grupo do WhatsApp encaminha a mensagem (e o contrato) por e-mail, sempre para os dois
endereços: **fiscal@hteixeira.com.br** e **fiscal10.hteixeira@gmail.com**. O script do Google, instalado só na
caixa fiscal10 (que também recebe o fiscal@), lê os e-mails de 5 em 5 minutos e envia ao HUB. O mesmo e-mail
recebido pelos dois endereços é gravado uma vez só (o HUB usa o Message-ID). O HUB identifica o CNPJ, consulta a
Receita (razão social, data de início, sócios, CNAEs, Simples/MEI), grava os anexos e avisa o administrador no sino.

Na aba **Registros**, a equipe completa IE, código no Domínio, contatos (2 telefones e 2 e-mails) e observações.
Só o administrador define o responsável pela apuração. Ao definir:
- a empresa entra na apuração aberta do responsável no Controle de Apuração (linha nova na competência em aberto;
  se não houver período aberto, entra na carteira e aparece no próximo período gerado);
- os telefones e e-mails vão para o cadastro da empresa no Controle de Apuração;
- o responsável recebe notificação no sino e uma mensagem no chat do HUB.

Remetentes autorizados (padrão): societario.hteixeira@gmail.com e carlosreis.hteixeira@gmail.com.

## 1. Banco de dados (uma vez)

1. Abra o Supabase do HUB > menu lateral **SQL Editor** > **New query**.
2. Cole todo o conteúdo de `supabase/patch_registros.sql` e clique em **Run**.
3. O resultado deve terminar em `COMMIT`. Pode rodar de novo sem problema.

## 2. Netlify (uma vez)

1. Gere uma senha longa só para isso (não reutilize nenhuma). No PowerShell do seu PC:
   `[guid]::NewGuid().ToString("N") + [guid]::NewGuid().ToString("N")`
   Copie o resultado (não compartilhe em conversa nem em e-mail).
2. app.netlify.com > site **hub-depto-tributario-ht** > **Site configuration** > **Environment variables** >
   **Add a variable** > **Add a single variable**:
   - Key: `REGISTROS_ENTRADA_TOKEN` · Value: a senha gerada · **Create variable**.
3. Opcionais (mesmo caminho):
   - `REGISTROS_REMETENTES`: e-mails autorizados separados por vírgula (se mudar os remetentes).
   - `REGISTROS_CNPJ_IGNORAR`: CNPJ da própria H. Teixeira (e de quem mais costuma aparecer nos e-mails),
     para não ser confundido com o CNPJ do cliente.
4. **Deploys** > **Trigger deploy** > **Deploy site** (a função só lê a variável após um novo deploy).

## 3. Caixa do Gmail que recebe os registros (uma vez)

Faça logado na conta **fiscal10.hteixeira@gmail.com** (perfil do Chrome fiscal10). Instale só nessa caixa.

1. Abra script.google.com > **Novo projeto**. Renomeie (clique em "Projeto sem título") para `HUB Registros`.
2. Apague o conteúdo do arquivo `Código.gs` e cole todo o conteúdo de `integracoes/registros-gmail/Codigo.gs`.
   Clique no disquete (**Salvar projeto**).
3. Engrenagem à esquerda (**Configurações do projeto**) > role até **Propriedades do script** >
   **Adicionar propriedade do script**:
   - Propriedade `REGISTROS_TOKEN` · Valor: a mesma senha do passo 2.1 > **Salvar propriedades do script**.
   - (Opcional) `REMETENTES` e `HUB_URL`, se forem diferentes do padrão.
4. Volte ao editor (ícone `< >`), escolha a função **instalarGatilho** na lista do topo e clique em **Executar**.
   Na primeira vez o Google pede autorização: **Revisar permissões** > escolha a conta > **Avançado** >
   **Acessar HUB Registros (não seguro)** > **Permitir** (o aviso aparece porque o script é seu, não publicado).
5. Escolha a função **testarConexao** > **Executar**. No **Registro de execução** deve aparecer
   "Conexão OK: o HUB aceitou o token".

Pronto: a cada 5 minutos o script envia os e-mails novos dos remetentes autorizados cujo assunto tenha
**ABERTURA**, **ALTERAÇÃO** ou **CLIENTE NOVO** (os demais e-mails desses remetentes são deixados como estão). Os já enviados ganham o
marcador **HUB-Registrado** no Gmail; se algo falhar, o marcador **HUB-Erro** (o script tenta de novo).

## 4. Como encaminhar do WhatsApp

- Mensagem de texto: toque e segure a mensagem > **⋮** (ou **Mais**) > **Compartilhar** > **Gmail**.
- Documento (contrato social, alteração): abra o documento no WhatsApp > **Compartilhar** > **Gmail**.
- Para: **fiscal@hteixeira.com.br** e **fiscal10.hteixeira@gmail.com**. Assunto começando por **ABERTURA**, **ALTERAÇÃO** ou **CLIENTE NOVO**,
  seguido da razão social e, se houver, do CNPJ. Exemplo: `ALTERAÇÃO - Padaria Serrana Ltda - 11.222.333/0001-81`.

Dicas:
- Dados que o HUB lê do texto (um por linha, no formato "Campo: valor"; também vale "Campo valor" separado por
  vírgula): **Razão social**, **Nome fantasia**, **Código Domínio**, **IE** (ou "Isento"), **Regime** (Simples
  Nacional, Lucro Presumido, Lucro Real, MEI...), **E-mail**, **Telefone** e **Data de início**. Exemplo:
  `Código Domínio: 1234` · `IE: 096/0123456` · `Regime: Simples Nacional` · `E-mail: contato@empresa.com.br`.
  O que vier no e-mail tem preferência sobre a Receita; num registro que já existe, só os campos vazios são
  preenchidos. A assinatura do e-mail é ignorada (só valem campos com rótulo).
- Com CNPJ no assunto ou no texto, o HUB preenche os dados da Receita sozinho. Sem CNPJ (empresa ainda em
  abertura), o registro é criado pela razão social do assunto, com a pendência "CNPJ não identificado".
- E-mail de ALTERAÇÃO vira um item na subaba **Alterações** (aba Registros), ligado ao registro da empresa pelo
  CNPJ, com o que mudou (contrato social, quadro societário, CNAE, endereço, capital...) identificado pelo assunto e
  pelo texto. Se a empresa já tem responsável pela apuração, ele é avisado no sino.
- E-mails de ABERTURA e CLIENTE NOVO ficam na subaba **Registros**, já com telefone e e-mail da Receita.
- Anexos acima de 4 MB no total não vão pelo e-mail automático: anexe pela aba Registros (botão
  "Anexar documento"). O registro anota quais ficaram de fora.
