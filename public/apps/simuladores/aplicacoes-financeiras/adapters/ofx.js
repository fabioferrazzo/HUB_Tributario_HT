function tag(block, name) {
  const closed = new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`, 'i');
  const open = new RegExp(`<${name}[^>]*>([^<\\r\\n]+)`, 'i');
  const match = block.match(closed) || block.match(open);
  return match ? match[1].trim() : '';
}
function date(raw) { const digits = String(raw || '').replace(/\D/g, ''); return digits.length >= 8 ? `${digits.slice(0,4)}-${digits.slice(4,6)}-${digits.slice(6,8)}` : null; }
function cents(raw) { const n = Number(String(raw || '0').replace(',', '.')); if (!Number.isFinite(n)) throw new Error(`Valor OFX inválido: ${raw}`); return Math.round(n * 100); }
export function parseOfx(text, sourceName = 'arquivo.ofx') {
  if (!/<OFX[>\s]/i.test(text)) throw new Error('Arquivo não contém envelope OFX.');
  const bankId = tag(text, 'BANKID') || tag(text, 'ORG') || 'UNKNOWN';
  const accountId = tag(text, 'ACCTID') || '';
  const blocks = [...text.matchAll(/<STMTTRN>([\s\S]*?)(?=<STMTTRN>|<\/BANKTRANLIST>|<\/STMTTRN>|$)/gi)].map(m => m[1]);
  const transactions = []; const seen = new Set(); let duplicates = 0;
  for (const block of blocks) {
    const signedAmountCents = cents(tag(block, 'TRNAMT'));
    const fitid = tag(block, 'FITID'); const postedAt = date(tag(block, 'DTPOSTED'));
    const name = tag(block, 'NAME'); const memo = tag(block, 'MEMO');
    const key = fitid ? `${bankId}|${accountId}|${fitid}` : `${bankId}|${accountId}|${postedAt}|${signedAmountCents}|${name}|${memo}`;
    if (seen.has(key)) { duplicates += 1; continue; } seen.add(key);
    transactions.push({fitid:fitid || null, postedAt, signedAmountCents, amountCents:Math.abs(signedAmountCents), direction:signedAmountCents >= 0 ? 'CREDIT' : 'DEBIT', history:[name,memo].filter(Boolean).join(' — ')});
  }
  return {sourceName, syntax:/OFXHEADER:/i.test(text) ? 'SGML' : 'XML', bankId, accountId, period:{from:date(tag(text,'DTSTART')),to:date(tag(text,'DTEND'))}, transactions, duplicates};
}
