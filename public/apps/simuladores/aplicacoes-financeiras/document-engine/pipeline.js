import { extractPdfTextLite } from './pdf-lite.js';
import { extractPdfWithLocalHelper, helperCapabilities } from './local-helper.js';
import { normalizeDocumentText } from './text-utils.js';
import { BANK_CATALOG, identifyInstitution } from './bank-catalog.js';
import { classifyDocument } from './classifier.js';
import { processByTemplate } from './template-registry.js';


function digits(value) { return String(value || '').replace(/\D/g, ''); }
function documentCnpjs(text) {
  const pattern = /\b\d{2}[.\s]?\d{3}[.\s]?\d{3}[\/]?\d{4}[-\s]?\d{2}\b/g;
  return [...new Set((String(text || '').match(pattern) || []).map(digits).filter(value => value.length === 14))];
}


function clientIdentityIssue({projectId, document, text, projectCnpj}) {
  const expected = digits(projectCnpj);
  const found = documentCnpjs(text);
  if (expected.length !== 14 || !found.length || found.includes(expected)) return null;
  return {
    id: `issue-client-identity-${document.id}`,
    projectId,
    documentId: document.id,
    positionId: null,
    severity: 'REVIEW',
    title: 'CNPJ do projeto não localizado no documento',
    details: `O projeto está cadastrado com CNPJ ${projectCnpj}, mas os CNPJs reconhecidos no arquivo foram ${found.join(', ')}. Confirme se o documento pertence à empresa antes de aprovar os dados.`,
    status: 'OPEN',
  };
}
export async function extractPdfLocally(blob, fileName, options = {}) {
  const capability = await helperCapabilities();
  if (capability.available && capability.pdfText) {
    try {
      return {...await extractPdfWithLocalHelper(blob, fileName, options), helper: capability};
    } catch (error) {
      const fallback = await extractPdfTextLite(blob);
      fallback.warnings = [...(fallback.warnings || []), `Helper local falhou: ${error.message}`];
      return fallback;
    }
  }
  const fallback = await extractPdfTextLite(blob);
  if (fallback.imageOnly) fallback.warnings = [...(fallback.warnings || []), 'O PDF parece digitalizado. Inicie o app pelo lançador local com Tesseract instalado para habilitar OCR offline.'];
  return fallback;
}

function bankOverride(document, detected, customTemplates = []) {
  const metadata = document.metadata || {};
  if (!metadata.bankOverrideId && !metadata.bankOverrideName) return detected;
  const known = BANK_CATALOG.find(item => item.id === metadata.bankOverrideId);
  if (known) return {...known, confidence: 1, source: 'USER_OVERRIDE'};
  const id = String(metadata.bankOverrideId || '').trim().slice(0, 80) || `bank-custom-${document.id.slice(-12)}`;
  const templateName = (customTemplates || []).find(item => String(item?.institutionId || '').trim() === id)?.institutionName;
  const name = String(metadata.bankOverrideName || templateName || metadata.bankOverrideId || '').trim().slice(0, 120);
  if (!name) return detected;
  return {id, name, patterns: [], confidence: 1, source: 'USER_OVERRIDE'};
}

function classificationOverride(document, detected) {
  const kind = document.metadata?.documentKindOverride;
  return kind ? {kind, confidence: 1, reasons: ['Classificação informada pelo usuário']} : detected;
}

export async function processFinancialDocument({projectId, document, options = {}}) {
  let extraction;
  if (/pdf/i.test(document.mimeType) || /\.pdf$/i.test(document.fileName)) {
    extraction = await extractPdfLocally(document.blob, document.fileName, options);
  } else {
    const text = typeof document.blob?.text === 'function' ? await document.blob.text() : String(document.text || '');
    extraction = {pages: [{pageNumber: 1, text, method: 'PLAIN_TEXT'}], fullText: text, method: 'PLAIN_TEXT', quality: 1, warnings: []};
  }
  const text = normalizeDocumentText(extraction.fullText || '');
  const detectedBank = identifyInstitution({fileName: document.fileName, text});
  const bank = bankOverride(document, detectedBank, options.customTemplates || []);
  const detectedClassification = classifyDocument({fileName: document.fileName, text});
  const classification = classificationOverride(document, detectedClassification);
  const parsed = processByTemplate({projectId, documentId: document.id, document, fileName: document.fileName, text, bank, classification, method: extraction.method, pages: extraction.pages, forcedTemplateId: options.forcedTemplateId || null, positionIdOverride: options.positionIdOverride || null}, options.customTemplates || []);
  const identityIssue = clientIdentityIssue({projectId, document, text, projectCnpj: options.projectCnpj});
  if (identityIssue) parsed.issues = [...(parsed.issues || []), identityIssue];
  return {
    extraction: {...extraction, pageCount: extraction.pages?.length || 0},
    bank,
    classification,
    detectedBank,
    detectedClassification,
    ...parsed,
  };
}
