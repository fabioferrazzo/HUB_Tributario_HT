export async function helperCapabilities() {
  try {
    const response = await fetch('./api/capabilities', {cache: 'no-store'});
    if (!response.ok) return {available:false};
    return {available:true, ...(await response.json())};
  } catch { return {available:false}; }
}

export async function extractPdfWithLocalHelper(blob, fileName, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 120000);
  try {
    const response = await fetch('./api/extract-pdf', {
      method: 'POST',
      headers: {'Content-Type':'application/pdf','X-File-Name':encodeURIComponent(fileName || 'documento.pdf')},
      body: blob,
      signal: controller.signal,
    });
    if (!response.ok) throw new Error((await response.text()).slice(0, 500) || `HTTP ${response.status}`);
    return await response.json();
  } finally { clearTimeout(timeout); }
}
