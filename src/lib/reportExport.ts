import type { PdfReportLine, ReportFormat, ReportRow } from "../app/appTypes";
import { toReportFileName } from "./formatters";

export function exportReport(format: ReportFormat, title: string, rows: ReportRow[]) {
  const reportRows = rows.length ? rows : [{ Info: "Nenhum registro encontrado para o filtro atual." }];
  if (format === "pdf") {
    downloadPdfReport(title, reportRows);
    return;
  }

  downloadXlsxReport(title, reportRows);
}

export function openPrintableReport(title: string, rows: ReportRow[]) {
  const reportWindow = window.open("", "_blank", "noopener,noreferrer");
  if (!reportWindow) return;

  reportWindow.document.write(buildReportHtml(title, rows, true));
  reportWindow.document.close();
  reportWindow.focus();
  window.setTimeout(() => reportWindow.print(), 250);
}

export function downloadPdfReport(title: string, rows: ReportRow[]) {
  const pdf = buildPdfReport(title, rows);
  downloadBlob(new Blob([pdf], { type: "application/pdf" }), `${toReportFileName(title)}.pdf`);
}

export function downloadXlsxReport(title: string, rows: ReportRow[]) {
  const workbook = buildXlsxWorkbook(title, rows);
  downloadBlob(new Blob([workbook], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), `${toReportFileName(title)}.xlsx`);
}

export function downloadDocxReport(title: string, rows: ReportRow[]) {
  const docx = buildDocxReport(title, rows);
  downloadBlob(new Blob([docx], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }), `${toReportFileName(title)}.docx`);
}

export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = "noopener";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2500);
}

