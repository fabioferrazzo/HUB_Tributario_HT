import { EVIDENCE_STATUS, EVENT_TYPES, REALIZED_EVIDENCE } from './model.js';

export const TAX_REGIMES = Object.freeze({
  LUCRO_PRESUMIDO: 'LUCRO_PRESUMIDO',
  LUCRO_REAL: 'LUCRO_REAL',
});

export const ENTITY_TYPES = Object.freeze({
  GENERAL_NON_FINANCIAL: 'GENERAL_NON_FINANCIAL',
  FINANCIAL_INSTITUTION: 'FINANCIAL_INSTITUTION',
  SPECIAL: 'SPECIAL',
});

export const PIS_COFINS_MODES = Object.freeze({
  NON_CUMULATIVE: 'NON_CUMULATIVE',
  CUMULATIVE: 'CUMULATIVE',
  SPECIAL: 'SPECIAL',
  NOT_APPLICABLE: 'NOT_APPLICABLE',
});

export const TAX_TREATMENTS = Object.freeze({
  DEFAULT: 'DEFAULT',
  EXCLUDE: 'EXCLUDE',
  REVIEW: 'REVIEW',
  ZERO_RATE: 'ZERO_RATE',
  CUSTOM_RATE: 'CUSTOM_RATE',
});

export const DEFAULT_TAX_RATES = Object.freeze({
  irpjBasic: 0.15,
  csllGeneral: 0.09,
  pisFinancialNonCumulative: 0.0065,
  cofinsFinancialNonCumulative: 0.04,
});

export const OFFICIAL_TAX_SOURCES = Object.freeze([
  {
    id: 'RFB_LP_FINANCIAL_INCOME',
    title: 'Receita Federal — Lucro Presumido: rendimentos e ganhos de aplicações financeiras',
    url: 'https://www.gov.br/receitafederal/pt-br/assuntos/orientacao-tributaria/declaracoes-e-demonstrativos/revisao-de-declaracao-malha/pj-parametro-10.004',
    scope: 'LUCRO_PRESUMIDO',
  },
  {
    id: 'RFB_IRPJ',
    title: 'Receita Federal — IRPJ: alíquota básica e adicional',
    url: 'https://www.gov.br/receitafederal/pt-br/assuntos/orientacao-tributaria/tributos/IRPJ',
    scope: 'IRPJ',
  },
  {
    id: 'RFB_CSLL',
    title: 'Receita Federal — CSLL: base e apuração',
    url: 'https://www.gov.br/receitafederal/pt-br/assuntos/orientacao-tributaria/tributos/CSLL',
    scope: 'CSLL',
  },
  {
    id: 'DEC_8426_2015',
    title: 'Decreto nº 8.426/2015 — PIS/Cofins sobre receitas financeiras no regime não cumulativo',
    url: 'https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2015/decreto/d8426.htm',
    scope: 'LUCRO_REAL_PIS_COFINS',
  },
  {
    id: 'RFB_RTC_TRANSITION',
    title: 'Receita Federal — Reforma Tributária do Consumo e transição',
    url: 'https://www.gov.br/receitafederal/pt-br/acesso-a-informacao/acoes-e-programas/programas-e-atividades/reforma-tributaria-do-consumo/entenda',
    scope: 'CBS_IBS',
  },
  {
    id: 'LC_214_2025_COMPILED',
    title: 'Lei Complementar nº 214/2025 compilada — IBS/CBS e serviços financeiros',
    url: 'https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp214compilado.htm',
    scope: 'CBS_IBS',
  },
]);

const ELIGIBLE_EVIDENCE = new Set([
  EVIDENCE_STATUS.CONFIRMED,
  EVIDENCE_STATUS.RECONCILED,
]);
const ACTIVE_IR_TYPES = new Set([EVENT_TYPES.REDEMPTION_IRRF, EVENT_TYPES.PERIODIC_IR]);
const ACTIVE_INCOME_TYPES = new Set([EVENT_TYPES.PERIOD_INCOME, EVENT_TYPES.REALIZED_INCOME]);
const sum = values => values.reduce((acc, value) => acc + (value || 0), 0);

function activeEvent(event) {
  return event?.metadata?.reviewDisposition !== 'REJECTED' && event?.metadata?.excludedFromAnalysis !== true;
}

