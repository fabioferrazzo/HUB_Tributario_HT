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

module.exports = { CHROME, BASE, OUT };
