/**
 * HUB Depto Tributário · Registros por e-mail
 * Lê os e-mails dos remetentes autorizados nesta caixa do Gmail e envia cada um à aba Registros do HUB
 * (texto, assunto e anexos). O HUB acha o CNPJ, consulta a Receita, grava os documentos e avisa a coordenação.
 *
 * Configuração (Configurações do projeto > Propriedades do script):
 *   REGISTROS_TOKEN  o mesmo valor da variável REGISTROS_ENTRADA_TOKEN do Netlify (obrigatório)
 *   HUB_URL          endereço do HUB (opcional; padrão abaixo)
 *   REMETENTES       e-mails autorizados separados por vírgula (opcional; padrão abaixo)
 *
 * Primeira vez: rode instalarGatilho() e depois testarConexao().
 */

var HUB_URL_PADRAO = "https://hub-depto-tributario-ht.netlify.app";
var REMETENTES_PADRAO = ["societario.hteixeira@gmail.com", "carlosreis.hteixeira@gmail.com"];
var ROTULO_OK = "HUB-Registrado";
var ROTULO_ERRO = "HUB-Erro";
var LIMITE_TOTAL_ANEXOS = 4 * 1024 * 1024; // a função do HUB aceita até ~6 MB por chamada (base64)
var CHAVE_PROCESSADOS = "processados";
var MAX_PROCESSADOS = 800;

function configuracao_() {
  var props = PropertiesService.getScriptProperties();
  var token = props.getProperty("REGISTROS_TOKEN");
  if (!token) throw new Error("Defina REGISTROS_TOKEN em Configurações do projeto > Propriedades do script.");
  var remetentes = (props.getProperty("REMETENTES") || REMETENTES_PADRAO.join(","))
    .split(/[,;\s]+/)
    .map(function (e) { return e.trim().toLowerCase(); })
    .filter(String);
  return {
    url: (props.getProperty("HUB_URL") || HUB_URL_PADRAO).replace(/\/+$/, "") + "/.netlify/functions/registros",
    token: token,
    remetentes: remetentes
  };
}

function rotulo_(nome) {
  return GmailApp.getUserLabelByName(nome) || GmailApp.createLabel(nome);
}

function lerProcessados_() {
  try {
    return JSON.parse(PropertiesService.getScriptProperties().getProperty(CHAVE_PROCESSADOS) || "[]");
  } catch (e) {
    return [];
  }
}

function gravarProcessados_(lista) {
  PropertiesService.getScriptProperties().setProperty(CHAVE_PROCESSADOS, JSON.stringify(lista.slice(-MAX_PROCESSADOS)));
}

function emailDe_(texto) {
  var t = String(texto || "").toLowerCase();
  var m = t.match(/<([^>]+)>/);
  return (m ? m[1] : t).trim();
}

/** Chamado pelo gatilho a cada 5 minutos. */
function verificarRegistros() {
  var cfg = configuracao_();
  var ok = rotulo_(ROTULO_OK);
  var erro = rotulo_(ROTULO_ERRO);
  var processados = lerProcessados_();
  var consulta = "from:(" + cfg.remetentes.join(" OR ") + ") newer_than:7d";
  var threads = GmailApp.search(consulta, 0, 30);
  var enviados = 0;

  threads.forEach(function (thread) {
    thread.getMessages().forEach(function (msg) {
      var id = msg.getId();
      if (processados.indexOf(id) >= 0) return;
      if (cfg.remetentes.indexOf(emailDe_(msg.getFrom())) < 0) return;

      var anexos = [];
      var ignorados = [];
      var total = 0;
      msg.getAttachments({ includeInlineImages: false }).forEach(function (anexo) {
        var tamanho = anexo.getSize();
        if (total + tamanho > LIMITE_TOTAL_ANEXOS) {
          ignorados.push(anexo.getName());
          return;
        }
        total += tamanho;
        anexos.push({ nome: anexo.getName(), tipo: anexo.getContentType(), base64: Utilities.base64Encode(anexo.getBytes()) });
      });

      var resposta = UrlFetchApp.fetch(cfg.url, {
        method: "post",
        contentType: "application/json",
        headers: { "x-registros-token": cfg.token },
        muteHttpExceptions: true,
        payload: JSON.stringify({
          acao: "entrada-email",
          messageId: id,
          de: msg.getFrom(),
          assunto: msg.getSubject(),
          corpo: String(msg.getPlainBody() || "").slice(0, 20000),
          data: msg.getDate().toISOString(),
          anexos: anexos,
          anexosIgnorados: ignorados
        })
      });

      var codigo = resposta.getResponseCode();
      if (codigo >= 200 && codigo < 300) {
        processados.push(id);
        thread.addLabel(ok);
        thread.removeLabel(erro);
        enviados += 1;
      } else {
        thread.addLabel(erro);
        console.warn("Registros: falha " + codigo + " no e-mail \"" + msg.getSubject() + "\": " + resposta.getContentText().slice(0, 300));
      }
    });
  });

  gravarProcessados_(processados);
  if (enviados) console.log("Registros: " + enviados + " e-mail(s) enviado(s) ao HUB.");
}

/** Cria (ou recria) o gatilho de 5 em 5 minutos. */
function instalarGatilho() {
  ScriptApp.getProjectTriggers().forEach(function (g) {
    if (g.getHandlerFunction() === "verificarRegistros") ScriptApp.deleteTrigger(g);
  });
  ScriptApp.newTrigger("verificarRegistros").timeBased().everyMinutes(5).create();
  rotulo_(ROTULO_OK);
  rotulo_(ROTULO_ERRO);
  console.log("Gatilho instalado: verificarRegistros a cada 5 minutos.");
}

/** Confere o endereço e o token sem criar nada no HUB. */
function testarConexao() {
  var cfg = configuracao_();
  var resposta = UrlFetchApp.fetch(cfg.url, {
    method: "post",
    contentType: "application/json",
    headers: { "x-registros-token": cfg.token },
    muteHttpExceptions: true,
    payload: JSON.stringify({ acao: "entrada-email", messageId: "teste-conexao", de: "teste-conexao@invalido", assunto: "[TESTE] conexão", corpo: "" })
  });
  var texto = resposta.getContentText();
  if (resposta.getResponseCode() === 200 && /ignorado/.test(texto)) {
    console.log("Conexão OK: o HUB aceitou o token (o teste não cria registro).");
  } else {
    console.error("Conexão falhou (" + resposta.getResponseCode() + "): " + texto);
  }
}