export function isTaxEligibleEvent(event) {
  if (!activeEvent(event)) return false;
  return ELIGIBLE_EVIDENCE.has(event.evidenceStatus)
    || (event.evidenceStatus === EVIDENCE_STATUS.RECONSTRUCTED && event.metadata?.approvedForTaxSimulation === true);
}

function normalizeRate(value) {
  if (value === '' || value == null) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) return null;
  return parsed;
}

function normalizePositionTreatment(value = {}, index = 0) {
  const lpTreatment = [TAX_TREATMENTS.DEFAULT, TAX_TREATMENTS.EXCLUDE, TAX_TREATMENTS.REVIEW].includes(value.lpTreatment)
    ? value.lpTreatment : TAX_TREATMENTS.DEFAULT;
  const lrPisCofinsTreatment = Object.values(TAX_TREATMENTS).includes(value.lrPisCofinsTreatment)
    ? value.lrPisCofinsTreatment : TAX_TREATMENTS.DEFAULT;
  return {
    id: String(value.id || `tax-rule-${index + 1}`).slice(0, 100),
    positionId: String(value.positionId || '').slice(0, 180),
    lpTreatment,
    lrPisCofinsTreatment,
    pisRateOverride: normalizeRate(value.pisRateOverride),
    cofinsRateOverride: normalizeRate(value.cofinsRateOverride),
    justification: String(value.justification || '').trim().slice(0, 1500),
    updatedAt: value.updatedAt || null,
  };
}

export function normalizeTaxProfile(profile = {}) {
  const regime = Object.values(TAX_REGIMES).includes(profile.regime)
    ? profile.regime
    : TAX_REGIMES.LUCRO_PRESUMIDO;
  const entityType = Object.values(ENTITY_TYPES).includes(profile.entityType)
    ? profile.entityType
    : ENTITY_TYPES.GENERAL_NON_FINANCIAL;
  let pisCofinsMode = Object.values(PIS_COFINS_MODES).includes(profile.pisCofinsMode)
    ? profile.pisCofinsMode
    : null;
  if (!pisCofinsMode) {
    pisCofinsMode = regime === TAX_REGIMES.LUCRO_REAL
      ? PIS_COFINS_MODES.NON_CUMULATIVE
      : PIS_COFINS_MODES.NOT_APPLICABLE;
  }
  const taxYearRaw = Number(profile.taxYear);
  const taxYear = Number.isInteger(taxYearRaw) && taxYearRaw >= 2000 && taxYearRaw <= 2200
    ? taxYearRaw
    : null;
  const positionTreatments = (Array.isArray(profile.positionTreatments) ? profile.positionTreatments : [])
    .map(normalizePositionTreatment)
    .filter(rule => rule.positionId)
    .slice(0, 500);
  return {
    regime,
    entityType,
    pisCofinsMode,
    taxYear,
    cnaePrincipal: String(profile.cnaePrincipal || '').trim().slice(0, 20),
    cnaesSecundarios: String(profile.cnaesSecundarios || '').trim().slice(0, 500),
    notes: String(profile.notes || '').trim().slice(0, 1000),
    positionTreatments,
    futureConsumptionTaxMode: 'REVIEW_ONLY',
  };
}

export function validateTaxProfile(profile) {
  const value = normalizeTaxProfile(profile);
  if (value.regime === TAX_REGIMES.LUCRO_REAL && value.pisCofinsMode === PIS_COFINS_MODES.NOT_APPLICABLE) {
    throw new TypeError('Lucro Real requires a PIS/Cofins treatment selection');
  }
  for (const rule of value.positionTreatments) {
    if (rule.lrPisCofinsTreatment === TAX_TREATMENTS.CUSTOM_RATE && (rule.pisRateOverride == null || rule.cofinsRateOverride == null)) {
      throw new TypeError(`Custom PIS/Cofins treatment requires both rates for position ${rule.positionId}`);
    }
  }
  return value;
}

function selectedEvents(events, quarter) {
  return (events || []).filter(event => activeEvent(event) && (!quarter || event.quarter === quarter));
}

function treatmentFor(profile, positionId) {
  return profile.positionTreatments.find(rule => rule.positionId === positionId) || normalizePositionTreatment({positionId});
}