export function buildPdfReport(title: string, rows: ReportRow[]) {
  const pageWidth = 842;
  const pageHeight = 595;
  const margin = 36;
  const maxLineLength = 118;
  const columns = Object.keys(rows[0] || { Info: "" });
  const generatedAt = new Date().toLocaleString("pt-BR");
  const lines: PdfReportLine[] = [
    { text: title, bold: true, size: 16 },
    { text: `Gerado em ${generatedAt} pelo HUB Depto Tributario.`, size: 9 },
    { text: "", size: 5 }
  ];

  rows.forEach((row, rowIndex) => {
    if (rowIndex > 0) lines.push({ text: "", size: 5 });
    lines.push({ text: `Registro ${rowIndex + 1}`, bold: true, size: 10 });
    columns.forEach((column) => {
      const value = `${column}: ${String(row[column] ?? "")}`;
      wrapReportText(value, maxLineLength).forEach((text) => lines.push({ text, size: 9 }));
    });
  });

  const pages = paginatePdfReportLines(lines, pageHeight, margin);
  const pageObjectNumbers: number[] = [];
  const contentObjectNumbers: number[] = [];
  let nextObjectNumber = 5;
  pages.forEach(() => {
    pageObjectNumbers.push(nextObjectNumber);
    nextObjectNumber += 1;
    contentObjectNumbers.push(nextObjectNumber);
    nextObjectNumber += 1;
  });

  const objects = new Map<number, string>();
  objects.set(1, "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
  objects.set(
    2,
    `2 0 obj\n<< /Type /Pages /Kids [${pageObjectNumbers.map((number) => `${number} 0 R`).join(" ")}] /Count ${pages.length} >>\nendobj\n`
  );
  objects.set(3, "3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj\n");
  objects.set(4, "4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>\nendobj\n");

  pages.forEach((pageLines, index) => {
    const pageObjectNumber = pageObjectNumbers[index];
    const contentObjectNumber = contentObjectNumbers[index];
    const content = buildPdfReportPageStream(pageLines, pageHeight, margin);
    objects.set(
      pageObjectNumber,
      `${pageObjectNumber} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentObjectNumber} 0 R >>\nendobj\n`
    );
    objects.set(
      contentObjectNumber,
      `${contentObjectNumber} 0 obj\n<< /Length ${encodeAscii(content).length} >>\nstream\n${content}\nendstream\nendobj\n`
    );
  });

  const maxObjectNumber = nextObjectNumber - 1;
  const offsets = new Array<number>(maxObjectNumber + 1).fill(0);
  let document = "%PDF-1.4\n% HUB Depto Tributario\n";

  for (let objectNumber = 1; objectNumber <= maxObjectNumber; objectNumber += 1) {
    offsets[objectNumber] = document.length;
    document += objects.get(objectNumber) || `${objectNumber} 0 obj\n<<>>\nendobj\n`;
  }

  const xrefOffset = document.length;
  document += `xref\n0 ${maxObjectNumber + 1}\n0000000000 65535 f \n`;
  for (let objectNumber = 1; objectNumber <= maxObjectNumber; objectNumber += 1) {
    document += `${String(offsets[objectNumber]).padStart(10, "0")} 00000 n \n`;
  }
  document += `trailer\n<< /Size ${maxObjectNumber + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return encodeAscii(document);
}

export function paginatePdfReportLines(lines: PdfReportLine[], pageHeight: number, margin: number) {
  const pages: PdfReportLine[][] = [];
  let page: PdfReportLine[] = [];
  let cursorY = pageHeight - margin;

  lines.forEach((line) => {
    const size = line.size || 9;
    const lineHeight = size + 4;
    if (page.length && cursorY - lineHeight < margin) {
      pages.push(page);
      page = [];
      cursorY = pageHeight - margin;
    }
    page.push(line);
    cursorY -= lineHeight;
  });

  if (page.length) pages.push(page);
  return pages.length ? pages : [[{ text: "Nenhum registro encontrado.", size: 10 }]];
}

export function buildPdfReportPageStream(lines: PdfReportLine[], pageHeight: number, margin: number) {
  let cursorY = pageHeight - margin;
  const commands: string[] = [];

  lines.forEach((line) => {
    const size = line.size || 9;
    const font = line.bold ? "F2" : "F1";
    if (line.text.trim()) {
      commands.push(`BT /${font} ${size} Tf 1 0 0 1 ${margin} ${cursorY.toFixed(2)} Tm <${pdfTextHex(line.text)}> Tj ET`);
    }
    cursorY -= size + 4;
  });

  return commands.join("\n");
}

export function wrapReportText(value: string, maxLength: number) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return [""];

  const lines: string[] = [];
  let current = "";

  normalized.split(" ").forEach((word) => {
    if (!word) return;
    if (word.length > maxLength) {
      if (current) {
        lines.push(current);
        current = "";
      }
      for (let index = 0; index < word.length; index += maxLength) {
        lines.push(word.slice(index, index + maxLength));
      }
      return;
    }

    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > maxLength) {
      lines.push(current);
      current = word;
      return;
    }
    current = candidate;
  });

  if (current) lines.push(current);
  return lines.length ? lines : [normalized.slice(0, maxLength)];
}

export function pdfTextHex(value: string) {
  return Array.from(encodeWinAnsiPdfText(value), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function encodeWinAnsiPdfText(value: string) {
  const fallbackMap: Record<number, number> = {
    0x00a0: 32,
    0x2013: 45,
    0x2014: 45,
    0x2018: 39,
    0x2019: 39,
    0x201c: 34,
    0x201d: 34,
    0x2026: 46,
    0x20ac: 128
  };
  const bytes: number[] = [];
  const normalized = value.replace(/\r?\n/g, " ").replace(/\s+/g, " ").trim();

  for (const character of normalized) {
    const codePoint = character.codePointAt(0) || 0;
    if (codePoint >= 32 && codePoint <= 255) {
      bytes.push(codePoint);
    } else {
      bytes.push(fallbackMap[codePoint] || 63);
    }
  }

  return new Uint8Array(bytes);
}

export function encodeAscii(value: string) {
  const output = new Uint8Array(value.length);
  for (let index = 0; index < value.length; index += 1) {
    output[index] = value.charCodeAt(index) & 0xff;
  }
  return output;
}

export function buildDocxReport(title: string, rows: ReportRow[]) {
  const columns = Object.keys(rows[0] || { Info: "" });
  const generatedAt = new Date().toLocaleString("pt-BR");
  const bodyRows = rows
    .map((row) =>
      `<w:p><w:r><w:t>${escapeXmlText(columns.map((column) => `${column}: ${String(row[column] ?? "")}`).join(" | "))}</w:t></w:r></w:p>`
    )
    .join("");
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:rPr><w:b/></w:rPr><w:t>${escapeXmlText(title)}</w:t></w:r></w:p>
    <w:p><w:r><w:t>Gerado em ${escapeXmlText(generatedAt)} pelo HUB Depto Tributario.</w:t></w:r></w:p>
    ${bodyRows}
    <w:sectPr><w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720"/></w:sectPr>
  </w:body>
</w:document>`;
  const files = [
    {
      name: "[Content_Types].xml",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
</Types>`
    },
    {
      name: "_rels/.rels",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
</Relationships>`
    },
    {
      name: "docProps/core.xml",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>${escapeXmlText(title)}</dc:title>
  <dc:creator>HUB Depto Tributario</dc:creator>
  <dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString()}</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">${new Date().toISOString()}</dcterms:modified>
</cp:coreProperties>`
    },
    {
      name: "word/document.xml",
      data: documentXml
    }
  ];

  return createZipArchive(files.map((file) => ({ name: file.name, data: encodeUtf8(file.data) })));
}

export function buildReportHtml(title: string, rows: ReportRow[], printable: boolean) {
  const columns = Object.keys(rows[0] || { Info: "" });
  const generatedAt = new Date().toLocaleString("pt-BR");
  const tableHead = columns.map((column) => `<th>${escapeHtmlText(column)}</th>`).join("");
  const tableRows = rows
    .map((row) => `<tr>${columns.map((column) => `<td>${escapeHtmlText(String(row[column] ?? ""))}</td>`).join("")}</tr>`)
    .join("");

  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtmlText(title)}</title>
  <style>
    body { font-family: Arial, sans-serif; color: #17211c; margin: 24px; font-size: 12pt; line-height: 1.45; }
    h1 { font-size: 18pt; margin: 0 0 6px; }
    p { color: #64716b; margin: 0 0 18px; }
    table { border-collapse: collapse; width: 100%; font-size: 11pt; line-height: 1.35; }
    th, td { border: 1px solid #dce3dd; padding: 8px; text-align: left; vertical-align: top; white-space: pre-wrap; }
    th { background: #eef2ed; }
    ${printable ? "@page { size: A4 landscape; margin: 14mm; }" : ""}
  </style>
</head>
<body>
  <h1>${escapeHtmlText(title)}</h1>
  <p>Gerado em ${escapeHtmlText(generatedAt)} pelo HUB Depto Tributario.</p>
  <table>
    <thead><tr>${tableHead}</tr></thead>
    <tbody>${tableRows}</tbody>
  </table>
</body>
</html>`;
}

export function buildXlsxWorkbook(title: string, rows: ReportRow[]) {
  const columns = Object.keys(rows[0] || { Info: "" });
  const generatedAt = new Date().toLocaleString("pt-BR");
  const worksheetRows = [
    columns,
    ...rows.map((row) => columns.map((column) => row[column] ?? ""))
  ];
  const columnWidths = columns.map((column, columnIndex) => {
    const widest = worksheetRows.reduce((width, row) => {
      const value = String(row[columnIndex] ?? "");
      return Math.max(width, Math.min(58, value.length + 3));
    }, Math.max(12, column.length + 3));
    return widest;
  });
  const sheetData = worksheetRows
    .map((row, rowIndex) => {
      const rowNumber = rowIndex + 1;
      const cells = row
        .map((value, columnIndex) => {
          const cellRef = `${getSpreadsheetColumnName(columnIndex + 1)}${rowNumber}`;
          const style = rowIndex === 0 ? " s=\"1\"" : "";
          return `<c r="${cellRef}"${style} t="inlineStr"><is><t>${escapeXmlText(String(value ?? ""))}</t></is></c>`;
        })
        .join("");
      return `<row r="${rowNumber}">${cells}</row>`;
    })
    .join("");
  const cols = columnWidths
    .map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`)
    .join("");
  const usedRange = `A1:${getSpreadsheetColumnName(Math.max(1, columns.length))}${Math.max(1, worksheetRows.length)}`;
  const worksheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
  <sheetFormatPr defaultRowHeight="18"/>
  <cols>${cols}</cols>
  <sheetData>${sheetData}</sheetData>
  <autoFilter ref="${usedRange}"/>
</worksheet>`;
  const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <fileVersion appName="xl"/>
  <sheets><sheet name="${escapeXmlAttribute(getSpreadsheetSheetName(title))}" sheetId="1" r:id="rId1"/></sheets>
</workbook>`;
  const files = [
    {
      name: "[Content_Types].xml",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`
    },
    {
      name: "_rels/.rels",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`
    },
    {
      name: "docProps/app.xml",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>HUB Depto Tributario</Application>
  <DocSecurity>0</DocSecurity>
  <ScaleCrop>false</ScaleCrop>
  <HeadingPairs><vt:vector size="2" baseType="variant"><vt:variant><vt:lpstr>Worksheets</vt:lpstr></vt:variant><vt:variant><vt:i4>1</vt:i4></vt:variant></vt:vector></HeadingPairs>
  <TitlesOfParts><vt:vector size="1" baseType="lpstr"><vt:lpstr>${escapeXmlText(getSpreadsheetSheetName(title))}</vt:lpstr></vt:vector></TitlesOfParts>
</Properties>`
    },
    {
      name: "docProps/core.xml",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>${escapeXmlText(title)}</dc:title>
  <dc:creator>HUB Depto Tributario</dc:creator>
  <cp:lastModifiedBy>HUB Depto Tributario</cp:lastModifiedBy>
  <dc:description>Relatorio gerado em ${escapeXmlText(generatedAt)}</dc:description>
  <dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString()}</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">${new Date().toISOString()}</dcterms:modified>
</cp:coreProperties>`
    },
    {
      name: "xl/workbook.xml",
      data: workbookXml
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`
    },
    {
      name: "xl/styles.xml",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
  <fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEFF3EF"/><bgColor indexed="64"/></patternFill></fill></fills>
  <borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`
    },
    {
      name: "xl/worksheets/sheet1.xml",
      data: worksheetXml
    }
  ];

  return createZipArchive(files.map((file) => ({ name: file.name, data: encodeUtf8(file.data) })));
}

export function getSpreadsheetColumnName(index: number) {
  let name = "";
  let current = index;
  while (current > 0) {
    current -= 1;
    name = String.fromCharCode(65 + (current % 26)) + name;
    current = Math.floor(current / 26);
  }
  return name || "A";
}

export function getSpreadsheetSheetName(title: string) {
  const clean = title.replace(/[:\\/?*\[\]]/g, " ").replace(/\s+/g, " ").trim();
  return (clean || "Relatorio").slice(0, 31);
}

export function createZipArchive(files: Array<{ data: Uint8Array; name: string }>) {
  const localChunks: Uint8Array[] = [];
  const centralChunks: Uint8Array[] = [];
  const encodedEntries: Array<{ crc: number; data: Uint8Array; name: Uint8Array; offset: number }> = [];
  let offset = 0;

  for (const file of files) {
    const name = encodeUtf8(file.name);
    const crc = crc32(file.data);
    const localHeader = createZipLocalHeader(name, file.data.length, crc);
    encodedEntries.push({ name, data: file.data, crc, offset });
    localChunks.push(localHeader, file.data);
    offset += localHeader.length + file.data.length;
  }

  const centralDirectoryOffset = offset;
  for (const entry of encodedEntries) {
    const centralHeader = createZipCentralHeader(entry.name, entry.data.length, entry.crc, entry.offset);
    centralChunks.push(centralHeader);
    offset += centralHeader.length;
  }

  const centralDirectorySize = offset - centralDirectoryOffset;
  const endRecord = createZipEndRecord(files.length, centralDirectorySize, centralDirectoryOffset);
  return concatUint8Arrays([...localChunks, ...centralChunks, endRecord]);
}

export function createZipLocalHeader(name: Uint8Array, size: number, crc: number) {
  const header = new Uint8Array(30 + name.length);
  const view = new DataView(header.buffer);
  const { date, time } = getZipDateTime();
  view.setUint32(0, 0x04034b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, 0x0800, true);
  view.setUint16(8, 0, true);
  view.setUint16(10, time, true);
  view.setUint16(12, date, true);
  view.setUint32(14, crc, true);
  view.setUint32(18, size, true);
  view.setUint32(22, size, true);
  view.setUint16(26, name.length, true);
  view.setUint16(28, 0, true);
  header.set(name, 30);
  return header;
}

export function createZipCentralHeader(name: Uint8Array, size: number, crc: number, localHeaderOffset: number) {
  const header = new Uint8Array(46 + name.length);
  const view = new DataView(header.buffer);
  const { date, time } = getZipDateTime();
  view.setUint32(0, 0x02014b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, 20, true);
  view.setUint16(8, 0x0800, true);
  view.setUint16(10, 0, true);
  view.setUint16(12, time, true);
  view.setUint16(14, date, true);
  view.setUint32(16, crc, true);
  view.setUint32(20, size, true);
  view.setUint32(24, size, true);
  view.setUint16(28, name.length, true);
  view.setUint16(30, 0, true);
  view.setUint16(32, 0, true);
  view.setUint16(34, 0, true);
  view.setUint16(36, 0, true);
  view.setUint32(38, 0, true);
  view.setUint32(42, localHeaderOffset, true);
  header.set(name, 46);
  return header;
}

export function createZipEndRecord(entryCount: number, centralDirectorySize: number, centralDirectoryOffset: number) {
  const record = new Uint8Array(22);
  const view = new DataView(record.buffer);
  view.setUint32(0, 0x06054b50, true);
  view.setUint16(4, 0, true);
  view.setUint16(6, 0, true);
  view.setUint16(8, entryCount, true);
  view.setUint16(10, entryCount, true);
  view.setUint32(12, centralDirectorySize, true);
  view.setUint32(16, centralDirectoryOffset, true);
  view.setUint16(20, 0, true);
  return record;
}

export function getZipDateTime() {
  const now = new Date();
  const time = (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2);
  const date = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  return { date, time };
}

export function concatUint8Arrays(chunks: Uint8Array[]) {
  const totalLength = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const output = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

export function encodeUtf8(value: string) {
  return new TextEncoder().encode(value);
}

export const CRC32_TABLE = buildCrc32Table();

export function buildCrc32Table() {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let crc = index;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
    table[index] = crc >>> 0;
  }
  return table;
}

export function crc32(data: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function escapeXmlText(value: string) {
  return value
    .replace(/[^\u0009\u000a\u000d\u0020-\ud7ff\ue000-\ufffd]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function escapeXmlAttribute(value: string) {
  return escapeXmlText(value).replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

export function escapeHtmlText(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
