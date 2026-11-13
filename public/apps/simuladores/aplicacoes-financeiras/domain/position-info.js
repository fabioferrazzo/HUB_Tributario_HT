// POSINFO01 — ciclo de vida de cada aplicação (derivado; não altera eventos nem o motor fiscal).
// Código da aplicação, saldo inicial conhecido, vencimento e data do resgate total.
import { EVENT_TYPES } from './model.js';

const accepted = event => event?.metadata?.reviewDisposition !== 'REJECTED' && event?.metadata?.excludedFromAnalysis !== true;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
// Prefixos de identidade interna gerados pelo próprio app (não são códigos do banco).
const INTERNAL_REFERENCE = /^(automatic-|BANRISUL-|ITAU-SUMMARY-|position-)/i;

export const INITIAL_BALANCE_BASIS = Object.freeze({
  ORIGINAL_PRINCIPAL: 'ORIGINAL_PRINCIPAL',       // valor aplicado documentado
  FIRST_APPLICATION: 'FIRST_APPLICATION',         // primeiro aporte registrado
  FIRST_DOCUMENT_BALANCE: 'FIRST_DOCUMENT_BALANCE', // saldo do primeiro documento (posição anterior ao período)
  UNKNOWN: 'UNKNOWN',
});

export const INITIAL_BALANCE_LABELS = Object.freeze({
  ORIGINAL_PRINCIPAL: 'Valor aplicado',
  FIRST_APPLICATION: '1º aporte registrado',
  FIRST_DOCUMENT_BALANCE: 'Saldo no 1º documento',
  UNKNOWN: 'Não documentado',
});

function formatCnpj(digits) {
  return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12)}`;
}

/** Código da aplicação no banco (número/título/CNPJ do fundo) ou null quando o documento não traz. */
export function positionCode(position) {
  const explicit = String(position?.applicationCode || '').trim();
  if (explicit) return explicit;
  const ref = String(position?.externalReference || '').trim();
  if (!ref) return null;
  const digits = ref.replace(/\D/g, '');
  if (/^\d{14}$/.test(digits) && /^[\d./-]+$/.test(ref)) return `CNPJ ${formatCnpj(digits)}`;
  if (ref.includes('|') || INTERNAL_REFERENCE.test(ref) || ISO_DATE.test(ref)) return null;
  if (position?.openedAt && ref === position.openedAt) return null;
  return ref;
}

/** Data de vencimento quando conhecida (ISO) ou texto do documento (ex.: "Liquidez diária"). */
export function positionMaturity(position) {
  const iso = position?.maturityDate || position?.metadata?.maturityDate || null;
  if (iso && ISO_DATE.test(String(iso).slice(0, 10))) return {date: String(iso).slice(0, 10), text: null};
  const text = String(position?.maturityText || position?.metadata?.maturityText || '').trim();
  return text ? {date: null, text} : null;
}

function positionEvents(position, events) {
  return (events || []).filter(event => accepted(event) && event.positionId === position.id)
    .sort((a, b) => String(a.occurredAt).localeCompare(String(b.occurredAt)));
}

/**
 * Saldo inicial conhecido da aplicação:
 * 1) valor aplicado documentado; 2) primeiro aporte registrado; 3) saldo do primeiro documento
 * (quando a aplicação é anterior ao período dos documentos); 4) desconhecido.
 */
export function positionInitialBalance(position, events) {
  const own = positionEvents(position, events);
  if (position?.originalPrincipalCents != null) {
    return {cents: position.originalPrincipalCents, date: position.openedAt || null, basis: INITIAL_BALANCE_BASIS.ORIGINAL_PRINCIPAL};
  }
  const firstApplication = own.find(event => event.type === EVENT_TYPES.APPLICATION);
  const firstSnapshot = own.find(event => event.type === EVENT_TYPES.BALANCE_SNAPSHOT);
  if (firstApplication && (!firstSnapshot || firstApplication.occurredAt <= firstSnapshot.occurredAt)) {
    return {cents: firstApplication.amountCents, date: firstApplication.occurredAt, basis: INITIAL_BALANCE_BASIS.FIRST_APPLICATION};
  }
  if (firstSnapshot) {
    return {cents: firstSnapshot.amountCents, date: firstSnapshot.occurredAt, basis: INITIAL_BALANCE_BASIS.FIRST_DOCUMENT_BALANCE};
  }
  return {cents: null, date: null, basis: INITIAL_BALANCE_BASIS.UNKNOWN};
}

/**
 * Data do resgate total: para aplicação encerrada (CLOSED) ou cujo último saldo documentado é zero,
 * é a data do último resgate; na falta de resgate, a data do saldo zerado.
 */
export function positionFullRedemption(position, events) {
  const own = positionEvents(position, events);
  const snapshots = own.filter(event => event.type === EVENT_TYPES.BALANCE_SNAPSHOT);
  const lastSnapshot = snapshots[snapshots.length - 1] || null;
  const closedByStatus = position?.status === 'CLOSED';
  const closedByBalance = lastSnapshot != null && lastSnapshot.amountCents === 0;
  if (!closedByStatus && !closedByBalance) return {closed: false, date: null, basis: null};
  const redemptions = own.filter(event => event.type === EVENT_TYPES.REDEMPTION);
  if (redemptions.length) return {closed: true, date: redemptions[redemptions.length - 1].occurredAt, basis: 'LAST_REDEMPTION'};
  if (closedByBalance) {
    const firstZero = snapshots.find(event => event.amountCents === 0 && snapshots.slice(snapshots.indexOf(event)).every(s => s.amountCents === 0));
    return {closed: true, date: (firstZero || lastSnapshot).occurredAt, basis: 'ZERO_BALANCE'};
  }
  return {closed: true, date: null, basis: 'STATUS_ONLY'};
}

/** Resumo completo do ciclo de vida (independente do filtro de trimestre). */
export function positionLifecycle(position, events) {
  return {
    code: positionCode(position),
    maturity: positionMaturity(position),
    initialBalance: positionInitialBalance(position, events),
    fullRedemption: positionFullRedemption(position, events),
  };
}