function eventEvidenceSummary(events) {
  const pending = events.filter(event => !isTaxEligibleEvent(event));
  return {
    pendingCount: pending.length,
    pendingCents: sum(pending.map(event => event.amountCents)),
    divergentCount: pending.filter(event => event.evidenceStatus === EVIDENCE_STATUS.DIVERGENT).length,
    reconstructedUnapprovedCount: pending.filter(event => event.evidenceStatus === EVIDENCE_STATUS.RECONSTRUCTED).length,
  };
}

function positionEvents(events, positionId) {
  return events.filter(event => event.positionId === positionId);
}

function selectLucroRealIncome(events) {
  const income = events.filter(event => ACTIVE_INCOME_TYPES.has(event.type));
  const periodAll = income.filter(event => event.type === EVENT_TYPES.PERIOD_INCOME);
  const realizedAll = income.filter(event => event.type === EVENT_TYPES.REALIZED_INCOME);
  const period = periodAll.filter(isTaxEligibleEvent);
  const realized = realizedAll.filter(isTaxEligibleEvent);
  const usePeriod = period.length > 0;
  const selected = usePeriod ? period : realized;
  return {
    basisCents: sum(selected.map(event => event.amountCents)),
    method: usePeriod ? 'PERIOD_INCOME' : realized.length ? 'REALIZED_INCOME_FALLBACK' : 'NO_ELIGIBLE_INCOME',
    eligiblePeriodCents: sum(period.map(event => event.amountCents)),
    eligibleRealizedCents: sum(realized.map(event => event.amountCents)),
    evidence: eventEvidenceSummary([...periodAll, ...realizedAll]),
  };
}

function positionLabel(position, positionId) {
  return position?.name || position?.externalReference || positionId || 'Sem aplicação';
}

