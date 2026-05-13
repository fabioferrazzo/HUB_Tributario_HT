# Guia de ativacao futura das Tarefas no Supabase

O modulo Tarefas esta funcionando hoje integrado ao app original do calendario, usando `IndexedDB` local do navegador (`CalAppDB/events`). Isso preserva o comportamento validado: criar pelo painel lateral, duplo clique no dia ou botao `+ Novo`.

Para transformar Tarefas em modulo multiusuario real, a base Supabase ja esta preparada e a ponte com o calendario foi adicionada.

## Quando ativar

Ative apenas depois de validar que o patch SQL de Tarefas ja foi executado no Supabase:

```txt
supabase/patch_tarefas.sql
```

Esse patch cria:

- `tarefas`
- `tarefa_usuarios`
- `tarefa_anexos`
- politicas RLS por criador, responsavel, admin e gestor

## Variavel de ativacao

No Netlify, adicione:

```txt
VITE_TAREFAS_SUPABASE=true
```

Depois faca deploy sem cache.

## Comportamento esperado

Com `VITE_TAREFAS_SUPABASE=true`:

- a sidebar passa a listar tarefas do Supabase;
- tarefas criadas na sidebar sao salvas no Supabase e refletidas no calendario;
- tarefas criadas no app original do calendario sao comunicadas ao HUB e gravadas no Supabase;
- admin/gestor veem e gerenciam tarefas permitidas pelas RLS;
- colaborador gerencia tarefas criadas por ele e visualiza tarefas em que foi marcado.

## Cuidado antes de producao

O app original do calendario ainda guarda anexos como base64 local. Para anexos multiusuario definitivos, prefira criar/anexar pela sidebar do HUB, que ja possui caminho para Storage quando Supabase estiver ativo.

Mantenha `VITE_TAREFAS_SUPABASE=false` enquanto o objetivo for apenas usar o calendario local validado.
