/* Extrator PDF local de contingência. Cobre PDFs digitais comuns; o servidor local usa Poppler/Tesseract como via robusta. */
import { normalizeDocumentText } from './text-utils.js';

const latin = new TextDecoder('latin1');
const utf8 = new TextDecoder('utf-8');

function bytesToBinary(bytes) { return latin.decode(bytes); }
function hexToBytes(text) { const clean = text.replace(/\s/g,'').replace(/>$/,''); const out=[]; for(let i=0;i<clean.length;i+=2) out.push(parseInt(clean.slice(i,i+2).padEnd(2,'0'),16)); return new Uint8Array(out); }
function ascii85(text) {
  const input=text.replace(/<~|~>/g,'').replace(/\s/g,''); const out=[]; let group=[];
  for(const char of input){ if(char==='z'&&!group.length){out.push(0,0,0,0);continue;} group.push(char.charCodeAt(0)-33); if(group.length===5){let n=0;for(const v of group)n=n*85+v;out.push((n>>>24)&255,(n>>>16)&255,(n>>>8)&255,n&255);group=[];} }
  if(group.length){const length=group.length;while(group.length<5)group.push(84);let n=0;for(const v of group)n=n*85+v;const temp=[(n>>>24)&255,(n>>>16)&255,(n>>>8)&255,n&255];out.push(...temp.slice(0,length-1));}
  return new Uint8Array(out);
}
async function inflate(bytes) {
  if (!globalThis.DecompressionStream) throw new Error('DecompressionStream indisponível');
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
async function decodeStream(dict, bytes) {
  let result=bytes; const filters=[...dict.matchAll(/\/Filter\s*(?:\[([^\]]+)\]|\/(\w+))/g)].flatMap(m=>m[1]?[...m[1].matchAll(/\/(\w+)/g)].map(x=>x[1]):[m[2]]);
  for(const filter of filters){ if(filter==='FlateDecode'||filter==='Fl') result=await inflate(result); else if(filter==='ASCIIHexDecode'||filter==='AHx') result=hexToBytes(bytesToBinary(result)); else if(filter==='ASCII85Decode'||filter==='A85') result=ascii85(bytesToBinary(result)); else throw new Error(`Filtro PDF não suportado no fallback: ${filter}`); }
  return result;
}
function unescapePdfString(text) {
  return text.replace(/\\([nrtbf()\\])/g,(_,c)=>({n:'\n',r:'\r',t:'\t',b:'\b',f:'\f','(':'(',')':')','\\':'\\'}[c]))
    .replace(/\\([0-7]{1,3})/g,(_,oct)=>String.fromCharCode(parseInt(oct,8))).replace(/\\\r?\n/g,'');
}
function decodePdfLiteral(raw) {
  const text=unescapePdfString(raw);
  const bytes=Uint8Array.from([...text].map(c=>c.charCodeAt(0)&255));
  if(bytes.length>=2&&bytes[0]===0xfe&&bytes[1]===0xff){let out='';for(let i=2;i+1<bytes.length;i+=2)out+=String.fromCharCode((bytes[i]<<8)|bytes[i+1]);return out;}
  return latin.decode(bytes);
}
function extractContentText(content) {
  const tokens=[]; const re=/\((?:\\.|[^\\)])*\)|<([0-9A-Fa-f\s]+)>|\[(.*?)\]|\b(Tj|TJ|'|"|Td|TD|Tm|T\*)\b/gs; let match; let lastString='';
  while((match=re.exec(content))){const token=match[0]; if(token.startsWith('(')) lastString=decodePdfLiteral(token.slice(1,-1)); else if(token.startsWith('<')) lastString=latin.decode(hexToBytes(match[1])); else if(token.startsWith('[')){const parts=[...token.matchAll(/\((?:\\.|[^\\)])*\)|<([0-9A-Fa-f\s]+)>/gs)].map(p=>p[0].startsWith('(')?decodePdfLiteral(p[0].slice(1,-1)):latin.decode(hexToBytes(p[1]))); lastString=parts.join('');} else if(/Tj|TJ|'|"/.test(token)){if(lastString)tokens.push(lastString); if(token==="'"||token==='"')tokens.push('\n'); lastString='';} else if(/Td|TD|Tm|T\*/.test(token)) tokens.push('\n');}
  return tokens.join(' ').replace(/\s*\n\s*/g,'\n').replace(/[ \t]+/g,' ');
}

export async function extractPdfTextLite(blob) {
  const bytes=new Uint8Array(await blob.arrayBuffer());
  const binary=bytesToBinary(bytes);
  if(!binary.startsWith('%PDF-')) throw new Error('Arquivo não é um PDF válido');
  if(/\/Encrypt\b/.test(binary)) throw new Error('PDF criptografado não suportado no extrator local de contingência');
  const objectRe=/(\d+)\s+(\d+)\s+obj\b([\s\S]*?)endobj/g; const objects=new Map(); let match;
  while((match=objectRe.exec(binary))){const id=Number(match[1]); const body=match[3]; const streamMatch=body.match(/([\s\S]*?)stream\r?\n([\s\S]*?)\r?\nendstream/); objects.set(id,{body,dict:streamMatch?.[1]||body,streamRaw:streamMatch?Uint8Array.from([...streamMatch[2]].map(c=>c.charCodeAt(0)&255)):null});}
  const pageObjects=[...objects.entries()].filter(([,o])=>/\/Type\s*\/Page\b/.test(o.body)&&!/\/Type\s*\/Pages\b/.test(o.body));
  const pages=[];
  for(const [pageId,page] of pageObjects){const refs=[];const array=page.body.match(/\/Contents\s*\[([^\]]+)\]/);if(array)for(const r of array[1].matchAll(/(\d+)\s+\d+\s+R/g))refs.push(Number(r[1]));else{const single=page.body.match(/\/Contents\s+(\d+)\s+\d+\s+R/);if(single)refs.push(Number(single[1]));}
    let text=''; const warnings=[];
    for(const ref of refs){const obj=objects.get(ref); if(!obj?.streamRaw)continue; try{const decoded=await decodeStream(obj.dict,obj.streamRaw);text+=`\n${extractContentText(bytesToBinary(decoded))}`;}catch(error){warnings.push(error.message);}}
    pages.push({pageNumber:pages.length+1,pageObjectId:pageId,text:normalizeDocumentText(text),method:'BROWSER_PDF_LITE',warnings});
  }
  const fullText=normalizeDocumentText(pages.map(p=>p.text).join('\n\n'));
  return {pages,fullText,method:'BROWSER_PDF_LITE',quality: fullText.length>100?0.65:0.2,warnings:pages.flatMap(p=>p.warnings),imageOnly:fullText.length<40};
}
