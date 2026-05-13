# Reset de senhas provisoriais

## Objetivo

Permitir que o administrador redefina a senha de um usuario ja criado no HUB, sem expor a `SUPABASE_SERVICE_ROLE_KEY` no navegador.

## Como usar no HUB

1. Entre com o usuario administrador.
2. Abra `Configuracoes`.
3. Clique em `Editar` no usuario desejado.
4. Preencha o campo opcional `Nova senha provisoria`.
5. Salve.

Quando esse campo estiver preenchido, o servidor:

- atualiza a senha do usuario no Supabase Auth;
- enfileira um e-mail em `email_outbox`;
- usa a rotina `email-outbox` para envio real quando ela for executada.

## Observacao importante

Enquanto o dominio proprio nao estiver verificado no Resend, mantenha `EMAIL_FORCE_TEST_TO=fiscal10.hteixeira@gmail.com`. Assim, os e-mails reais continuam direcionados ao e-mail de teste homologado.

## Teste recomendado no proximo deploy de marco

1. Editar um usuario de teste.
2. Definir uma senha provisoria com pelo menos 8 caracteres.
3. Confirmar que a tabela `email_outbox` recebeu um registro `usuario_senha`.
4. Executar a funcao `email-outbox` em modo controlado.
5. Confirmar recebimento do e-mail no destino de teste.
6. Fazer login com a nova senha provisoria.