export function buildFiscalMemory({events = [], positions = [], banks = [], profile = {}, quarter}) {
  const taxProfile = validateTaxProfile(profile);
  if (!quarter) return [];
  const selected = selectedEvents(events, quarter);
  const positionMap = new Map((positions || []).map(position => [position.id, position]));
  const bankMap = new Map((banks || []).map(bank => [bank.id, bank.name]));
  const ids = [...new Set([...selected.map(event => event.positionId), ...(positions || []).map(position => position.id)].filter(Boolean))];
  const rows = [];
  for (const positionId of ids) {
    const eventsAtPosition = positionEvents(selected, positionId);
    if (!eventsAtPosition.length) continue;
    const position = positionMap.get(positionId);
    const bankId = position?.bankId || eventsAtPosition.find(event => event.bankId)?.bankId || '';
    const rule = treatmentFor(taxProfile, positionId);
    const realizedAll = eventsAtPosition.filter(event => event.type === EVENT_TYPES.REALIZED_INCOME);
    const realizedEligible = realizedAll.filter(isTaxEligibleEvent);
    const realizedEvidence = eventEvidenceSummary(realizedAll);
    const hasRedemption = eventsAtPosition.some(event => event.type === EVENT_TYPES.REDEMPTION);
    const missingRealizedIncome = hasRedemption && realizedAll.length === 0 && position?.realizedIncomeStatus === EVIDENCE_STATUS.PENDING;
    const lrSelection = selectLucroRealIncome(eventsAtPosition);
    const irEvents = eventsAtPosition.filter(event => ACTIVE_IR_TYPES.has(event.type));
    const eligibleIr = irEvents.filter(isTaxEligibleEvent);
    const pendingIr = irEvents.filter(event => !isTaxEligibleEvent(event));
    const pendingEvidenceIds = new Set([
      ...realizedAll.filter(event => !isTaxEligibleEvent(event)).map(event => event.id || event),
      ...eventsAtPosition.filter(event => event.type === EVENT_TYPES.PERIOD_INCOME && !isTaxEligibleEvent(event)).map(event => event.id || event),
      ...pendingIr.map(event => event.id || event),
    ]);
    let lpTaxBaseCents = sum(realizedEligible.map(event => event.amountCents));
    let lpStatus = 'DEFAULT';
    if (missingRealizedIncome) lpStatus = 'PENDING_REALIZED_INCOME';
    if (rule.lpTreatment === TAX_TREATMENTS.EXCLUDE) { lpTaxBaseCents = 0; lpStatus = 'EXCLUDED_BY_RULE'; }
    if (rule.lpTreatment === TAX_TREATMENTS.REVIEW) { lpTaxBaseCents = 0; lpStatus = 'REQUIRES_REVIEW'; }

    let lrPisCofinsBaseCents = lrSelection.basisCents;
    let pisRate = DEFAULT_TAX_RATES.pisFinancialNonCumulative;
    let cofinsRate = DEFAULT_TAX_RATES.cofinsFinancialNonCumulative;
    let lrStatus = 'DEFAULT';
    if (rule.lrPisCofinsTreatment === TAX_TREATMENTS.EXCLUDE) {
      lrPisCofinsBaseCents = 0; pisRate = 0; cofinsRate = 0; lrStatus = 'EXCLUDED_BY_RULE';
    } else if (rule.lrPisCofinsTreatment === TAX_TREATMENTS.ZERO_RATE) {
      pisRate = 0; cofinsRate = 0; lrStatus = 'ZERO_RATE_BY_RULE';
    } else if (rule.lrPisCofinsTreatment === TAX_TREATMENTS.CUSTOM_RATE) {
      pisRate = rule.pisRateOverride ?? 0;
      cofinsRate = rule.cofinsRateOverride ?? 0;
      lrStatus = 'CUSTOM_RATE_BY_RULE';
    } else if (rule.lrPisCofinsTreatment === TAX_TREATMENTS.REVIEW) {
      lrPisCofinsBaseCents = 0; pisRate = null; cofinsRate = null; lrStatus = 'REQUIRES_REVIEW';
    }
    if (taxProfile.regime === TAX_REGIMES.LUCRO_REAL
      && taxProfile.pisCofinsMode !== PIS_COFINS_MODES.NON_CUMULATIVE
      && rule.lrPisCofinsTreatment === TAX_TREATMENTS.DEFAULT) {
      lrPisCofinsBaseCents = 0; pisRate = null; cofinsRate = null; lrStatus = 'REQUIRES_REVIEW';
    }

    const irrfDocumentaryEligibleCents = sum(eligibleIr.map(event => event.amountCents));
    const lpIrrfPotentialCreditCents = taxProfile.regime === TAX_REGIMES.LUCRO_PRESUMIDO
      && lpStatus === 'DEFAULT'
      && lpTaxBaseCents > 0
      && realizedEvidence.pendingCount === 0
      && !missingRealizedIncome
      ? irrfDocumentaryEligibleCents
      : 0;

    rows.push({
      quarter,
      positionId,
      positionName: positionLabel(position, positionId),
      productFamily: position?.productFamily || '',
      bankId,
      bankName: bankMap.get(bankId) || bankId,
      lpTreatment: rule.lpTreatment,
      lrPisCofinsTreatment: rule.lrPisCofinsTreatment,
      treatmentJustification: rule.justification,
      realizedEligibleCents: sum(realizedEligible.map(event => event.amountCents)),
      realizedPendingCents: realizedEvidence.pendingCents,
      realizedPendingCount: realizedEvidence.pendingCount,
      realizedDivergentCount: realizedEvidence.divergentCount,
      missingRealizedIncome,
      lpTaxBaseCents,
      lpStatus,
      lrAccountingIncomeCents: lrSelection.basisCents,
      lrBasisMethod: lrSelection.method,
      lrPisCofinsBaseCents,
      lrStatus,
      pisRate,
      cofinsRate,
      pisCents: pisRate == null ? null : Math.round(lrPisCofinsBaseCents * pisRate),
      cofinsCents: cofinsRate == null ? null : Math.round(lrPisCofinsBaseCents * cofinsRate),
      irrfEligibleCents: irrfDocumentaryEligibleCents,
      lpIrrfPotentialCreditCents,
      irrfPendingCents: sum(pendingIr.map(event => event.amountCents)),
      irrfPendingCount: pendingIr.length,
      evidencePendingCount: pendingEvidenceIds.size + (taxProfile.regime === TAX_REGIMES.LUCRO_PRESUMIDO && missingRealizedIncome ? 1 : 0),
      requiresReview: lpStatus === 'REQUIRES_REVIEW' || lrStatus === 'REQUIRES_REVIEW' || (taxProfile.regime === TAX_REGIMES.LUCRO_PRESUMIDO && missingRealizedIncome) || realizedEvidence.divergentCount > 0 || lrSelection.evidence.divergentCount > 0,
    });
  }
  return rows.sort((a, b) => String(a.bankName).localeCompare(String(b.bankName), 'pt-BR') || String(a.positionName).localeCompare(String(b.positionName), 'pt-BR'));
}

