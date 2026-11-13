const encoder = new TextEncoder();

function clean(value) {
  return String(value ?? '')
    .replace(/\u00A0/g, ' ')
    .replace(/n[º°]/gi, match => match[0] === 'N' ? 'N.' : 'n.')
    .replace(/º/g, 'o')
    .replace(/ª/g, 'a')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, '?');
}
function escPdf(value) { return clean(value).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)'); }
function brl(cents) { return new Intl.NumberFormat('pt-BR', {style:'currency', currency:'BRL'}).format((cents || 0) / 100); }
function datePt(value) { if (!value) return ''; const [y,m,d] = String(value).slice(0,10).split('-'); return y && m && d ? `${d}/${m}/${y}` : value; }
function evidenceLabel(value) {
  return ({CONFIRMED:'CONFIRMADO', RECONCILED:'CONCILIADO', RECONSTRUCTED:'RECONSTRUIDO', ESTIMATED:'ESTIMADO', PENDING:'PENDENTE', DIVERGENT:'DIVERGENTE'})[value] || value || '';
}
function evidenceShort(value) {
  return ({CONFIRMED:'CONFIRM.', RECONCILED:'CONCIL.', RECONSTRUCTED:'RECONST.', ESTIMATED:'ESTIM.', PENDING:'PEND.', DIVERGENT:'DIVERG.'})[value] || value || '';
}
function familyLabel(value) {
  return ({FIXED_INCOME_SECURITY:'RENDA FIXA', QUOTA_FUND:'FUNDO', AUTOMATIC_CASH:'AUTOMATICA'})[value] || clean(value).replaceAll('_',' ');
}
function productLabel(value) {
  const name = clean(value);
  const normalized = name.toUpperCase();
  if (normalized.includes('CDB POS DI')) return 'CDB POS DI';
  if (normalized.includes('CDB MAIS LIMITE')) return 'CDB + LIMITE';
  if (normalized.includes('CDB DI LIQUIDEZ')) return 'CDB DI PJ';
  if (normalized.includes('APLICACOES AUTOMATICAS')) return 'APLIC. AUTOMATICAS';
  if (normalized.includes('BB RF CP AUTOMATICO')) return 'BB RF CP AUTOMATICO';
  return name;
}
function wrapText(text, maxChars) {
  const words = clean(text).split(/\s+/).filter(Boolean);
  if (!words.length) return [''];
  const lines = [];
  let current = '';
  for (const word of words) {
    if (!current) { current = word; continue; }
    if (`${current} ${word}`.length <= maxChars) current += ` ${word}`;
    else { lines.push(current); current = word; }
  }
  if (current) lines.push(current);
  return lines;
}

