import { createZip } from '../backup/zip-store.js';
import { utf8Encode } from '../backup/bytes.js';

const xml = value => String(value ?? '')
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&apos;');

function colName(index) {
  let name = '';
  for (let value = index + 1; value; value = Math.floor((value - 1) / 26)) name = String.fromCharCode(65 + (value - 1) % 26) + name;
  return name;
}
const cents = value => (value || 0) / 100;
const brl = value => `R$ ${cents(value).toLocaleString('pt-BR', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;

const STYLES = Object.freeze({DEFAULT:0, TITLE:1, HEADER:2, CURRENCY:3, INTEGER:4, WARNING:5, SUBHEADER:6, TEXT_WRAP:7, PERCENT:8, TOTAL:9, TOTAL_CURRENCY:10});

function cellXml(value, ref, style = STYLES.DEFAULT, formula = null, cachedValue = null) {
  if (formula) return `<c r="${ref}" s="${style}"><f>${xml(formula)}</f><v>${Number(cachedValue || 0)}</v></c>`;
  if (typeof value === 'number' && Number.isFinite(value)) return `<c r="${ref}" s="${style}" t="n"><v>${value}</v></c>`;
  return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
}

function normalizeRow(row) {
  return row.map(cell => cell && typeof cell === 'object' && !Array.isArray(cell) && Object.hasOwn(cell, 'value') ? cell : {value: cell});
}

function sheetXml({rows, widths = [], freezeRow = 1, autoFilter = null, merges = []}) {
  const normalized = rows.map(normalizeRow);
  let body = '';
  for (let rowIndex = 0; rowIndex < normalized.length; rowIndex += 1) {
    body += `<row r="${rowIndex + 1}">`;
    for (let columnIndex = 0; columnIndex < normalized[rowIndex].length; columnIndex += 1) {
      const cell = normalized[rowIndex][columnIndex];
      const ref = `${colName(columnIndex)}${rowIndex + 1}`;
      body += cellXml(cell.value, ref, cell.style ?? STYLES.DEFAULT, cell.formula, cell.cachedValue);
    }
    body += '</row>';
  }
  const cols = widths.length ? `<cols>${widths.map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`).join('')}</cols>` : '';
  const pane = freezeRow ? `<sheetViews><sheetView workbookViewId="0"><pane ySplit="${freezeRow}" topLeftCell="A${freezeRow + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` : '<sheetViews><sheetView workbookViewId="0"/></sheetViews>';
  const filter = autoFilter ? `<autoFilter ref="${autoFilter}"/>` : '';
  const merged = merges.length ? `<mergeCells count="${merges.length}">${merges.map(ref => `<mergeCell ref="${ref}"/>`).join('')}</mergeCells>` : '';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:${colName(Math.max(0, Math.max(...normalized.map(row => row.length)) - 1))}${Math.max(1, normalized.length)}"/>${pane}${cols}<sheetFormatPr defaultRowHeight="15"/><sheetData>${body}</sheetData>${filter}${merged}<pageMargins left="0.4" right="0.4" top="0.6" bottom="0.6" header="0.2" footer="0.2"/><pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0"/></worksheet>`;
}

function titleRow(title, columns) {
  return [{value:title, style:STYLES.TITLE}, ...Array.from({length: Math.max(0, columns - 1)}, () => ({value:'', style:STYLES.TITLE}))];
}
const headerRow = values => values.map(value => ({value, style:STYLES.HEADER}));
const currency = value => ({value:cents(value), style:STYLES.CURRENCY});
const integer = value => ({value:Number(value || 0), style:STYLES.INTEGER});
const warning = value => ({value, style:STYLES.WARNING});
const wrap = value => ({value, style:STYLES.TEXT_WRAP});
const percent = value => value == null ? '' : ({value:Number(value), style:STYLES.PERCENT});

function totalsRow(label, dataRows, numericColumns, cachedValues, columnCount) {
  const rowNumber = dataRows + 2;
  const output = Array.from({length: columnCount}, () => ({value:'', style:STYLES.TOTAL}));
  output[0] = {value:label, style:STYLES.TOTAL};
  for (const [columnIndex, cached] of numericColumns.map((column, index) => [column, cachedValues[index]])) {
    const letter = colName(columnIndex);
    output[columnIndex] = {value:0, style:STYLES.TOTAL_CURRENCY, formula:`SUM(${letter}2:${letter}${dataRows + 1})`, cachedValue:cents(cached)};
  }
  return {row:output,rowNumber};
}

function taxRows(snapshot) {
  const simulation = snapshot.taxSimulation;
  const profile = snapshot.project.taxProfile || {};
  return [
    ['Regime', simulation.mode],
    ['Tipo de entidade', profile.entityType || ''],
    ['PIS/Cofins', profile.pisCofinsMode || ''],
    ['CNAE principal (opcional)', profile.cnaePrincipal || 'Não informado'],
    ['CNAEs secundários (opcionais)', profile.cnaesSecundarios || 'Não informados'],
    ['Status', simulation.status],
    ['Método da base', simulation.basisMethod || ''],
    ['Base tributária automática (R$)', simulation.taxBaseCents == null ? warning('NÃO CALCULADA') : currency(simulation.taxBaseCents)],
    ['Insumo contábil/fiscal LR para IRPJ/CSLL (R$)', simulation.accountingInputCents == null ? warning('NÃO APLICÁVEL') : currency(simulation.accountingInputCents)],
    ['Rendimento realizado elegível (R$)', currency(simulation.base?.eligibleCents || 0)],
    ['Rendimento por competência elegível (R$)', currency(simulation.base?.lucroRealPeriodIncomeCents || simulation.base?.periodIncomeCents || 0)],
    ['Fallback por rendimento realizado (R$)', currency(simulation.base?.lucroRealRealizedFallbackCents || 0)],
    ['IRRF potencial crédito LP / retenção elegível LR (R$)', currency(simulation.mode === 'LUCRO_PRESUMIDO' ? (simulation.irrfPotentialCreditCents ?? 0) : (simulation.irrfInformativeCents ?? 0))],
    ['IR retido observado, inclusive pendente (R$)', currency(simulation.irrfObservedCents || 0)],
    ['IR retido pendente (R$)', currency(simulation.irrfPendingCents || 0)],
    ['IRPJ básico incremental (R$)', simulation.irpjBasicCents == null ? warning('NÃO CALCULADO') : currency(simulation.irpjBasicCents)],
    ['CSLL incremental (R$)', simulation.csllCents == null ? warning('NÃO CALCULADA') : currency(simulation.csllCents)],
    ['PIS estimado (R$)', simulation.pisCents == null ? warning('NÃO CALCULADO') : currency(simulation.pisCents)],
    ['Cofins estimada (R$)', simulation.cofinsCents == null ? warning('NÃO CALCULADA') : currency(simulation.cofinsCents)],
    ['Totais de informes', 'CONTROLE — NÃO ADITIVOS À BASE'],
    ['CBS/IBS sobre aplicações financeiras', simulation.futureConsumptionTax?.status || 'Até 2026: fora do escopo (PIS/Cofins); a partir de 2027 não incide (LC 214/2025, art. 6º, V)'],
    ...simulation.warnings.map((item,index) => [`Alerta ${index + 1}`, warning(item)]),
  ];
}

export async function createAnalysisXlsx(snapshot) {
  const quarterly = snapshot.quarterly || [];
  const positions = snapshot.positions || [];
  const redemptions = snapshot.redemptions || [];
  const events = snapshot.events || [];
  const documents = snapshot.documents || [];
  const issues = snapshot.issues || [];
  const evidences = snapshot.evidences || [];
  const reportedTotals = snapshot.reportedTotals || [];
  const reviewDecisions = snapshot.reviewDecisions || [];
  const documentLinks = snapshot.documentLinks || [];
  const reconciliations = snapshot.reconciliations || [];
  const quarterClosures = snapshot.quarterClosures || [];
  const metrics = snapshot.metrics || {};
  const summaryRows = [
    titleRow('ANÁLISE DE APLICAÇÕES FINANCEIRAS', 2),
    ['Projeto', snapshot.project.name],
    ['CNPJ', snapshot.project.cnpj || 'Não informado'],
    ['Regime', snapshot.project.taxProfile?.regime || 'Não informado'],
    ['Período', snapshot.quarter || 'Completo'],
    ['Gerado em', snapshot.generatedAt],
    headerRow(['Indicador','Valor (R$)']),
    ['Aplicações', currency(metrics.appliedCents)],
    ['Resgates líquidos', currency(metrics.netRedeemedCents)],
    ['Resgates brutos', currency(metrics.grossRedeemedCents)],
    ['Rendimentos realizados', currency(metrics.realizedIncomeTotalCents)],
    ['Rendimento do período', currency(metrics.periodIncomeCents)],
    ['IR no resgate', currency(metrics.redemptionIrrfCents)],
    ['IR periódico', currency(metrics.periodicIrCents)],
    ['IR efetivo total', currency(metrics.effectiveIrCents)],
    ['IOF', currency(metrics.iofCents)],
    ['Saldo final', currency(metrics.endingBalanceCents)],
    ['Pendências abertas', integer(issues.length)],
    ['Decisões de revisão', integer(reviewDecisions.length)],
    ['Vínculos documentais', integer(documentLinks.length)],
    [],
    [warning('Nota de escopo'), wrap('O relatório não calcula o IRPJ/CSLL global da empresa. Rendimentos pendentes, divergentes ou sem custo histórico não são transformados em base tributária confirmada.')],
  ];

  const quarterHeader = ['Trimestre','Banco','Aplicações (R$)','Resgates líquidos (R$)','Resgates brutos (R$)','Rend. realizado (R$)','Rend. período (R$)','IR resgate (R$)','IR periódico (R$)','IR efetivo (R$)','IOF (R$)','Saldo final (R$)','Pendências'];
  const quarterRows = quarterly.map(row => [row.quarterLabel,row.bankName,currency(row.appliedCents),currency(row.netRedeemedCents),currency(row.grossRedeemedCents),currency(row.realizedIncomeTotalCents),currency(row.periodIncomeCents),currency(row.redemptionIrrfCents),currency(row.periodicIrCents),currency(row.effectiveIrCents),currency(row.iofCents),currency(row.endingBalanceCents),integer(row.pendingCount)]);
  const quarterTotals = totalsRow('TOTAL DOS FLUXOS', quarterRows.length, [2,3,4,5,6,7,8,9,10], [metrics.appliedCents,metrics.netRedeemedCents,metrics.grossRedeemedCents,metrics.realizedIncomeTotalCents,metrics.periodIncomeCents,metrics.redemptionIrrfCents,metrics.periodicIrCents,metrics.effectiveIrCents,metrics.iofCents], quarterHeader.length).row;

  const positionHeader = ['Banco','Produto','Código da aplicação','Vencimento','Família','Data inicial','Data inicial documentada','Principal original (R$)','Saldo inicial (R$)','Base do saldo inicial','Data do saldo inicial','Resgate total em','Aplicado no filtro (R$)','Resgatado líquido (R$)','Rendimento realizado (R$)','Rend. período (R$)','IR resgate (R$)','IR periódico (R$)','IOF (R$)','Saldo final (R$)','Qualidade','Situação'];
  const initialBasisLabel = basis => ({ORIGINAL_PRINCIPAL:'Valor aplicado',FIRST_APPLICATION:'1º aporte registrado',FIRST_DOCUMENT_BALANCE:'Saldo no 1º documento',UNKNOWN:'Não documentado'})[basis] || '';
  const lifecycleCols = row => { const life = row.lifecycle || {}; const ib = life.initialBalance || {}; const fr = life.fullRedemption || {};
    return [life.code || '', life.maturity ? (life.maturity.date || life.maturity.text || '') : '', null, null, null, null, ib.cents == null ? warning('NÃO DOCUMENTADO') : currency(ib.cents), initialBasisLabel(ib.basis), ib.date || '', fr.closed ? (fr.date || 'ENCERRADA') : 'EM ABERTO']; };
  const positionRows = positions.map(row => { const lc = lifecycleCols(row); return [row.bankName,row.name,lc[0],lc[1],row.productFamily,row.openedAt,row.metadata?.openedAtDocumented === false ? 'NÃO' : 'SIM',row.originalPrincipalCents == null ? warning('NÃO DOCUMENTADO') : currency(row.originalPrincipalCents),lc[6],lc[7],lc[8],lc[9],currency(row.appliedCents),currency(row.netRedeemedCents),row.realizedIncomeStatus === 'PENDING' ? warning('PENDENTE') : currency(row.realizedIncomeCents),currency(row.periodIncomeCents),currency(row.redemptionIrrfCents),currency(row.periodicIrCents),currency(row.iofCents),currency(row.endingBalanceCents),row.realizedIncomeStatus,row.status]; });

  const redemptionHeader = ['Data','Trimestre','Banco','Aplicação','Resgate líquido (R$)','IRRF (R$)','IOF (R$)','Resgate bruto (R$)','Rendimento realizado (R$)','Principal recuperado (R$)','Evidência','Documento-fonte','Observação'];
  const redemptionRowsData = redemptions.map(row => [row.occurredAt,row.quarter,row.bankName,row.positionName,currency(row.netAmountCents),currency(row.irrfCents),currency(row.iofCents),currency(row.grossAmountCents),row.evidenceStatus === 'PENDING' ? warning('PENDENTE') : currency(row.realizedIncomeCents),row.principalRecoveryCents ? currency(row.principalRecoveryCents) : warning('NÃO DETERMINADO'),row.evidenceStatus,row.sourceDocumentName,wrap(row.notes)]);
  const redemptionTotals = totalsRow('TOTAL', redemptionRowsData.length, [4,5,6,7,8,9], [metrics.netRedeemedCents,metrics.redemptionIrrfCents,metrics.iofCents,metrics.grossRedeemedCents,metrics.realizedIncomeTotalCents,sumSafe(redemptions.map(row=>row.principalRecoveryCents))], redemptionHeader.length).row;

  const eventHeader = ['Data','Trimestre','Banco','Aplicação','Tipo','Valor (R$)','Líquido (R$)','Bruto (R$)','Evidência','Documento','Observação'];
  const eventRows = events.map(event => [event.occurredAt,event.quarter,event.bankId,event.positionId,event.type,currency(event.amountCents),event.netAmountCents == null ? '' : currency(event.netAmountCents),event.grossAmountCents == null ? '' : currency(event.grossAmountCents),event.evidenceStatus,event.sourceDocumentId || '',wrap(event.notes || '')]);

  const documentRows = documents.map(document => [document.fileName,document.bankName || document.bankId || '',document.kind || '',document.status || '',document.hash || '',document.metadata?.extractionMethod || '',document.metadata?.extractionQuality ?? '',document.metadata?.templateId || '',wrap((document.metadata?.warnings || []).join(' | '))]);
  const issueRows = issues.map(issue => [issue.severity || '',issue.title,wrap(issue.details),issue.documentId || '',issue.positionId || '',issue.status]);
  const evidenceRows = evidences.map(item => [item.documentId || '',item.pageNumber || '',item.lineNumber || '',item.fieldPath || '',String(item.value ?? ''),item.method || '',item.confidence ?? '',item.status || '',wrap(item.snippet || '')]);
  const controlRows = reportedTotals.map(item => [item.quarter || '',item.bankId || '',item.category || '',currency(item.incomeCents),currency(item.irrfCents),item.confidence ?? '',wrap(item.snippet || '')]);
  const reviewRows = reviewDecisions.map(item => [item.decidedAt || item.createdAt || '',item.documentId || '',item.targetType || item.entityType || '',item.targetId || item.entityId || '',item.action || '',item.reviewer || item.decidedBy || 'USUARIO_LOCAL',wrap(item.justification || item.reason || ''),wrap(JSON.stringify(item.before ?? null)),wrap(JSON.stringify(item.after ?? null))]);
  const documentMap = new Map(documents.map(item => [item.id,item.fileName]));
  const positionMap = new Map(positions.map(item => [item.id,item]));
  const linkRows = documentLinks.map(item => [item.createdAt || '',documentMap.get(item.sourceDocumentId) || item.sourceDocumentId || '',item.relation || '',documentMap.get(item.targetDocumentId) || item.targetDocumentId || '',item.status || '',wrap(item.notes || '')]);
  const reconciliationHeader=['Trimestre','Banco','Aplicação','Resgate líquido (R$)','IRRF (R$)','IOF (R$)','Taxas (R$)','Resgate bruto (R$)','Rendimento realizado (R$)','Principal recuperado (R$)','OFX vinculado','Score','Dif. eq. caixa (R$)','Dif. eq. fiscal (R$)','Custo fiscal','Status','Documentos','Justificativas'];
  const reconciliationRows=reconciliations.map(item=>[item.quarter,item.bankId,positionMap.get(item.positionId)?.name||item.positionId,currency(item.amounts?.netCents),currency(item.amounts?.irrfCents),currency(item.amounts?.iofCents),currency(item.amounts?.feeCents),currency(item.amounts?.grossCents),item.costBasisStatus==='PENDING_HISTORICAL_COST'?warning('PENDENTE'):currency(item.amounts?.realizedIncomeCents),item.costBasisStatus?.startsWith('PENDING')?warning('PENDENTE'):currency(item.amounts?.principalRecoveryCents),item.bankTransactionId?'SIM':'NÃO',integer(item.score),currency(item.equations?.grossFromCashDifferenceCents),item.equations?.grossFromFiscalDifferenceCents==null?'N/D':currency(item.equations.grossFromFiscalDifferenceCents),item.costBasisStatus,item.status,wrap((item.sourceDocumentIds||[]).map(id=>documentMap.get(id)||id).join(' | ')),wrap((item.reasons||[]).join(' | '))]);
  const closureHeader=['Trimestre','Revisão','Status','Qualidade','Fechado em','Responsável','SHA-256','Aplicações (R$)','Resgates líquidos (R$)','Resgates brutos (R$)','Rend. realizado (R$)','Rend. período (R$)','IR resgate (R$)','IR periódico (R$)','IR efetivo (R$)','IOF (R$)','Saldo final (R$)','Pendências','Eventos','Conciliações','Controles','Documentos'];
  const closureRows=quarterClosures.map(item=>[item.quarter,integer(item.revision),item.status,item.quality,item.closedAt||'',item.closedBy||'',item.integrityHash||'',currency(item.payload?.metrics?.appliedCents),currency(item.payload?.metrics?.netRedeemedCents),currency(item.payload?.metrics?.grossRedeemedCents),currency(item.payload?.metrics?.realizedIncomeTotalCents),currency(item.payload?.metrics?.periodIncomeCents),currency(item.payload?.metrics?.redemptionIrrfCents),currency(item.payload?.metrics?.periodicIrCents),currency(item.payload?.metrics?.effectiveIrCents),currency(item.payload?.metrics?.iofCents),currency(item.payload?.metrics?.endingBalanceCents),integer(item.payload?.pendingIds?.length||0),integer(item.payload?.eventIds?.length||0),integer(item.payload?.reconciliationIds?.length||0),integer(item.payload?.controlIds?.length||0),integer(item.payload?.documentIds?.length||0)]);

  const fiscalQuarterHeader=['Trimestre','Regime','Status','Base tributária automática (R$)','Insumo contábil/fiscal LR (R$)','IRPJ básico incremental (R$)','CSLL incremental (R$)','PIS estimado (R$)','Cofins estimada (R$)','IR retido elegível (R$)','Valor pendente (R$)','Qtd. pendências','CBS/IBS'];
  const fiscalQuarterRows=(snapshot.fiscalQuarterly||[]).map(item=>[
    item.quarter,item.regime,item.status,
    item.taxBaseCents==null?warning('NÃO CALCULADA'):currency(item.taxBaseCents),
    item.accountingInputCents==null?'':currency(item.accountingInputCents),
    item.irpjBasicCents==null?'':currency(item.irpjBasicCents),
    item.csllCents==null?'':currency(item.csllCents),
    item.pisCents==null?'':currency(item.pisCents),
    item.cofinsCents==null?'':currency(item.cofinsCents),
    currency(item.irrfPotentialCreditCents||0),currency(item.pendingCents||0),integer(item.pendingCount||0),
    item.futureConsumptionTax?.status||'SEM CÁLCULO AUTOMÁTICO'
  ]);
  const fiscalMemoryHeader=['Trimestre','Banco','Aplicação','Família','Tratamento LP','Rend. realizado elegível (R$)','Rend. realizado pendente (R$)','Base LP (R$)','Status LP','Método LR','Insumo contábil/fiscal LR (R$)','Tratamento PIS/Cofins LR','Base PIS/Cofins (R$)','Status LR','Alíquota PIS','Alíquota Cofins','PIS (R$)','Cofins (R$)','IR retido documental elegível (R$)','IRRF potencial crédito LP (R$)','IR retido pendente (R$)','Pendências','Revisão obrigatória','Justificativa'];
  const fiscalMemoryIsLp=snapshot.taxSimulation?.mode==='LUCRO_PRESUMIDO';
  const fiscalMemoryRows=(snapshot.fiscalMemory||[]).map(item=>[
    item.quarter,item.bankName,item.positionName,item.productFamily,fiscalMemoryIsLp?item.lpTreatment:'',
    currency(item.realizedEligibleCents),currency(item.realizedPendingCents),fiscalMemoryIsLp?currency(item.lpTaxBaseCents):'',fiscalMemoryIsLp?item.lpStatus:'',
    fiscalMemoryIsLp?'':item.lrBasisMethod,fiscalMemoryIsLp?'':currency(item.lrAccountingIncomeCents),fiscalMemoryIsLp?'':item.lrPisCofinsTreatment,fiscalMemoryIsLp?'':currency(item.lrPisCofinsBaseCents),fiscalMemoryIsLp?'':item.lrStatus,
    fiscalMemoryIsLp?'':percent(item.pisRate),fiscalMemoryIsLp?'':percent(item.cofinsRate),fiscalMemoryIsLp||item.pisCents==null?'':currency(item.pisCents),fiscalMemoryIsLp||item.cofinsCents==null?'':currency(item.cofinsCents),
    currency(item.irrfEligibleCents),fiscalMemoryIsLp?currency(item.lpIrrfPotentialCreditCents||0):'',currency(item.irrfPendingCents),integer(item.evidencePendingCount||0),item.requiresReview?'SIM':'NÃO',wrap(item.treatmentJustification||'')
  ]);
  const taxSourceHeader=['Escopo','Referência oficial','URL'];
  const taxSourceRows=(snapshot.taxSources||[]).map(item=>[item.scope,item.title,item.url]);

  const sheets = [
    {name:'Resumo', rows:summaryRows, widths:[34,95], freezeRow:0, merges:['A1:B1']},
    {name:'Totalizadores', rows:[headerRow(quarterHeader),...quarterRows,quarterTotals], widths:[13,24,16,19,19,19,18,16,16,16,18,12], freezeRow:1, autoFilter:`A1:L${quarterRows.length + 1}`},
    {name:'Aplicacoes', rows:[headerRow(positionHeader),...positionRows], widths:[24,42,22,14,24,14,17,20,18,22,14,16,20,18,22,18,16,16,18,16,18,18], freezeRow:1, autoFilter:`A1:${colName(positionHeader.length - 1)}${positionRows.length + 1}`},
    {name:'Resgates', rows:[headerRow(redemptionHeader),...redemptionRowsData,redemptionTotals], widths:[14,13,24,40,20,16,14,20,22,22,16,34,65], freezeRow:1, autoFilter:`A1:M${redemptionRowsData.length + 1}`},
    {name:'Eventos', rows:[headerRow(eventHeader),...eventRows], widths:[14,13,22,34,24,17,17,17,16,32,70], freezeRow:1, autoFilter:`A1:K${eventRows.length + 1}`},
    {name:'Documentos', rows:[headerRow(['Arquivo','Banco','Tipo','Status','Hash SHA-256','Método','Confiança','Template','Alertas']),...documentRows], widths:[44,24,28,24,68,22,12,28,80], freezeRow:1, autoFilter:`A1:I${documentRows.length + 1}`},
    {name:'Pendencias', rows:[headerRow(['Severidade','Título','Detalhes','Documento','Aplicação','Status']),...issueRows], widths:[14,34,90,36,36,16], freezeRow:1, autoFilter:`A1:F${issueRows.length + 1}`},
    {name:'Evidencias', rows:[headerRow(['Documento','Página','Linha','Campo','Valor','Método','Confiança','Status','Trecho-fonte']),...evidenceRows], widths:[36,10,10,38,24,22,12,14,100], freezeRow:1, autoFilter:`A1:I${evidenceRows.length + 1}`},
    {name:'Controles informe', rows:[headerRow(['Trimestre','Banco','Categoria','Rendimento informado (R$)','IR informado (R$)','Confiança','Trecho-fonte']),...controlRows], widths:[13,24,24,25,20,12,100], freezeRow:1, autoFilter:`A1:G${controlRows.length + 1}`},
    {name:'Revisoes', rows:[headerRow(['Data/hora','Documento','Tipo-alvo','ID-alvo','Ação','Revisor','Justificativa','Antes','Depois']),...reviewRows], widths:[22,38,18,38,22,18,55,75,75], freezeRow:1, autoFilter:`A1:I${reviewRows.length + 1}`},
    {name:'Vinculos docs', rows:[headerRow(['Data/hora','Documento origem','Relação','Documento destino','Status','Observação']),...linkRows], widths:[22,45,24,45,16,70], freezeRow:1, autoFilter:`A1:F${linkRows.length + 1}`},
    {name:'Conciliacao', rows:[headerRow(reconciliationHeader),...reconciliationRows], widths:[13,22,38,19,15,14,14,19,22,22,14,10,18,18,24,18,60,75], freezeRow:1, autoFilter:`A1:R${reconciliationRows.length + 1}`},
    {name:'Fechamentos', rows:[headerRow(closureHeader),...closureRows], widths:[13,10,16,24,22,20,68,18,20,20,20,18,17,17,17,18,12,12,14,12,12], freezeRow:1, autoFilter:`A1:U${closureRows.length + 1}`},
    {name:'Fiscal trimestral', rows:[headerRow(fiscalQuarterHeader),...fiscalQuarterRows], widths:[13,22,18,24,27,24,20,18,18,22,20,14,28], freezeRow:1, autoFilter:`A1:M${fiscalQuarterRows.length + 1}`},
    {name:'Memoria fiscal', rows:[headerRow(fiscalMemoryHeader),...fiscalMemoryRows], widths:[13,24,42,24,18,25,25,19,22,28,25,25,22,22,16,17,18,18,22,23,22,14,18,65], freezeRow:1, autoFilter:`A1:X${fiscalMemoryRows.length + 1}`},
    {name:'Base normativa', rows:[headerRow(taxSourceHeader),...taxSourceRows], widths:[28,75,110], freezeRow:1, autoFilter:`A1:C${taxSourceRows.length + 1}`},
    {name:'Simulacao', rows:[titleRow('SIMULAÇÃO RESTRITA AOS RENDIMENTOS FINANCEIROS',2),...taxRows(snapshot)], widths:[48,115], freezeRow:0, merges:['A1:B1']},
  ];

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>${sheets.map((_,index)=>`<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`;
  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((sheet,index)=>`<sheet name="${xml(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join('')}</sheets><calcPr calcId="191029" fullCalcOnLoad="1" forceFullCalc="1"/></workbook>`;
  const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_,index)=>`<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`;
  const styles = stylesXml();
  const core = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xml(snapshot.project.name)}</dc:title><dc:creator>H. Teixeira Contabilidade</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString()}</dcterms:created></cp:coreProperties>`;
  const app = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Analista Tributário de Aplicações Financeiras by fff - HT</Application><AppVersion>1.6</AppVersion></Properties>`;
  const entries = [
    {name:'[Content_Types].xml',data:utf8Encode(contentTypes)},
    {name:'_rels/.rels',data:utf8Encode(rootRels)},
    {name:'docProps/core.xml',data:utf8Encode(core)},
    {name:'docProps/app.xml',data:utf8Encode(app)},
    {name:'xl/workbook.xml',data:utf8Encode(workbook)},
    {name:'xl/_rels/workbook.xml.rels',data:utf8Encode(workbookRels)},
    {name:'xl/styles.xml',data:utf8Encode(styles)},
    ...sheets.map((sheet,index)=>({name:`xl/worksheets/sheet${index + 1}.xml`,data:utf8Encode(sheetXml(sheet))})),
  ];
  const bytes = await createZip(entries,{maxTotalBytes:100*1024*1024});
  return new Blob([bytes],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
}

function sumSafe(values) { return values.reduce((total,value)=>total+(value||0),0); }

function stylesXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="2"><numFmt numFmtId="164" formatCode="R$ #,##0.00;[Red](R$ #,##0.00);-"/><numFmt numFmtId="165" formatCode="0.0%"/></numFmts><fonts count="4"><font><sz val="10"/><name val="Aptos"/><family val="2"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="15"/><name val="Aptos Display"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="10"/><name val="Aptos"/></font><font><b/><color rgb="FF9C5700"/><sz val="10"/><name val="Aptos"/></font></fonts><fills count="6"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF0A5961"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FF13818B"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFF1D6"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE6F2F3"/></patternFill></fill></fills><borders count="3"><border><left/><right/><top/><bottom/><diagonal/></border><border><left/><right/><top/><bottom style="thin"><color rgb="FFD7E1E2"/></bottom><diagonal/></border><border><left/><right/><top style="thin"><color rgb="FF0A5961"/></top><bottom style="double"><color rgb="FF0A5961"/></bottom><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="11"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf><xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf><xf numFmtId="0" fontId="3" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="2" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="165" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/><xf numFmtId="0" fontId="2" fillId="5" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/><xf numFmtId="164" fontId="2" fillId="5" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
}
