import { EVENT_TYPES } from './model.js';

function activeEvent(event) {
  return event && event.metadata?.excludedFromAnalysis !== true;
}

function isOpeningOnlySnapshot(event) {
  return event?.type === EVENT_TYPES.BALANCE_SNAPSHOT && event?.metadata?.balanceRole === 'OPENING';
}

export function operationalQuarters({events = [], quarterClosures = []} = {}) {
  const values = new Set();
  for (const closure of quarterClosures || []) {
    if (closure?.quarter) values.add(String(closure.quarter));
  }
  for (const event of events || []) {
    if (!activeEvent(event) || !event?.quarter || isOpeningOnlySnapshot(event)) continue;
    values.add(String(event.quarter));
  }
  return [...values].sort();
}