class PdfReport {
  constructor() {
    this.pages = [];
    this.commands = [];
    this.y = 790;
    this.pageNo = 0;
    this.margin = 40;
    this.width = 595;
    this.height = 842;
    this.newPage();
  }
  rgb(hex) {
    const value = hex.replace('#','');
    const parts = [0,2,4].map(index => parseInt(value.slice(index,index+2),16)/255);
    return parts.map(item => item.toFixed(3)).join(' ');
  }
  rect(x,y,w,h,{fill=null,stroke=null,lineWidth=0.5}={}) {
    let cmd = 'q\n';
    if (fill) cmd += `${this.rgb(fill)} rg\n`;
    if (stroke) cmd += `${this.rgb(stroke)} RG\n${lineWidth} w\n`;
    cmd += `${x} ${y} ${w} ${h} re ${fill && stroke ? 'B' : fill ? 'f' : 'S'}\nQ\n`;
    this.commands.push(cmd);
  }
  text(text,x,y,size=9,{bold=false,color='#1E2A2B',align='left'}={}) {
    const value = escPdf(text);
    const estimated = value.length * size * 0.50;
    let tx = x;
    if (align === 'right') tx = x - estimated;
    if (align === 'center') tx = x - estimated/2;
    this.commands.push(`q\n${this.rgb(color)} rg\nBT /F${bold?2:1} ${size} Tf ${tx.toFixed(2)} ${y.toFixed(2)} Td (${value}) Tj ET\nQ\n`);
  }
  line(x1,y1,x2,y2,color='#D3DDDE',width=0.5) { this.commands.push(`q\n${this.rgb(color)} RG\n${width} w\n${x1} ${y1} m ${x2} ${y2} l S\nQ\n`); }
  newPage() {
    if (this.commands.length) this.pages.push(this.commands.join(''));
    this.commands = [];
    this.pageNo += 1;
    this.y = 794;
    this.rect(0,0,this.width,this.height,{fill:'#FFFFFF'});
    this.rect(0,812,this.width,30,{fill:'#075B62'});
    this.text('H. TEIXEIRA CONTABILIDADE',this.margin,823,8,{bold:true,color:'#FFFFFF'});
    this.text(`Pagina ${this.pageNo}`,this.width-this.margin,823,8,{color:'#FFFFFF',align:'right'});
  }
  ensure(height) { if (this.y - height < 45) this.newPage(); }
  paragraph(text,{size=9,bold=false,color='#1E2A2B',indent=0,leading=null,maxChars=100}={}) {
    const lines = wrapText(text,maxChars);
    const lineHeight = leading || size + 4;
    this.ensure(lines.length*lineHeight+2);
    for (const line of lines) { this.text(line,this.margin+indent,this.y,size,{bold,color}); this.y -= lineHeight; }
  }
  section(title) {
    this.ensure(30);
    this.y -= 4;
    this.rect(this.margin,this.y-17,this.width-this.margin*2,22,{fill:'#E7F2F3'});
    this.text(title,this.margin+8,this.y-10,10,{bold:true,color:'#075B62'});
    this.y -= 30;
  }
  title(title,subtitle='') {
    this.rect(this.margin,this.y-74,this.width-this.margin*2,78,{fill:'#075B62'});
    this.text(title,this.margin+16,this.y-28,16,{bold:true,color:'#FFFFFF'});
    if (subtitle) this.text(subtitle,this.margin+16,this.y-50,9,{color:'#D9F0F1'});
    this.y -= 92;
  }
  kpi(label,value,x,y,w=120) {
    this.rect(x,y,w,52,{fill:'#F5F8F8',stroke:'#D3DDDE'});
    this.text(label,x+8,y+35,7.5,{bold:true,color:'#537073'});
    this.text(value,x+8,y+14,10,{bold:true,color:'#075B62'});
  }
  table({columns,rows,widths,rowHeight=18,fontSize=7.2,wrapColumns=[],maxLines=3}) {
    const total = widths.reduce((a,b)=>a+b,0);
    const lineHeight = fontSize + 2.2;
    const drawHeader = () => {
      this.ensure(rowHeight+2);
      let x = this.margin;
      this.rect(x,this.y-rowHeight,total,rowHeight,{fill:'#13818B'});
      columns.forEach((column,index)=>{ this.text(column,x+4,this.y-rowHeight+6,fontSize,{bold:true,color:'#FFFFFF'}); x += widths[index]; });
      this.y -= rowHeight;
    };
    drawHeader();
    for (let rowIndex=0; rowIndex<rows.length; rowIndex+=1) {
      const row = rows[rowIndex];
      const prepared = row.map((value,index)=>{
        const raw = clean(value);
        const maxChars = Math.max(5,Math.floor((widths[index]-8)/(fontSize*0.50)));
        if (wrapColumns.includes(index)) {
          const lines = wrapText(raw,maxChars).slice(0,maxLines);
          if (wrapText(raw,maxChars).length > maxLines && lines.length) lines[lines.length-1] = `${lines[lines.length-1].slice(0,Math.max(1,maxChars-3))}...`;
          return lines;
        }
        return [raw.length > maxChars ? `${raw.slice(0,Math.max(1,maxChars-3))}...` : raw];
      });
      const contentLines = Math.max(1,...prepared.map(lines=>lines.length));
      const effectiveHeight = Math.max(rowHeight,contentLines*lineHeight+7);
      if (this.y - effectiveHeight < 45) { this.newPage(); drawHeader(); }
      let x = this.margin;
      this.rect(this.margin,this.y-effectiveHeight,total,effectiveHeight,{fill: rowIndex%2 ? '#F7FAFA' : '#FFFFFF',stroke:'#E1E8E9',lineWidth:0.25});
      prepared.forEach((lines,index)=>{
        const single = lines.length === 1;
        const numeric = single && (/^R\$|^-?\d[\d.,]*$/.test(lines[0]));
        lines.forEach((line,lineIndex)=>{
          const textY = this.y - 6 - fontSize - lineIndex*lineHeight;
          this.text(line,numeric ? x+widths[index]-4 : x+4,textY,fontSize,{color:'#263637',align:numeric?'right':'left'});
        });
        x += widths[index];
      });
      this.y -= effectiveHeight;
    }
    this.y -= 8;
  }
  finish() {
    if (this.commands.length) this.pages.push(this.commands.join(''));
    return this.pages;
  }
}

