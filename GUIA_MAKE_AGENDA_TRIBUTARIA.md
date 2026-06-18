# Guia Make - Agenda Tributaria

Este fluxo atualiza mensalmente o cache da Agenda Tributaria do HUB com dados oficiais da Receita Federal.

## 1. Variavel no Netlify

No projeto `hub-depto-tributario-ht`, acesse:

`Project configuration > Environment variables > Add a variable`

Crie:

- `AGENDA_SYNC_TOKEN`

Valor sugerido: uma frase/token longo, sem espacos, por exemplo `hub-agenda-2026-...`.

Marque como segredo quando o Netlify permitir. Depois de criar a variavel, o proximo deploy passara a disponibilizar o endpoint.

## 2. Patch no Supabase

Rode no SQL Editor do projeto correto do HUB Depto Tributario:

- `supabase/patch_agenda_tributaria_cache.sql`

Projeto correto:

- `https://kgorlrpparhcrprwamlc.supabase.co`

## 3. Cenario no Make

Crie um cenario com:

1. `Scheduler`
   - Frequencia: mensal.
   - Sugestao: dia 25, 08:00.

2. `HTTP > Make a request`
   - Method: `POST`
   - URL:

```text
https://hub-depto-tributario-ht.netlify.app/api/agenda-tributaria?token=SEU_TOKEN
```

   - Headers:

```text
Content-Type: application/json
```

   - Body type: `Raw`
   - Content type: `JSON`
   - Body:

```json
{
  "year": 2026,
  "month": 7,
  "updatedBy": "make"
}
```

No Make, substitua `year` e `month` por variaveis calculadas para o mes que deseja atualizar. Para carregar o mes seguinte, use o mes posterior ao mes de execucao.

## 4. Teste manual

Depois do deploy:

1. Abra no navegador:

```text
https://hub-depto-tributario-ht.netlify.app/api/agenda-tributaria?year=2026&month=6
```

2. O retorno deve conter `dates`.
3. Rode o POST do Make ou pelo botao `Run once`.
4. Abra a Agenda Tributaria no HUB. O mes deve carregar do cache compartilhado.

## 5. Sefaz/RS

O endpoint ja aceita datas complementares no campo `dates`, para quando o cenario do Make incluir uma etapa de coleta/curadoria da Sefaz/RS:

```json
{
  "year": 2026,
  "month": 7,
  "updatedBy": "make",
  "dates": {
    "15": [
      {
        "cat": "sefaz",
        "title": "Vencimento ICMS - conferir calendario Sefaz/RS",
        "periodo": "julho/2026",
        "doc": "Sefaz/RS",
        "base": "Fonte oficial Sefaz/RS",
        "desc": "Obrigacao estadual adicionada pelo cenario Make."
      }
    ]
  }
}
```
