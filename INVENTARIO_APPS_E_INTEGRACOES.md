# Inventario dos apps fornecidos

## Apps copiados para o HUB

| Modulo | Origem | Destino no projeto | Tamanho | Persistencia observada |
|---|---|---:|---:|---|
| Coordenacao Tributaria | `C:\Users\PC\Desktop\-\GPT codex\Artefato avaliacoes_bonificações\app-standalone.html` | `public/apps/coord-tributaria.html` | 228874 bytes | IndexedDB + Google Apps Script configuravel |
| Agenda Tributaria | `C:\Users\PC\Desktop\-\Claude\Agenda Tributaria\index.html` | `public/apps/agenda-tributaria.html` | 73209 bytes | localStorage |
| Pomodoro Timer | `C:\Users\PC\Desktop\-\Gemini\HTML\pomodoro timer\codigo pomodoro v16.html` | `public/apps/pomodoro.html` | 29896 bytes | localStorage |
| Calendar App | `\\htserver\Docs\Depto Fiscal\FÁBIO\Apps\calendário\CalendarApp.html` | `public/apps/calendar.html` | 36676 bytes | IndexedDB |

## Estrategia de integracao adotada nesta primeira rodada

- Os apps foram copiados sem alterar os arquivos originais.
- O HUB abre Agenda Tributaria, Pomodoro e Coordenacao Tributaria em rotas internas com `iframe`.
- O modulo `Tarefas` exibe o `CalendarApp.html` ao lado de uma sidebar propria para listagem de tarefas.
- A sidebar de tarefas ja permite cadastrar titulo, prazo e nomes de anexos em persistencia local.
- Na fase seguinte, a sidebar deve ser ligada ao banco do HUB e aos anexos reais.

## Planilha HUB Tributario

Link recebido:

`https://docs.google.com/spreadsheets/d/1rpAcGBQCmm5KlMX1TMBN-qBL1vaNgy6gn3j_ffjkVsg/edit?pli=1&gid=1705398292#gid=1705398292`

Identificadores:

- Sheet ID: `1rpAcGBQCmm5KlMX1TMBN-qBL1vaNgy6gn3j_ffjkVsg`
- GID da aba recebida: `1705398292`

Teste de leitura CSV:

- URL testada: `https://docs.google.com/spreadsheets/d/1rpAcGBQCmm5KlMX1TMBN-qBL1vaNgy6gn3j_ffjkVsg/export?format=csv&gid=1705398292`
- Resultado: `401 Nao Autorizado`

Conclusao:

- A planilha nao esta liberada para leitura anonima por CSV.
- Para sincronizar as pautas no HUB, ha duas opcoes:
  - liberar visualizacao por link para a planilha ou uma copia de homologacao;
  - configurar Google Cloud/conta de servico e compartilhar a planilha com o e-mail da conta de servico.

## CSV local fornecido

Arquivo recebido:

`C:\Users\PC\Downloads\Hub_Tributario_2026 - HUB.csv`

Destino no projeto:

`public/data/pautas-hub.csv`

Perfil:

- Encoding: UTF-8.
- Separador: virgula.
- Primeira linha: cabecalho real.
- Registros: 30.
- Cabecalhos: `ID`, `Tema`, `Ações`, `Prazo`, `Prioridade`, `Responsável`, `email`, `Pendências/obs`, `Retorno`, `Status`, `Periodicidade`, `Modificado em`, `Concluido em`.
- Status encontrados: 5 `Atrasado`, 4 `Em andamento`, 2 `Concluído`, 1 `Não iniciado`, 18 sem status.

Uso no HUB:

- O dashboard agora tenta carregar primeiro `public/data/pautas-hub.csv`.
- Se o CSV local nao existir, tenta a funcao Netlify de Sheets.
- Se nenhuma fonte responder, usa massa mockada.

## Observacoes por app

### Coordenacao Tributaria

- Titulo interno: `Coordenacao Tributaria | Reunioes, Avaliacoes e Pautas`.
- Usa IndexedDB.
- Tem referencias a Google Apps Script para envio/sincronizacao.
- Deve ser tratado como app legado mais complexo.

### Calendar App

- Usa IndexedDB `CalAppDB`.
- Ja possui eventos, anexos, lembretes, exportacao ICS e atalho para Google Calendar.
- A sidebar de tarefas foi adicionada no HUB ao lado do calendario, sem editar o HTML original.

### Agenda Tributaria

- Usa localStorage.
- Tem manifest PWA inline e fontes externas do Google Fonts.
- Pode ser mantido como modulo isolado inicialmente.

### Pomodoro Timer

- Usa localStorage.
- Usa CDN Tailwind e Phosphor Icons.
- Depende de internet para carregar esses assets externos quando nao estiverem em cache.
