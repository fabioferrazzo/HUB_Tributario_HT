// INTERRAW01 — layout real do "Extrato de movimentação de renda fixa" do Banco Inter (emissão 2026).
// Com `pdftotext -layout` as colunas saem desalinhadas (valores 1–2 linhas abaixo da descrição) e o
// cabeçalho do CDB traz "Data aplicação ... Valor ... Taxa" com o vencimento na linha de baixo.
// Com `pdftotext -raw` a ordem é estável:
//   R$ <valor>
//   <dd/mm/aaaa> <DEFINITIVO|ABERTURA|MOVIMENTACAO>
//   <histórico> R$ <saldo>
// e o cabeçalho do CDB vem DEPOIS dos seus movimentos:
//   <CDB ...>
//   <data aplicação>
//   <vencimento> R$ <valor aplicado> <taxa>
// Este módulo converte o texto raw no formato canônico já homologado pelo leitor Inter
// ("Vencimento: X Data aplicação: Y Valor: R$ Z" + linhas "dd/mm/aaaa Histórico R$ valor").

const MONEY = '([\\d.]+,\\d{2})';
const RE_VALUE = new RegExp(`^R\\$\\s*${MONEY}$`);
const RE_DATE_DC = /^(\d{2}\/\d{2}\/\d{4})\s+(DEFINITIVO|ABERTURA|MOVIMENTACAO)$/i;
const RE_LABEL_SALDO = new RegExp(`^(.+?)\\s+R\\$\\s*${MONEY}$`);
const RE_PRODUCT = /^((?:CDB|LCI|LCA|RDB|LC)\b[^\n]{0,100})$/i;
const RE_DATE_ONLY = /^(\d{2}\/\d{2}\/\d{4})$/;
const RE_MATURITY_VALUE = new RegExp(`^(\\d{2}\\/\\d{2}\\/\\d{4}|[^R]{2,40}?)\\s+R\\$\\s*${MONEY}(?:\\s+(\\S[^\\n]{0,39}))?$`); // taxa: "0.0000", "100% CDI"...
const KNOWN_LABEL = /^(Aplicação|Resgate Antecipado|Imposto de renda retido na fonte|Rendimento até esta data|Saldo até esta data|Previsão de I\.R\. para resgate total até esta data|Previsão para I\.O\.F\. até esta data)/i;

const cents = value => Math.round(Number(String(value).replace(/\./g, '').replace(',', '.')) * 100);
const brl = value => (value / 100).toLocaleString('pt-BR', {minimumFractionDigits: 2, maximumFractionDigits: 2});

/** Lê blocos {name, openedAt, maturity, principal, rate, movements[]} do texto raw. */
export function interRawBlocks(rawText) {
  const lines = String(rawText || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const blocks = [];
  let pending = [];
  let headerFirst = null; // decidido pelo primeiro elemento encontrado
  for (let i = 0; i < lines.length; i += 1) {
    const value = lines[i].match(RE_VALUE);
    const dateDc = lines[i + 1]?.match(RE_DATE_DC);
    const labelSaldo = lines[i + 2]?.match(RE_LABEL_SALDO);
    if (value && dateDc && labelSaldo && KNOWN_LABEL.test(labelSaldo[1])) {
      if (headerFirst === null) headerFirst = false;
      const movement = {date: dateDc[1], dc: dateDc[2].toUpperCase(), label: labelSaldo[1].trim(), valueCents: cents(value[1]), balanceCents: cents(labelSaldo[2])};
      if (headerFirst && blocks.length) blocks[blocks.length - 1].movements.push(movement); else pending.push(movement);
      i += 2;
      continue;
    }
    const product = lines[i].match(RE_PRODUCT);
    const opened = lines[i + 1]?.match(RE_DATE_ONLY);
    const maturity = lines[i + 2]?.match(RE_MATURITY_VALUE);
    if (product && opened && maturity) {
      if (headerFirst === null) headerFirst = true;
      blocks.push({name: product[1].trim(), openedAt: opened[1], maturity: maturity[1].trim(), principalCents: cents(maturity[2]), rate: maturity[3] || '', movements: headerFirst ? [] : pending});
      pending = [];
      i += 2;
    }
  }
  return blocks;
}

/**
 * Texto canônico (formato homologado). Para cada data com movimentação acrescenta o saldo real ao final
 * do dia ("Saldo até esta data"), ignorando o saldo das linhas de previsão (que é líquido da previsão).
 */
export function interRawToCanonical(rawText) {
  const blocks = interRawBlocks(rawText).filter(block => block.movements.length);
  if (!blocks.length) return '';
  const out = [];
  for (const block of blocks) {
    out.push(block.name);
    out.push(`Vencimento: ${block.maturity} Data aplicação: ${block.openedAt} Valor: R$ ${brl(block.principalCents)} Taxa: ${block.rate}`.trim());
    const dates = [...new Set(block.movements.map(m => m.date))];
    for (const date of dates) {
      const rows = block.movements.filter(m => m.date === date);
      for (const row of rows) out.push(`${row.date} ${row.label} R$ ${brl(row.valueCents)}`);
      const real = rows.filter(row => !/^Previsão/i.test(row.label) && !/^Saldo até esta data/i.test(row.label));
      const hasSaldoRow = rows.some(row => /^Saldo até esta data/i.test(row.label));
      if (real.length && !hasSaldoRow) out.push(`${date} Saldo até esta data R$ ${brl(real[real.length - 1].balanceCents)}`);
    }
  }
  return out.join('\n');
}
