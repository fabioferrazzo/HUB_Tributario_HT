# Manual operacional rapido - HUB Depto Tributario

Este manual resume a rotina de administracao do HUB sem substituir o checklist de homologacao.

## Rotina diaria

1. Abrir `Configuracoes > Saude operacional do HUB`.
   - Conferir a etiqueta de versao carregada.
   - Conferir se as origens principais estao em Supabase quando esperado.

2. Conferir notificacoes.
   - Abrir o sino do cabecalho.
   - Revisar lembretes vencidos, proximos e pautas criticas.

3. Conferir pautas nativas.
   - Abrir `Pautas`.
   - Revisar mes/ano atual, destaques, anexos e conclusoes.
   - Confirmar se pautas criadas pela Coordenacao aparecem no menu principal.

4. Conferir lembretes e e-mails.
   - Abrir `Configuracoes > Lembretes e e-mails`.
   - Consultar fila.
   - Enfileirar vencimentos, se necessario.
   - Processar pendentes quando a fila estiver validada.

5. Registrar a rodada.
   - Usar `Configuracoes > Checklist funcional`.
   - Marcar cada item como `OK`, `Ajustar`, `Falhou` ou `Pendente`.
   - Copiar o resumo ao final.

## Rotina semanal

1. Usuarios e perfis.
   - Revisar admins, gestores e colaboradores ativos.
   - Desativar acessos que nao devem permanecer.

2. Arquivos.
   - Organizar pastas.
   - Remover duplicados.
   - Conferir documentos relevantes com grifos/comentarios.

3. Coordenacao Tributaria.
   - Revisar colaboradores.
   - Atualizar atividades, lembretes e pautas.
   - Confirmar que anexos de pautas criadas na Coordenacao abrem/baixam no menu `Pautas`.
   - Usar envio manual de pauta/avaliacoes quando necessario.

4. Rodapes.
   - Conferir noticias tributarias.
   - Conferir legislacoes da Reforma Tributaria.

## Antes do deploy final

1. Manter builds do Netlify pausados durante desenvolvimento normal.
2. Rodar localmente:

```powershell
npm.cmd run preflight
npm.cmd run build
```

3. Rodar no Supabase:

```text
supabase/check_hub_status.sql
```

4. Confirmar que o checklist funcional nao possui item `Falhou`.
5. Liberar builds do Netlify apenas para publicar o marco.

## Itens em stand by

- Possivel integracao futura com app substituto externo, se ainda for necessaria. A integracao antiga com Sheets foi retirada do fluxo ativo.
- Evolucao do OCR/conversao automatica de documentos.
