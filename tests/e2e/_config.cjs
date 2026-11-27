// Configuração comum dos testes em navegador.
const fs = require("fs");
const path = require("path");

const chromeCandidates = [
  process.env.CHROME_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium"
].filter(Boolean);

const CHROME = chromeCandidates.find((p) => fs.existsSync(p));
if (!CHROME) throw new Error("Chrome não encontrado. Informe o caminho em CHROME_PATH.");

const BASE = (process.env.HUB_TEST_URL || "http://127.0.0.1:5199").replace(/\/$/, "");
const OUT = path.join(__dirname, ".saida");
fs.mkdirSync(OUT, { recursive: true });

// Desde 27/11/2026 o visual premium é o padrão da equipe. Os testes antigos partem do visual clássico (como quem
// escolheu "Visual clássico"); por isso, em toda página nova, se a preferência ainda não existir, ela começa em
// "0". O teste visual-padrao.cjs confere o padrão novo (HUB_TESTE_PADRAO_PREMIUM=1 desliga este ajuste).
if (process.env.HUB_TESTE_PADRAO_PREMIUM !== "1") {
  const { chromium } = require("playwright-core");
  const marca = Symbol.for("hub.visualClassicoNosTestes");
  if (!chromium[marca]) {
    chromium[marca] = true;
    const script = () => {
      try {
        if (localStorage.getItem("hub_qg_visual_premium") === null) localStorage.setItem("hub_qg_visual_premium", "0");
      } catch (e) {
        /* sem armazenamento */
      }
    };
    const prepararContexto = async (contexto) => {
      await contexto.addInitScript(script);
      return contexto;
    };
    const launchOriginal = chromium.launch.bind(chromium);
    chromium.launch = async (...args) => {
      const browser = await launchOriginal(...args);
      const newContext = browser.newContext.bind(browser);
      const newPage = browser.newPage.bind(browser);
      browser.newContext = async (...a) => prepararContexto(await newContext(...a));
      browser.newPage = async (...a) => {
        const page = await newPage(...a);
        await page.context().addInitScript(script);
        return page;
      };
      return browser;
    };
    if (chromium.launchPersistentContext) {
      const persistente = chromium.launchPersistentContext.bind(chromium);
      chromium.launchPersistentContext = async (...a) => prepararContexto(await persistente(...a));
    }
  }
}

module.exports = { CHROME, BASE, OUT };