export function simulationBase(events, quarter = null) {
  const selected = selectedEvents(events, quarter);
  const realized = selected.filter(event => event.type === EVENT_TYPES.REALIZED_INCOME);
  const confirmed = realized.filter(event => [EVIDENCE_STATUS.CONFIRMED, EVIDENCE_STATUS.RECONCILED].includes(event.evidenceStatus));
  const reconstructed = realized.filter(event => event.evidenceStatus === EVIDENCE_STATUS.RECONSTRUCTED);
  const periodEvents = selected.filter(event => event.type === EVENT_TYPES.PERIOD_INCOME);
  const eligiblePeriodEvents = periodEvents.filter(isTaxEligibleEvent);
  const pendingPeriodEvents = periodEvents.filter(event => !isTaxEligibleEvent(event));
  const byPosition = new Map();
  for (const event of selected.filter(event => ACTIVE_INCOME_TYPES.has(event.type))) {
    const key = event.positionId || `unlinked:${event.bankId || 'unknown'}`;
    if (!byPosition.has(key)) byPosition.set(key, []);
    byPosition.get(key).push(event);
  }
  let lucroRealFinancialRevenueCents = 0;
  let lucroRealPeriodIncomeCents = 0;
  let lucroRealRealizedFallbackCents = 0;
  let lucroRealPositionsUsingPeriod = 0;
  let lucroRealPositionsUsingFallback = 0;
  let lucroRealPendingCount = 0;
  let lucroRealPendingCents = 0;
  for (const positionSet of byPosition.values()) {
    const selectedIncome = selectLucroRealIncome(positionSet);
    lucroRealFinancialRevenueCents += selectedIncome.basisCents;
    if (selectedIncome.method === 'PERIOD_INCOME') { lucroRealPeriodIncomeCents += selectedIncome.basisCents; lucroRealPositionsUsingPeriod += 1; }
    if (selectedIncome.method === 'REALIZED_INCOME_FALLBACK') { lucroRealRealizedFallbackCents += selectedIncome.basisCents; lucroRealPositionsUsingFallback += 1; }
    lucroRealPendingCount += selectedIncome.evidence.pendingCount;
    lucroRealPendingCents += selectedIncome.evidence.pendingCents;
  }
  const irEvents = selected.filter(event => ACTIVE_IR_TYPES.has(event.type));
  return {
    confirmedCents: sum(confirmed.map(event => event.amountCents)),
    reconstructedCents: sum(reconstructed.map(event => event.amountCents)),
    eligibleCents: sum(realized.filter(isTaxEligibleEvent).map(event => event.amountCents)),
    pendingCents: sum(realized.filter(event => !isTaxEligibleEvent(event)).map(event => event.amountCents)),
    pendingCount: realized.filter(event => !isTaxEligibleEvent(event)).length,
    irrfCents: sum(irEvents.filter(isTaxEligibleEvent).map(event => event.amountCents)),
    irrfObservedCents: sum(irEvents.map(event => event.amountCents)),
    irrfPendingCents: sum(irEvents.filter(event => !isTaxEligibleEvent(event)).map(event => event.amountCents)),
    periodIncomeCents: sum(eligiblePeriodEvents.map(event => event.amountCents)),
    pendingPeriodIncomeCents: sum(pendingPeriodEvents.map(event => event.amountCents)),
    pendingPeriodIncomeCount: pendingPeriodEvents.length,
    lucroRealFinancialRevenueCents,
    lucroRealPeriodIncomeCents,
    lucroRealRealizedFallbackCents,
    lucroRealPositionsUsingPeriod,
    lucroRealPositionsUsingFallback,
    lucroRealPendingCount,
    lucroRealPendingCents,
  };
}

function commonResult({quarter, taxProfile, base, memory}) {
  return {
    quarter,
    profile: taxProfile,
    base,
    memory,
    generatedAt: new Date().toISOString(),
    scope: 'FINANCIAL_APPLICATIONS_ONLY',
    irrfInformativeCents: base.irrfCents,
    irrfObservedCents: base.irrfObservedCents,
    irrfPendingCents: base.irrfPendingCents,
    officialSources: OFFICIAL_TAX_SOURCES,
    reportedTotalsTreatment: 'CONTROL_ONLY_NOT_ADDITIVE',
  };
}