function buildPdf(pages) {
  const objects = [];
  const add = value => { objects.push(value); return objects.length; };
  const catalog = add('');
  const pagesId = add('');
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const fontBold = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');
  const pageIds = [];
  for (const pageContent of pages) {
    const streamLength = encoder.encode(pageContent).length;
    const contentId = add(`<< /Length ${streamLength} >>\nstream\n${pageContent}endstream`);
    const pageId = add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${font} 0 R /F2 ${fontBold} 0 R >> >> /Contents ${contentId} 0 R >>`);
    pageIds.push(pageId);
  }
  objects[catalog-1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objects[pagesId-1] = `<< /Type /Pages /Count ${pageIds.length} /Kids [${pageIds.map(id=>`${id} 0 R`).join(' ')}] >>`;
  let output = '%PDF-1.4\n%HTAF\n';
  const offsets = [0];
  for (let i=0;i<objects.length;i+=1) { offsets.push(encoder.encode(output).length); output += `${i+1} 0 obj\n${objects[i]}\nendobj\n`; }
  const xref = encoder.encode(output).length;
  output += `xref\n0 ${objects.length+1}\n0000000000 65535 f \n`;
  for (let i=1;i<offsets.length;i+=1) output += `${String(offsets[i]).padStart(10,'0')} 00000 n \n`;
  output += `trailer\n<< /Size ${objects.length+1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new Blob([encoder.encode(output)],{type:'application/pdf'});
}

export function createExecutivePdf(snapshot) {
  const report = new PdfReport();
  const project = snapshot.project || {};
  const metrics = snapshot.metrics || {};
  const issues = snapshot.issues || [];
  const quarterly = snapshot.quarterly || [];
  const positions = snapshot.positions || [];
  const redemptions = snapshot.redemptions || [];
  const reconciliations = snapshot.reconciliations || [];
  const quarterClosures = snapshot.quarterClosures || [];
  const sim = snapshot.taxSimulation || {warnings:[]};
  const fiscalQuarterly = snapshot.fiscalQuarterly || [];
  const fiscalMemory = snapshot.fiscalMemory || [];
  const taxSources = snapshot.taxSources || [];
  const regime = project.taxProfile?.regime || 'Nao informado';
  report.title('Analista Tributario de Aplicacoes Financeiras',`${project.name || 'Projeto'} | CNPJ ${project.cnpj || 'Nao informado'} | ${snapshot.quarter || 'Periodo completo'}`);
  report.paragraph(`Relatorio gerado em ${new Date(snapshot.generatedAt || Date.now()).toLocaleString('pt-BR')}. Regime informado: ${regime}.`,{size:8,color:'#537073'});

  report.section('Resumo executivo');
  const cardW = 121; const gap = 7; const x0 = report.margin; const y1 = report.y-52;
  const kpis = [
    ['Valores aplicados',brl(metrics.appliedCents)],['Resgates liquidos',brl(metrics.netRedeemedCents)],['Rend. realizados',brl(metrics.realizedIncomeTotalCents)],['IR efetivo',brl(metrics.effectiveIrCents)],
    ['Resgates brutos',brl(metrics.grossRedeemedCents)],['Rend. do periodo',brl(metrics.periodIncomeCents)],['Saldo final',brl(metrics.endingBalanceCents)],['Pendencias',String(issues.length)],
  ];
  kpis.forEach((item,index)=>{ const row=Math.floor(index/4), col=index%4; report.kpi(item[0],item[1],x0+col*(cardW+gap),y1-row*61,cardW); });
  report.y = y1-70;
  report.paragraph('Valores realizados pendentes, divergentes ou reconstruidos sem aprovacao nao sao tratados como base tributaria confirmada.',{size:8,color:'#9C5700',maxChars:110});

  report.section('Totalizadores trimestrais por banco');
  report.table({
    columns:['Trimestre','Banco','Aplicado','Resg. liq.','Rend. realizado','Rend. periodo','IR efetivo','IOF','Saldo'],
    widths:[50,72,59,59,64,61,55,45,55],
    rows:quarterly.map(row=>[row.quarterLabel,row.bankName,brl(row.appliedCents),brl(row.netRedeemedCents),brl(row.realizedIncomeTotalCents),brl(row.periodIncomeCents),brl(row.effectiveIrCents),brl(row.iofCents),brl(row.endingBalanceCents)]),
    fontSize:6.7,rowHeight:18,
  });

  report.section('Resgates');
  if (!redemptions.length) report.paragraph('Nenhum resgate identificado no filtro selecionado.');
  else report.table({
    columns:['Data','Banco','Aplicacao','Liquido','IRRF','IOF','Bruto','Rendimento','Principal','Evidencia'],
    widths:[40,44,52,58,45,43,58,55,68,43],
    rows:redemptions.map(row=>[
      datePt(row.occurredAt),row.bankName,productLabel(row.positionName),brl(row.netAmountCents),brl(row.irrfCents),brl(row.iofCents),brl(row.grossAmountCents),
      row.evidenceStatus === 'PENDING' ? 'PENDENTE' : brl(row.realizedIncomeCents),
      row.principalRecoveryCents ? brl(row.principalRecoveryCents) : 'NAO DETERMINADO',evidenceShort(row.evidenceStatus),
    ]),fontSize:5.8,rowHeight:18,
  });

  report.section('Memoria de conciliacao e fechamento');
  if (!reconciliations.length) report.paragraph('Nenhuma operacao de resgate conciliada no filtro selecionado.');
  else report.table({
    columns:['Trimestre','Banco','Aplicacao','Liquido','IRRF','Bruto','Rendimento','Principal','OFX','Score','Status'],
    widths:[42,45,78,58,48,58,58,60,31,32,55],
    rows:reconciliations.map(item=>[item.quarter,item.bankId,productLabel(positions.find(p=>p.id===item.positionId)?.name||item.positionId),brl(item.amounts?.netCents),brl(item.amounts?.irrfCents),brl(item.amounts?.grossCents),item.costBasisStatus==='PENDING_HISTORICAL_COST'?'PENDENTE':brl(item.amounts?.realizedIncomeCents),item.costBasisStatus?.startsWith('PENDING')?'PENDENTE':brl(item.amounts?.principalRecoveryCents),item.bankTransactionId?'SIM':'NAO',String(item.score||0),item.status]),
    fontSize:5.5,rowHeight:18,
  });
  if (quarterClosures.length) {
    report.paragraph('Fechamentos trimestrais imutaveis:',{bold:true});
    for (const closure of quarterClosures) report.paragraph(`${closure.quarter} r${closure.revision} | ${closure.quality} | SHA-256 ${closure.integrityHash}`,{size:7,color:'#537073',maxChars:118});
  } else report.paragraph('Nenhum fechamento trimestral registrado para o filtro selecionado.',{size:8,color:'#537073'});

  report.section('Aplicacoes e posicoes');
  report.table({
    columns:['Banco','Produto','Codigo','Familia','Inicio','Saldo inicial','Resgatado','Rend. realizado','Saldo','Resg. total','Qualidade'],
    // POSINFO01: larguras mínimas p/ fonte 6 (data >= 38pt, valor R$ >= 53pt); banco/produto/código quebram em 2 linhas
    widths:[40,48,62,40,38,53,53,53,53,38,32],
    rows:positions.map(row=>[
      row.bankName,productLabel(row.name),productLabel(row.lifecycle?.code || '-'),familyLabel(row.productFamily),row.metadata?.openedAtDocumented === false ? 'NAO DOC.' : datePt(row.openedAt),
      row.originalPrincipalCents == null && row.lifecycle?.initialBalance?.cents == null ? 'NAO DOC.' : brl(row.originalPrincipalCents ?? row.lifecycle.initialBalance.cents),brl(row.netRedeemedCents),
      row.realizedIncomeStatus === 'PENDING' ? 'PENDENTE' : brl(row.realizedIncomeCents),brl(row.endingBalanceCents),
      row.lifecycle?.fullRedemption?.closed ? (row.lifecycle.fullRedemption.date ? datePt(row.lifecycle.fullRedemption.date) : 'ENCERRADA') : 'ABERTA',evidenceShort(row.realizedIncomeStatus),
    ]),fontSize:6,rowHeight:20,wrapColumns:[0,1,2],maxLines:2,
  });

  report.section('Visao fiscal trimestral');
  if (!fiscalQuarterly.length) report.paragraph('Nenhum trimestre disponivel para a memoria fiscal.');
  else report.table({
    columns:['Trimestre','Regime','Status','Base auto.','Insumo LR','IRPJ basico','CSLL','PIS','Cofins',sim.mode === 'LUCRO_PRESUMIDO' ? 'IRRF credito' : 'IR retido'],
    widths:[48,62,55,61,61,61,48,45,50,54],
    rows:fiscalQuarterly.map(item=>[
      item.quarter,item.regime==='LUCRO_PRESUMIDO'?'Presumido':'Real',item.status,
      item.taxBaseCents==null?'N/C':brl(item.taxBaseCents),item.accountingInputCents==null?'—':brl(item.accountingInputCents),
      item.irpjBasicCents==null?'—':brl(item.irpjBasicCents),item.csllCents==null?'—':brl(item.csllCents),
      item.pisCents==null?'—':brl(item.pisCents),item.cofinsCents==null?'—':brl(item.cofinsCents),brl(item.irrfPotentialCreditCents||0),
    ]),fontSize:5.4,rowHeight:18,
  });
  report.paragraph('Totais de informes funcionam como controles de conciliacao e nao sao somados novamente a base tributaria. Valores pendentes, divergentes ou reconstruidos sem aprovacao explicita permanecem fora da base automatica.',{size:7.7,color:'#9C5700',maxChars:118});

  report.section('Memoria de calculo fiscal por aplicacao');
  if (!fiscalMemory.length) report.paragraph('Selecione um trimestre para gerar a memoria por aplicacao.');
  else if (sim.mode === 'LUCRO_PRESUMIDO') report.table({
    columns:['Banco','Aplicacao','Rend. elegivel','Base LP','IRRF doc.','IRRF credito','Pend.','Status'],
    widths:[55,125,70,70,65,70,40,60],
    rows:fiscalMemory.map(item=>[
      item.bankName,productLabel(item.positionName),brl(item.realizedEligibleCents),brl(item.lpTaxBaseCents),brl(item.irrfEligibleCents),brl(item.lpIrrfPotentialCreditCents||0),String(item.evidencePendingCount||0),item.requiresReview?'REVISAR':item.evidencePendingCount?'PARCIAL':'OK'
    ]),fontSize:5.8,rowHeight:19,
  });
  else report.table({
    columns:['Banco','Aplicacao','Metodo','Insumo LR','Trat. P/C','Base P/C','PIS','Cofins','Pend.','Status'],
    widths:[47,95,70,61,58,55,45,50,38,47],
    rows:fiscalMemory.map(item=>[
      item.bankName,productLabel(item.positionName),item.lrBasisMethod,brl(item.lrAccountingIncomeCents),item.lrPisCofinsTreatment,brl(item.lrPisCofinsBaseCents),item.pisCents==null?'N/C':brl(item.pisCents),item.cofinsCents==null?'N/C':brl(item.cofinsCents),String(item.evidencePendingCount||0),item.requiresReview?'REVISAR':item.evidencePendingCount?'PARCIAL':'OK'
    ]),fontSize:5.4,rowHeight:19,
  });

  report.section('Simulacao tributaria restrita');
  report.paragraph(`Status: ${sim.status || 'Nao calculado'} | Metodo da base: ${sim.basisMethod || (sim.mode === 'LUCRO_REAL' ? 'Receita financeira por competencia/fallback' : 'Rendimento realizado elegivel')}.`,{bold:true});
  report.paragraph(`Base elegivel: ${sim.taxBaseCents == null ? 'Nao calculada' : brl(sim.taxBaseCents)} | ${sim.mode === 'LUCRO_PRESUMIDO' ? 'IRRF potencial credito' : 'IR retido elegivel'}: ${brl(sim.mode === 'LUCRO_PRESUMIDO' ? (sim.irrfPotentialCreditCents ?? 0) : (sim.irrfInformativeCents ?? 0))}.`);
  if (sim.mode === 'LUCRO_PRESUMIDO') {
    report.paragraph(`IRPJ basico incremental (15%): ${sim.irpjBasicCents == null ? 'Revisao necessaria' : brl(sim.irpjBasicCents)} | CSLL incremental (9%): ${sim.csllCents == null ? 'Revisao necessaria' : brl(sim.csllCents)}.`);
  } else if (sim.mode === 'LUCRO_REAL') {
    report.paragraph(`Insumo contabil/fiscal para IRPJ/CSLL: ${sim.accountingInputCents == null ? 'Nao calculado' : brl(sim.accountingInputCents)} | PIS estimado: ${sim.pisCents == null ? 'Revisao necessaria' : brl(sim.pisCents)} | Cofins estimada: ${sim.cofinsCents == null ? 'Revisao necessaria' : brl(sim.cofinsCents)}.`);
  }
  report.paragraph('O app nao calcula o IRPJ/CSLL global da empresa, o adicional do IRPJ ou o DARF. No Lucro Real, a receita financeira e exportada como insumo da apuracao contabil/fiscal global. CBS/IBS permanecem em revisao normativa, sem calculo automatico nesta versao.',{size:8,color:'#9C5700',maxChars:112});
  for (const warning of sim.warnings || []) report.paragraph(`ATENCAO: ${warning}`,{size:7.8,color:'#9C5700',maxChars:118});

  if (report.y < 150) report.newPage();
  report.section('Pendencias e cobertura documental');
  report.paragraph('Documentos de bancos sem template dedicado sao processados pelo adaptador generico e permanecem sujeitos a revisao humana quando a confianca for insuficiente.',{size:8,color:'#537073',maxChars:112});
  if (!issues.length) report.paragraph('Nenhuma pendencia aberta no filtro selecionado.');
  else report.table({columns:['Severidade','Titulo','Detalhes'],widths:[70,150,295],rows:issues.map(issue=>[issue.severity||'REVIEW',issue.title,issue.details]),fontSize:7,rowHeight:22,wrapColumns:[1,2],maxLines:5});

  report.section('Metodologia e legenda de qualidade');
  report.paragraph('Os templates do Banco Inter e do Banco do Brasil funcionam como modelos especializados. Documentos de outras instituicoes seguem o mesmo pipeline, com identificacao automatica, extracao generica e revisao humana quando o layout nao for conhecido.',{size:8,color:'#537073',maxChars:112});
  report.table({
    columns:['Status','Significado'],
    widths:[100,415],
    rows:[
      ['CONFIRMADO','Valor diretamente suportado pelo documento ou informe.'],
      ['CONCILIADO','Valor confirmado pelo cruzamento de fontes independentes.'],
      ['RECONSTRUIDO','Valor calculado por conciliacao; exige aprovacao para simulacao tributaria.'],
      ['ESTIMADO','Valor indicativo, sem suporte documental suficiente para uso definitivo.'],
      ['PENDENTE','Informacao incompleta ou custo historico nao demonstrado.'],
      ['DIVERGENTE','Fontes incompatíveis; requer revisao antes da exportacao definitiva.'],
    ],
    fontSize:7,rowHeight:18,wrapColumns:[1],maxLines:3,
  });
  report.paragraph('CNAE e metadado opcional. O regime tributario, o tipo de entidade, o tratamento de PIS/Cofins e as evidencias documentais orientam a simulacao. O app nao substitui a apuracao contabil e fiscal completa da empresa.',{size:8,color:'#537073',maxChars:112});

  report.section('Referencias normativas oficiais');
  for (const source of taxSources) report.paragraph(`${source.scope} | ${source.title} | ${source.url}`,{size:6.8,color:'#537073',maxChars:125});

  return buildPdf(report.finish());
}