export function simulateFinancialTaxes({events, positions = [], banks = [], profile, quarter = null}) {
  const taxProfile = validateTaxProfile(profile);
  const eventQuarters = [...new Set((events || []).map(event => event.quarter).filter(Boolean))].sort();
  const effectiveQuarter = quarter || (eventQuarters.length === 1 ? eventQuarters[0] : null);
  const inferredTaxYear = effectiveQuarter ? Number(effectiveQuarter.slice(0, 4)) : taxProfile.taxYear;
  const effectiveProfile = {...taxProfile, taxYear: inferredTaxYear || taxProfile.taxYear || null};
  const base = simulationBase(events, quarter);
  const memory = effectiveQuarter ? buildFiscalMemory({events, positions, banks, profile:effectiveProfile, quarter:effectiveQuarter}) : [];
  const warnings = [];
  const common = commonResult({quarter:effectiveQuarter, taxProfile: effectiveProfile, base, memory});

  if (!quarter && eventQuarters.length > 1) {
    warnings.push('Selecione um trimestre para a simulação tributária. A consolidação financeira pode abranger vários períodos, mas os tributos não são somados em uma única apuração multitrimestral.');
    return {...common, mode: taxProfile.regime, status: 'REQUIRES_QUARTER', taxBaseCents: null, irpjBasicCents: null, csllCents: null, pisCents: null, cofinsCents: null, warnings};
  }

  const futureConsumptionTax = effectiveProfile.taxYear != null && effectiveProfile.taxYear >= 2027;
  if (futureConsumptionTax) warnings.push(effectiveProfile.entityType === ENTITY_TYPES.GENERAL_NON_FINANCIAL
    ? 'A partir de 2027, PIS e Cofins deixam de existir (LC 214/2025, art. 542) e CBS/IBS não incidem sobre rendimentos financeiros (LC 214/2025, art. 6º, V). IRPJ e CSLL continuam.'
    : 'A partir de 2027, PIS e Cofins deixam de existir (LC 214/2025, art. 542). Instituição financeira ou entidade especial: os rendimentos podem entrar no regime específico de serviços financeiros da CBS/IBS (LC 214/2025, art. 6º, V) — revisão manual.');

  const reviewRows = memory.filter(row => row.requiresReview);
  const pendingRows = memory.filter(row => row.evidencePendingCount > 0 || row.irrfPendingCount > 0);

  if (effectiveProfile.regime === TAX_REGIMES.LUCRO_PRESUMIDO) {
    if (effectiveProfile.entityType !== ENTITY_TYPES.GENERAL_NON_FINANCIAL) {
      warnings.push('Entidade financeira ou especial: as regras gerais de IRPJ e CSLL desta versão não devem ser aplicadas automaticamente.');
      return {...common, mode: 'LUCRO_PRESUMIDO', status: 'REQUIRES_REVIEW', taxBaseCents: null, csllCents: null, irpjBasicCents: null, warnings};
    }
    const taxBaseCents = memory.length ? sum(memory.map(row => row.lpTaxBaseCents)) : base.eligibleCents;
    const hasRuleReview = memory.some(row => row.lpStatus === 'REQUIRES_REVIEW');
    const pendingCount = base.pendingCount + (base.irrfPendingCents ? 1 : 0);
    if (base.pendingCount || base.irrfPendingCents) warnings.push('Rendimentos ou retenções pendentes, divergentes ou reconstruídos sem aprovação explícita foram excluídos da memória tributária.');
    if (hasRuleReview) warnings.push('Há aplicação com tratamento tributário marcado para revisão manual; sua base foi excluída da simulação automática.');
    if (memory.some(row => row.lpStatus === 'PENDING_REALIZED_INCOME')) warnings.push('Há resgate em aplicação cujo rendimento realizado não pôde ser individualizado documentalmente; o valor permanece fora da base automática até revisão/custo histórico suficiente.');
    if (memory.some(row => row.lpTreatment === TAX_TREATMENTS.EXCLUDE)) warnings.push('Há aplicação excluída da base de Lucro Presumido por regra configurada pelo usuário; confira a justificativa antes do fechamento fiscal.');
    warnings.push('O adicional de IRPJ e o IRPJ total da empresa não são calculados, pois dependem da base global do trimestre.');
    const linkedCreditCents = memory.length ? sum(memory.map(row => row.lpIrrfPotentialCreditCents || 0)) : base.irrfCents;
    if (linkedCreditCents < base.irrfCents) warnings.push('Parte do IRRF documental não foi classificada como crédito potencial automático porque o respectivo rendimento/base da aplicação está pendente, excluído ou em revisão. A retenção continua visível para conferência externa.');
    warnings.push('O IRRF vinculado a rendimentos incluídos na base automática é apresentado apenas como crédito potencial para a apuração externa; o app não calcula saldo final de IRPJ ou DARF.');
    return {
      ...common,
      mode: 'LUCRO_PRESUMIDO',
      status: reviewRows.length ? 'PARTIAL' : pendingRows.length || pendingCount ? 'PARTIAL' : 'READY',
      taxBaseCents,
      basisMethod: 'REALIZED_INCOME_ELIGIBLE_BY_POSITION',
      irpjBasicRate: DEFAULT_TAX_RATES.irpjBasic,
      irpjBasicCents: Math.round(taxBaseCents * DEFAULT_TAX_RATES.irpjBasic),
      csllRate: DEFAULT_TAX_RATES.csllGeneral,
      csllCents: Math.round(taxBaseCents * DEFAULT_TAX_RATES.csllGeneral),
      irrfPotentialCreditCents: memory.length ? sum(memory.map(row => row.lpIrrfPotentialCreditCents || 0)) : base.irrfCents,
      warnings,
    };
  }

  warnings.push('IRPJ e CSLL do Lucro Real não são calculados isoladamente: a receita financeira elegível é exportada como insumo da apuração contábil e fiscal global da empresa.');
  const accountingInputCents = memory.length ? sum(memory.map(row => row.lrAccountingIncomeCents)) : base.lucroRealFinancialRevenueCents;
  const pisCofinsBaseCents = memory.length ? sum(memory.map(row => row.lrPisCofinsBaseCents)) : base.lucroRealFinancialRevenueCents;
  if (pendingRows.length || base.lucroRealPendingCount || base.pendingPeriodIncomeCount) warnings.push('Receitas ou retenções pendentes/divergentes foram excluídas da base automática e permanecem na memória para revisão.');
  if (memory.some(row => row.lrBasisMethod === 'REALIZED_INCOME_FALLBACK') || base.lucroRealPositionsUsingFallback) warnings.push('Para aplicações sem série de rendimento por competência, o app utilizou rendimento realizado elegível como fallback documental, sem somá-lo novamente quando existe PERIOD_INCOME.');
  if (memory.some(row => row.lrStatus === 'EXCLUDED_BY_RULE')) warnings.push('Há aplicação excluída de PIS/Cofins por regra configurada pelo usuário; o rendimento continua demonstrado como insumo contábil de IRPJ/CSLL.');
  if (memory.some(row => row.lrStatus === 'ZERO_RATE_BY_RULE' || row.lrStatus === 'CUSTOM_RATE_BY_RULE')) warnings.push('Há aplicação com tratamento especial de PIS/Cofins definido pelo usuário. Revise a justificativa e a base normativa externa.');

  if (futureConsumptionTax) {
    if (effectiveProfile.entityType !== ENTITY_TYPES.GENERAL_NON_FINANCIAL) {
      return {
        ...common,
        mode: 'LUCRO_REAL',
        status: 'REQUIRES_REVIEW',
        taxBaseCents: pisCofinsBaseCents,
        accountingInputCents,
        basisMethod: 'PERIOD_INCOME_BY_POSITION_WITH_REALIZED_FALLBACK',
        pisCents: null,
        cofinsCents: null,
        futureConsumptionTax: {system:'CBS_IBS',status:'REVISÃO — SERVIÇOS FINANCEIROS',reviewRequired:true},
        warnings,
      };
    }
    return {
      ...common,
      mode: 'LUCRO_REAL',
      status: reviewRows.length || pendingRows.length || base.lucroRealPendingCount || base.pendingPeriodIncomeCount ? 'PARTIAL' : 'READY',
      taxBaseCents: pisCofinsBaseCents,
      accountingInputCents,
      basisMethod: 'PERIOD_INCOME_BY_POSITION_WITH_REALIZED_FALLBACK',
      pisRate: 0,
      pisCents: 0,
      cofinsRate: 0,
      cofinsCents: 0,
      futureConsumptionTax: {system:'CBS_IBS',status:'NÃO INCIDE (LC 214/2025, art. 6º, V)',reviewRequired:false,legalBasis:'LC 214/2025, arts. 6º, V, e 542'},
      warnings,
    };
  }

  const explicitTreatment = memory.some(row => [TAX_TREATMENTS.ZERO_RATE,TAX_TREATMENTS.CUSTOM_RATE,TAX_TREATMENTS.EXCLUDE].includes(row.lrPisCofinsTreatment));
  if (effectiveProfile.pisCofinsMode !== PIS_COFINS_MODES.NON_CUMULATIVE && !explicitTreatment) {
    warnings.push('O tratamento selecionado não permite aplicar automaticamente as alíquotas gerais de receitas financeiras do regime não cumulativo.');
    return {
      ...common,
      mode: 'LUCRO_REAL',
      status: 'REQUIRES_REVIEW',
      taxBaseCents: pisCofinsBaseCents,
      accountingInputCents,
      basisMethod: 'PERIOD_INCOME_BY_POSITION_WITH_REALIZED_FALLBACK',
      pisCents: null,
      cofinsCents: null,
      warnings,
    };
  }

  if (memory.some(row => row.lrStatus === 'REQUIRES_REVIEW')) {
    warnings.push('Há aplicação marcada para revisão de PIS/Cofins; ela foi excluída da base automática.');
  }
  const pisCents = memory.length
    ? sum(memory.map(row => row.pisCents == null ? 0 : row.pisCents))
    : Math.round(pisCofinsBaseCents * DEFAULT_TAX_RATES.pisFinancialNonCumulative);
  const cofinsCents = memory.length
    ? sum(memory.map(row => row.cofinsCents == null ? 0 : row.cofinsCents))
    : Math.round(pisCofinsBaseCents * DEFAULT_TAX_RATES.cofinsFinancialNonCumulative);
  return {
    ...common,
    mode: 'LUCRO_REAL',
    status: reviewRows.length || pendingRows.length || base.lucroRealPendingCount || base.pendingPeriodIncomeCount ? 'PARTIAL' : 'READY',
    taxBaseCents: pisCofinsBaseCents,
    accountingInputCents,
    basisMethod: 'PERIOD_INCOME_BY_POSITION_WITH_REALIZED_FALLBACK',
    pisRate: explicitTreatment ? null : DEFAULT_TAX_RATES.pisFinancialNonCumulative,
    pisCents,
    cofinsRate: explicitTreatment ? null : DEFAULT_TAX_RATES.cofinsFinancialNonCumulative,
    cofinsCents,
    warnings,
  };
}

export function buildFiscalQuarterlyView({events = [], positions = [], banks = [], profile = {}}) {
  const quarters = [...new Set(events.filter(activeEvent).map(event => event.quarter).filter(Boolean))].sort();
  return quarters.map(quarter => {
    const simulation = simulateFinancialTaxes({events, positions, banks, profile, quarter});
    const basePendingCount = simulation.base.pendingCount + simulation.base.pendingPeriodIncomeCount;
    const fiscalMemoryPendingCount = (simulation.memory || []).filter(row => row.requiresReview || row.evidencePendingCount > 0 || row.irrfPendingCount > 0).length;
    return {
      quarter,
      regime: simulation.mode,
      status: simulation.status,
      taxBaseCents: simulation.taxBaseCents,
      accountingInputCents: simulation.accountingInputCents ?? null,
      irpjBasicCents: simulation.irpjBasicCents ?? null,
      csllCents: simulation.csllCents ?? null,
      pisCents: simulation.pisCents ?? null,
      cofinsCents: simulation.cofinsCents ?? null,
      irrfPotentialCreditCents: simulation.irrfPotentialCreditCents ?? simulation.irrfInformativeCents ?? 0,
      pendingCents: simulation.base.pendingCents + simulation.base.pendingPeriodIncomeCents,
      pendingCount: Math.max(basePendingCount, fiscalMemoryPendingCount),
      futureConsumptionTax: simulation.futureConsumptionTax || null,
    };
  });
}
