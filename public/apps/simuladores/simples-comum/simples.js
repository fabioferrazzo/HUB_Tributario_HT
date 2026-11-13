/*
 * Simples Nacional — tabelas e cálculos compartilhados pelos simuladores do HUB.
 *
 * Fontes (conferidas em 13/11/2026):
 * - Até 2026: LC 123/2006, art. 18 e Anexos I a V na redação da LC 155/2016; Res. CGSN 140/2018, arts. 21 (alíquota
 *   efetiva; RBT12 zero = R$ 1,00; 6ª faixa sem impedimento), 22 (início de atividade), 26 (fator "r"),
 *   27 (alíquota de ISS na retenção) e 60 (crédito de ICMS).
 * - A partir de 2027: Res. CGSN 190/2026 (DOU de 10/08/2026, efeitos em 01/01/2027) — Anexos I a V com CBS e IBS
 *   (tabelas de 2027–2028, 2029, 2030, 2031, 2032 e de 2033 em diante); RBT12 dos 12 meses antecedentes ao mês
 *   anterior ao período de apuração (art. 21, II, a); início de atividade (art. 22, § 2º); ISS limitado e diferença
 *   transferida aos tributos federais e ao IBS (art. 21, III); 6ª faixa com ICMS, ISS e IBS pela 5ª faixa (art. 21, IV);
 *   fator "r" (art. 26); ISS na retenção (art. 27); crédito de ICMS, CBS e IBS ao adquirente (art. 58, §§ 1º-A a 6º).
 *   Observação: no texto publicado, a fórmula do ICMS da 6ª faixa do Anexo II repete números do Anexo III; o cálculo
 *   usa a regra geral do art. 21, IV (5ª faixa do próprio Anexo).
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.SimplesHT = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var LIMITES = [180000, 360000, 720000, 1800000, 3600000, 4800000];
  var NOMES_TRIBUTOS = { IRPJ: "IRPJ", CSLL: "CSLL", COFINS: "Cofins", PIS: "PIS/Pasep", CPP: "CPP", ICMS: "ICMS", IPI: "IPI", ISS: "ISS" };

  // [alíquota nominal %, parcela a deduzir R$] por faixa; partilha em % por faixa (6ª faixa sem ICMS/ISS)
  var ANEXOS = {
    I: {
      nome: "Anexo I — Comércio", local: "ICMS", tributos: ["IRPJ", "CSLL", "COFINS", "PIS", "CPP", "ICMS"],
      faixas: [[4.00, 0], [7.30, 5940], [9.50, 13860], [10.70, 22500], [14.30, 87300], [19.00, 378000]],
      partilha: [
        [5.50, 3.50, 12.74, 2.76, 41.50, 34.00], [5.50, 3.50, 12.74, 2.76, 41.50, 34.00], [5.50, 3.50, 12.74, 2.76, 42.00, 33.50],
        [5.50, 3.50, 12.74, 2.76, 42.00, 33.50], [5.50, 3.50, 12.74, 2.76, 42.00, 33.50], [13.50, 10.00, 28.27, 6.13, 42.10, 0]
      ]
    },
    II: {
      nome: "Anexo II — Indústria", local: "ICMS", tributos: ["IRPJ", "CSLL", "COFINS", "PIS", "CPP", "IPI", "ICMS"],
      faixas: [[4.50, 0], [7.80, 5940], [10.00, 13860], [11.20, 22500], [14.70, 85500], [30.00, 720000]],
      partilha: [
        [5.50, 3.50, 11.51, 2.49, 37.50, 7.50, 32.00], [5.50, 3.50, 11.51, 2.49, 37.50, 7.50, 32.00], [5.50, 3.50, 11.51, 2.49, 37.50, 7.50, 32.00],
        [5.50, 3.50, 11.51, 2.49, 37.50, 7.50, 32.00], [5.50, 3.50, 11.51, 2.49, 37.50, 7.50, 32.00], [8.50, 7.50, 20.96, 4.54, 23.50, 35.00, 0]
      ]
    },
    III: {
      nome: "Anexo III — Serviços", local: "ISS", tributos: ["IRPJ", "CSLL", "COFINS", "PIS", "CPP", "ISS"],
      faixas: [[6.00, 0], [11.20, 9360], [13.50, 17640], [16.00, 35640], [21.00, 125640], [33.00, 648000]],
      partilha: [
        [4.00, 3.50, 12.82, 2.78, 43.40, 33.50], [4.00, 3.50, 14.05, 3.05, 43.40, 32.00], [4.00, 3.50, 13.64, 2.96, 43.40, 32.50],
        [4.00, 3.50, 13.64, 2.96, 43.40, 32.50], [4.00, 3.50, 12.82, 2.78, 43.40, 33.50], [35.00, 15.00, 16.03, 3.47, 30.50, 0]
      ],
      // nota (*) do Anexo III: 5ª faixa com alíquota efetiva acima de 14,92537% — (efetiva − 5%) × percentual; ISS fixo em 5%
      tetoIss: { limite: 14.92537, percentuais: [6.02, 5.26, 19.28, 4.18, 65.26] }
    },
    IV: {
      nome: "Anexo IV — Serviços (§ 5º-C)", local: "ISS", tributos: ["IRPJ", "CSLL", "COFINS", "PIS", "ISS"], semCpp: true,
      faixas: [[4.50, 0], [9.00, 8100], [10.20, 12420], [14.00, 39780], [22.00, 183780], [33.00, 828000]],
      partilha: [
        [18.80, 15.20, 17.67, 3.83, 44.50], [19.80, 15.20, 20.55, 4.45, 40.00], [20.80, 15.20, 19.73, 4.27, 40.00],
        [17.80, 19.20, 18.90, 4.10, 40.00], [18.80, 19.20, 18.08, 3.92, 40.00], [53.50, 21.50, 20.55, 4.45, 0]
      ],
      // nota (*) do Anexo IV: 5ª faixa com alíquota efetiva acima de 12,5%
      tetoIss: { limite: 12.5, percentuais: [31.33, 32.00, 30.13, 6.54] }
    },
    V: {
      nome: "Anexo V — Serviços (§ 5º-I)", local: "ISS", tributos: ["IRPJ", "CSLL", "COFINS", "PIS", "CPP", "ISS"],
      faixas: [[15.50, 0], [18.00, 4500], [19.50, 9900], [20.50, 17100], [23.00, 62100], [30.50, 540000]],
      partilha: [
        [25.00, 15.00, 14.10, 3.05, 28.85, 14.00], [23.00, 15.00, 14.10, 3.05, 27.85, 17.00], [24.00, 15.00, 14.92, 3.23, 23.85, 19.00],
        [21.00, 15.00, 15.74, 3.41, 23.85, 21.00], [23.00, 12.50, 14.10, 3.05, 23.85, 23.50], [35.00, 15.50, 16.44, 3.56, 29.50, 0]
      ]
    }
  };

  var TABELAS_REFORMA = {
    "2027": {
      I: { nome: "Anexo I — Comércio", local: "ICMS", tributos: ["IRPJ", "CSLL", "CBS", "CPP", "ICMS", "IBS"],
      faixas: [[4.00, 0], [7.30, 5940], [9.50, 13860], [10.70, 22500], [14.30, 87300], [18.90, 378000]],
      partilha: [
        [5.50, 3.50, 15.33, 41.50, 34.00, 0.17],
        [5.50, 3.50, 15.33, 41.50, 34.00, 0.17],
        [5.50, 3.50, 15.33, 42.00, 33.50, 0.17],
        [5.50, 3.50, 15.33, 42.00, 33.50, 0.17],
        [5.50, 3.50, 15.33, 42.00, 33.50, 0.17],
        [13.58, 10.06, 34.02, 42.34, 0.00, 0.00]
      ] },
    II: { nome: "Anexo II — Indústria", local: "ICMS", tributos: ["IRPJ", "CSLL", "CBS", "CPP", "IPI", "ICMS", "IBS"],
      faixas: [[4.50, 0], [7.80, 5940], [10.00, 13860], [11.20, 22500], [14.70, 85500], [29.90, 720000]],
      partilha: [
        [5.50, 3.50, 13.85, 37.50, 7.50, 32.00, 0.15],
        [5.50, 3.50, 13.85, 37.50, 7.50, 32.00, 0.15],
        [5.50, 3.50, 13.85, 37.50, 7.50, 32.00, 0.15],
        [5.50, 3.50, 13.85, 37.50, 7.50, 32.00, 0.15],
        [5.50, 3.50, 13.85, 37.50, 7.50, 32.00, 0.15],
        [8.53, 7.53, 25.22, 23.59, 35.13, 0.00, 0.00]
      ] },
    III: { nome: "Anexo III — Serviços", local: "ISS", tributos: ["IRPJ", "CSLL", "CBS", "CPP", "ISS", "IBS"],
      faixas: [[6.00, 0], [11.20, 9360], [13.50, 17640], [16.00, 35640], [21.00, 125640], [32.90, 648000]],
      partilha: [
        [4.00, 3.50, 15.43, 43.40, 33.50, 0.17],
        [4.00, 3.50, 16.91, 43.40, 32.00, 0.19],
        [4.00, 3.50, 16.41, 43.40, 32.50, 0.19],
        [4.00, 3.50, 16.41, 43.40, 32.50, 0.19],
        [4.00, 3.50, 15.43, 43.40, 33.50, 0.17],
        [35.09, 15.04, 19.29, 30.58, 0.00, 0.00]
      ],
      tetoIss: { limite: 14.92537, max: 5, percentuais: [6.02, 5.26, 23.2, 65.26, 0.26] } },
    IV: { nome: "Anexo IV — Serviços (§ 5º-C)", local: "ISS", tributos: ["IRPJ", "CSLL", "CBS", "ISS", "IBS"], semCpp: true,
      faixas: [[4.50, 0], [9.00, 8100], [10.20, 12420], [14.00, 39780], [22.00, 183780], [32.90, 828000]],
      partilha: [
        [18.80, 15.20, 21.26, 44.50, 0.24],
        [19.80, 15.20, 24.73, 40.00, 0.27],
        [20.80, 15.20, 23.74, 40.00, 0.26],
        [17.80, 19.20, 22.75, 40.00, 0.25],
        [18.80, 19.20, 21.76, 40.00, 0.24],
        [53.71, 21.59, 24.70, 0.00, 0.00]
      ],
      tetoIss: { limite: 12.5, max: 5, percentuais: [31.33, 32.0, 36.27, 0.4] } },
    V: { nome: "Anexo V — Serviços (§ 5º-I)", local: "ISS", tributos: ["IRPJ", "CSLL", "CBS", "CPP", "ISS", "IBS"],
      faixas: [[15.50, 0], [18.00, 4500], [19.50, 9900], [20.50, 17100], [23.00, 62100], [30.40, 540000]],
      partilha: [
        [25.00, 15.00, 16.96, 28.85, 14.00, 0.19],
        [23.00, 15.00, 16.96, 27.85, 17.00, 0.19],
        [24.00, 15.00, 17.95, 23.85, 19.00, 0.20],
        [21.00, 15.00, 18.94, 23.85, 21.00, 0.21],
        [23.00, 12.50, 16.96, 23.85, 23.50, 0.19],
        [35.10, 15.54, 19.78, 29.58, 0.00, 0.00]
      ] }
  },
    "2029": {
      I: { nome: "Anexo I — Comércio", local: "ICMS", tributos: ["IRPJ", "CSLL", "CBS", "CPP", "ICMS", "IBS"],
      faixas: [[4.00, 0], [7.30, 5940], [9.50, 13860], [10.70, 22500], [14.30, 87300], [18.90, 378000]],
      partilha: [
        [5.50, 3.50, 15.50, 41.50, 30.60, 3.40],
        [5.50, 3.50, 15.50, 41.50, 30.60, 3.40],
        [5.50, 3.50, 15.50, 42.00, 30.15, 3.35],
        [5.50, 3.50, 15.50, 42.00, 30.15, 3.35],
        [5.50, 3.50, 15.50, 42.00, 30.15, 3.35],
        [13.50, 10.00, 34.40, 42.10, 0.00, 0.00]
      ] },
    II: { nome: "Anexo II — Indústria", local: "ICMS", tributos: ["IRPJ", "CSLL", "CBS", "CPP", "IPI", "ICMS", "IBS"],
      faixas: [[4.50, 0], [7.80, 5940], [10.00, 13860], [11.20, 22500], [14.70, 85500], [30.00, 720000]],
      partilha: [
        [5.50, 3.50, 14.00, 37.50, 7.50, 28.80, 3.20],
        [5.50, 3.50, 14.00, 37.50, 7.50, 28.80, 3.20],
        [5.50, 3.50, 14.00, 37.50, 7.50, 28.80, 3.20],
        [5.50, 3.50, 14.00, 37.50, 7.50, 28.80, 3.20],
        [5.50, 3.50, 14.00, 37.50, 7.50, 28.80, 3.20],
        [8.50, 7.50, 25.50, 23.50, 35.00, 0.00, 0.00]
      ] },
    III: { nome: "Anexo III — Serviços", local: "ISS", tributos: ["IRPJ", "CSLL", "CBS", "CPP", "ISS", "IBS"],
      faixas: [[6.00, 0], [11.20, 9360], [13.50, 17640], [16.00, 35640], [21.00, 125640], [33.00, 648000]],
      partilha: [
        [4.00, 3.50, 15.60, 43.40, 30.15, 3.35],
        [4.00, 3.50, 17.10, 43.40, 28.80, 3.20],
        [4.00, 3.50, 16.60, 43.40, 29.25, 3.25],
        [4.00, 3.50, 16.60, 43.40, 29.25, 3.25],
        [4.00, 3.50, 15.60, 43.40, 30.15, 3.35],
        [35.00, 15.00, 19.50, 30.50, 0.00, 0.00]
      ],
      tetoIss: { limite: 14.92537, max: 4.5, percentuais: [5.73, 5.01, 22.33, 62.13, 4.8] } },
    IV: { nome: "Anexo IV — Serviços (§ 5º-C)", local: "ISS", tributos: ["IRPJ", "CSLL", "CBS", "ISS", "IBS"], semCpp: true,
      faixas: [[4.50, 0], [9.00, 8100], [10.20, 12420], [14.00, 39780], [22.00, 183780], [33.00, 828000]],
      partilha: [
        [18.80, 15.20, 21.50, 40.05, 4.45],
        [19.80, 15.20, 25.00, 36.00, 4.00],
        [20.80, 15.20, 24.00, 36.00, 4.00],
        [17.80, 19.20, 23.00, 36.00, 4.00],
        [18.80, 19.20, 22.00, 36.00, 4.00],
        [53.50, 21.50, 25.00, 0.00, 0.00]
      ],
      tetoIss: { limite: 12.5, max: 4.5, percentuais: [29.38, 30.0, 34.38, 6.25] } },
    V: { nome: "Anexo V — Serviços (§ 5º-I)", local: "ISS", tributos: ["IRPJ", "CSLL", "CBS", "CPP", "ISS", "IBS"],
      faixas: [[15.50, 0], [18.00, 4500], [19.50, 9900], [20.50, 17100], [23.00, 62100], [30.50, 540000]],
      partilha: [
        [25.00, 15.00, 17.15, 28.85, 12.60, 1.40],
        [23.00, 15.00, 17.15, 27.85, 15.30, 1.70],
        [24.00, 15.00, 18.15, 23.85, 17.10, 1.90],
        [21.00, 15.00, 19.15, 23.85, 18.90, 2.10],
        [23.00, 12.50, 17.15, 23.85, 21.15, 2.35],
        [35.00, 15.50, 20.00, 29.50, 0.00, 0.00]
      ] }
  },
    "2030": {
      I: { nome: "Anexo I — Comércio", local: "ICMS", tributos: ["IRPJ", "CSLL", "CBS", "CPP", "ICMS", "IBS"],
      faixas: [[4.00, 0], [7.30, 5940], [9.50, 13860], [10.70, 22500], [14.30, 87300], [18.90, 378000]],
      partilha: [
        [5.50, 3.50, 15.50, 41.50, 27.20, 6.80],
        [5.50, 3.50, 15.50, 41.50, 27.20, 6.80],
        [5.50, 3.50, 15.50, 42.00, 26.80, 6.70],
        [5.50, 3.50, 15.50, 42.00, 26.80, 6.70],
        [5.50, 3.50, 15.50, 42.00, 26.80, 6.70],
        [13.50, 10.00, 34.40, 42.10, 0.00, 0.00]
      ] },
    II: { nome: "Anexo II — Indústria", local: "ICMS", tributos: ["IRPJ", "CSLL", "CBS", "CPP", "IPI", "ICMS", "IBS"],
      faixas: [[4.50, 0], [7.80, 5940], [10.00, 13860], [11.20, 22500], [14.70, 85500], [30.00, 720000]],
      partilha: [
        [5.50, 3.50, 14.00, 37.50, 7.50, 25.60, 6.40],
        [5.50, 3.50, 14.00, 37.50, 7.50, 25.60, 6.40],
        [5.50, 3.50, 14.00, 37.50, 7.50, 25.60, 6.40],
        [5.50, 3.50, 14.00, 37.50, 7.50, 25.60, 6.40],
        [5.50, 3.50, 14.00, 37.50, 7.50, 25.60, 6.40],
        [8.50, 7.50, 25.50, 23.50, 35.00, 0.00, 0.00]
      ] },
    III: { nome: "Anexo III — Serviços", local: "ISS", tributos: ["IRPJ", "CSLL", "CBS", "CPP", "ISS", "IBS"],
      faixas: [[6.00, 0], [11.20, 9360], [13.50, 17640], [16.00, 35640], [21.00, 125640], [33.00, 648000]],
      partilha: [
        [4.00, 3.50, 15.60, 43.40, 26.80, 6.70],
        [4.00, 3.50, 17.10, 43.40, 25.60, 6.40],
        [4.00, 3.50, 16.60, 43.40, 26.00, 6.50],
        [4.00, 3.50, 16.60, 43.40, 26.00, 6.50],
        [4.00, 3.50, 15.60, 43.40, 26.80, 6.70],
        [35.00, 15.00, 19.50, 30.50, 0.00, 0.00]
      ],
      tetoIss: { limite: 14.92537, max: 4, percentuais: [5.46, 4.78, 21.31, 59.29, 9.15] } },
    IV: { nome: "Anexo IV — Serviços (§ 5º-C)", local: "ISS", tributos: ["IRPJ", "CSLL", "CBS", "ISS", "IBS"], semCpp: true,
      faixas: [[4.50, 0], [9.00, 8100], [10.20, 12420], [14.00, 39780], [22.00, 183780], [33.00, 828000]],
      partilha: [
        [18.80, 15.20, 21.50, 35.60, 8.90],
        [19.80, 15.20, 25.00, 32.00, 8.00],
        [20.80, 15.20, 24.00, 32.00, 8.00],
        [17.80, 19.20, 23.00, 32.00, 8.00],
        [18.80, 19.20, 22.00, 32.00, 8.00],
        [53.50, 21.50, 25.00, 0.00, 0.00]
      ],
      tetoIss: { limite: 12.5, max: 4, percentuais: [27.65, 28.24, 32.35, 11.76] } },
    V: { nome: "Anexo V — Serviços (§ 5º-I)", local: "ISS", tributos: ["IRPJ", "CSLL", "CBS", "CPP", "ISS", "IBS"],
      faixas: [[15.50, 0], [18.00, 4500], [19.50, 9900], [20.50, 17100], [23.00, 62100], [30.50, 540000]],
      partilha: [
        [25.00, 15.00, 17.15, 28.85, 11.20, 2.80],
        [23.00, 15.00, 17.15, 27.85, 13.60, 3.40],
        [24.00, 15.00, 18.15, 23.85, 15.20, 3.80],
        [21.00, 15.00, 19.15, 23.85, 16.80, 4.20],
        [23.00, 12.50, 17.15, 23.85, 18.80, 4.70],
        [35.00, 15.50, 20.00, 29.50, 0.00, 0.00]
      ] }
  },
    "2031": {
      I: { nome: "Anexo I — Comércio", local: "ICMS", tributos: ["IRPJ", "CSLL", "CBS", "CPP", "ICMS", "IBS"],
      faixas: [[4.00, 0], [7.30, 5940], [9.50, 13860], [10.70, 22500], [14.30, 87300], [18.90, 378000]],
      partilha: [
        [5.50, 3.50, 15.50, 41.50, 23.80, 10.20],
        [5.50, 3.50, 15.50, 41.50, 23.80, 10.20],
        [5.50, 3.50, 15.50, 42.00, 23.45, 10.05],
        [5.50, 3.50, 15.50, 42.00, 23.45, 10.05],
        [5.50, 3.50, 15.50, 42.00, 23.45, 10.05],
        [13.50, 10.00, 34.40, 42.10, 0.00, 0.00]
      ] },
    II: { nome: "Anexo II — Indústria", local: "ICMS", tributos: ["IRPJ", "CSLL", "CBS", "CPP", "IPI", "ICMS", "IBS"],
      faixas: [[4.50, 0], [7.80, 5940], [10.00, 13860], [11.20, 22500], [14.70, 85500], [30.00, 720000]],
      partilha: [
        [5.50, 3.50, 14.00, 37.50, 7.50, 22.40, 9.60],
        [5.50, 3.50, 14.00, 37.50, 7.50, 22.40, 9.60],
        [5.50, 3.50, 14.00, 37.50, 7.50, 22.40, 9.60],
        [5.50, 3.50, 14.00, 37.50, 7.50, 22.40, 9.60],
        [5.50, 3.50, 14.00, 37.50, 7.50, 22.40, 9.60],
        [8.50, 7.50, 25.50, 23.50, 35.00, 0.00, 0.00]
      ] },
    III: { nome: "Anexo III — Serviços", local: "ISS", tributos: ["IRPJ", "CSLL", "CBS", "CPP", "ISS", "IBS"],
      faixas: [[6.00, 0], [11.20, 9360], [13.50, 17640], [16.00, 35640], [21.00, 125640], [33.00, 648000]],
      partilha: [
        [4.00, 3.50, 15.60, 43.40, 23.45, 10.05],
        [4.00, 3.50, 17.10, 43.40, 22.40, 9.60],
        [4.00, 3.50, 16.60, 43.40, 22.75, 9.75],
        [4.00, 3.50, 16.60, 43.40, 22.75, 9.75],
        [4.00, 3.50, 15.60, 43.40, 23.45, 10.05],
        [35.00, 15.00, 19.50, 30.50, 0.00, 0.00]
      ],
      tetoIss: { limite: 14.92537, max: 3.5, percentuais: [5.23, 4.57, 20.38, 56.69, 13.13] } },
    IV: { nome: "Anexo IV — Serviços (§ 5º-C)", local: "ISS", tributos: ["IRPJ", "CSLL", "CBS", "ISS", "IBS"], semCpp: true,
      faixas: [[4.50, 0], [9.00, 8100], [10.20, 12420], [14.00, 39780], [22.00, 183780], [33.00, 828000]],
      partilha: [
        [18.80, 15.20, 21.50, 31.15, 13.35],
        [19.80, 15.20, 25.00, 28.00, 12.00],
        [20.80, 15.20, 24.00, 28.00, 12.00],
        [17.80, 19.20, 23.00, 28.00, 12.00],
        [18.80, 19.20, 22.00, 28.00, 12.00],
        [53.50, 21.50, 25.00, 0.00, 0.00]
      ],
      tetoIss: { limite: 12.5, max: 3.5, percentuais: [26.11, 26.67, 30.56, 16.67] } },
    V: { nome: "Anexo V — Serviços (§ 5º-I)", local: "ISS", tributos: ["IRPJ", "CSLL", "CBS", "CPP", "ISS", "IBS"],
      faixas: [[15.50, 0], [18.00, 4500], [19.50, 9900], [20.50, 17100], [23.00, 62100], [30.50, 540000]],
      partilha: [
        [25.00, 15.00, 17.15, 28.85, 9.80, 4.20],
        [23.00, 15.00, 17.15, 27.85, 11.90, 5.10],
        [24.00, 15.00, 18.15, 23.85, 13.30, 5.70],
        [21.00, 15.00, 19.15, 23.85, 14.70, 6.30],
        [23.00, 12.50, 17.15, 23.85, 16.45, 7.05],
        [35.00, 15.50, 20.00, 29.50, 0.00, 0.00]
      ] }
  },
    "2032": {
      I: { nome: "Anexo I — Comércio", local: "ICMS", tributos: ["IRPJ", "CSLL", "CBS", "CPP", "ICMS", "IBS"],
      faixas: [[4.00, 0], [7.30, 5940], [9.50, 13860], [10.70, 22500], [14.30, 87300], [18.90, 378000]],
      partilha: [
        [5.50, 3.50, 15.50, 41.50, 20.40, 13.60],
        [5.50, 3.50, 15.50, 41.50, 20.40, 13.60],
        [5.50, 3.50, 15.50, 42.00, 20.10, 13.40],
        [5.50, 3.50, 15.50, 42.00, 20.10, 13.40],
        [5.50, 3.50, 15.50, 42.00, 20.10, 13.40],
        [13.50, 10.00, 34.40, 42.10, 0.00, 0.00]
      ] },
    II: { nome: "Anexo II — Indústria", local: "ICMS", tributos: ["IRPJ", "CSLL", "CBS", "CPP", "IPI", "ICMS", "IBS"],
      faixas: [[4.50, 0], [7.80, 5940], [10.00, 13860], [11.20, 22500], [14.70, 85500], [30.00, 720000]],
      partilha: [
        [5.50, 3.50, 14.00, 37.50, 7.50, 19.20, 12.80],
        [5.50, 3.50, 14.00, 37.50, 7.50, 19.20, 12.80],
        [5.50, 3.50, 14.00, 37.50, 7.50, 19.20, 12.80],
        [5.50, 3.50, 14.00, 37.50, 7.50, 19.20, 12.80],
        [5.50, 3.50, 14.00, 37.50, 7.50, 19.20, 12.80],
        [8.50, 7.50, 25.50, 23.50, 35.00, 0.00, 0.00]
      ] },
    III: { nome: "Anexo III — Serviços", local: "ISS", tributos: ["IRPJ", "CSLL", "CBS", "CPP", "ISS", "IBS"],
      faixas: [[6.00, 0], [11.20, 9360], [13.50, 17640], [16.00, 35640], [21.00, 125640], [33.00, 648000]],
      partilha: [
        [4.00, 3.50, 15.60, 43.40, 20.10, 13.40],
        [4.00, 3.50, 17.10, 43.40, 19.20, 12.80],
        [4.00, 3.50, 16.60, 43.40, 19.50, 13.00],
        [4.00, 3.50, 16.60, 43.40, 19.50, 13.00],
        [4.00, 3.50, 15.60, 43.40, 20.10, 13.40],
        [35.00, 15.00, 19.50, 30.50, 0.00, 0.00]
      ],
      tetoIss: { limite: 14.92537, max: 3, percentuais: [5.01, 4.38, 19.52, 54.32, 16.77] } },
    IV: { nome: "Anexo IV — Serviços (§ 5º-C)", local: "ISS", tributos: ["IRPJ", "CSLL", "CBS", "ISS", "IBS"], semCpp: true,
      faixas: [[4.50, 0], [9.00, 8100], [10.20, 12420], [14.00, 39780], [22.00, 183780], [33.00, 828000]],
      partilha: [
        [18.80, 15.20, 21.50, 26.70, 17.80],
        [19.80, 15.20, 25.00, 24.00, 16.00],
        [20.80, 15.20, 24.00, 24.00, 16.00],
        [17.80, 19.20, 23.00, 24.00, 16.00],
        [18.80, 19.20, 22.00, 24.00, 16.00],
        [53.50, 21.50, 25.00, 0.00, 0.00]
      ],
      tetoIss: { limite: 12.5, max: 3, percentuais: [24.74, 25.26, 28.95, 21.05] } },
    V: { nome: "Anexo V — Serviços (§ 5º-I)", local: "ISS", tributos: ["IRPJ", "CSLL", "CBS", "CPP", "ISS", "IBS"],
      faixas: [[15.50, 0], [18.00, 4500], [19.50, 9900], [20.50, 17100], [23.00, 62100], [30.50, 540000]],
      partilha: [
        [25.00, 15.00, 17.15, 28.85, 8.40, 5.60],
        [23.00, 15.00, 17.15, 27.85, 10.20, 6.80],
        [24.00, 15.00, 18.15, 23.85, 11.40, 7.60],
        [21.00, 15.00, 19.15, 23.85, 12.60, 8.40],
        [23.00, 12.50, 17.15, 23.85, 14.10, 9.40],
        [35.00, 15.50, 20.00, 29.50, 0.00, 0.00]
      ] }
  },
    "2033": {
      I: { nome: "Anexo I — Comércio", local: null, tributos: ["IRPJ", "CSLL", "CBS", "CPP", "IBS"],
      faixas: [[4.00, 0], [7.30, 5940], [9.50, 13860], [10.70, 22500], [14.30, 87300], [18.90, 378000]],
      partilha: [
        [5.50, 3.50, 15.50, 41.50, 34.00],
        [5.50, 3.50, 15.50, 41.50, 34.00],
        [5.50, 3.50, 15.50, 42.00, 33.50],
        [5.50, 3.50, 15.50, 42.00, 33.50],
        [5.50, 3.50, 15.50, 42.00, 33.50],
        [13.50, 10.00, 34.40, 42.10, 0.00]
      ] },
    II: { nome: "Anexo II — Indústria", local: null, tributos: ["IRPJ", "CSLL", "CBS", "CPP", "IPI", "IBS"],
      faixas: [[4.50, 0], [7.80, 5940], [10.00, 13860], [11.20, 22500], [14.70, 85500], [30.00, 720000]],
      partilha: [
        [5.50, 3.50, 14.00, 37.50, 7.50, 32.00],
        [5.50, 3.50, 14.00, 37.50, 7.50, 32.00],
        [5.50, 3.50, 14.00, 37.50, 7.50, 32.00],
        [5.50, 3.50, 14.00, 37.50, 7.50, 32.00],
        [5.50, 3.50, 14.00, 37.50, 7.50, 32.00],
        [8.50, 7.50, 25.50, 23.50, 35.00, 0.00]
      ] },
    III: { nome: "Anexo III — Serviços", local: null, tributos: ["IRPJ", "CSLL", "CBS", "CPP", "IBS"],
      faixas: [[6.00, 0], [11.20, 9360], [13.50, 17640], [16.00, 35640], [21.00, 125640], [33.00, 648000]],
      partilha: [
        [4.00, 3.50, 15.60, 43.40, 33.50],
        [4.00, 3.50, 17.10, 43.40, 32.00],
        [4.00, 3.50, 16.60, 43.40, 32.50],
        [4.00, 3.50, 16.60, 43.40, 32.50],
        [4.00, 3.50, 15.60, 43.40, 33.50],
        [35.00, 15.00, 19.50, 30.50, 0.00]
      ] },
    IV: { nome: "Anexo IV — Serviços (§ 5º-C)", local: null, tributos: ["IRPJ", "CSLL", "CBS", "IBS"], semCpp: true,
      faixas: [[4.50, 0], [9.00, 8100], [10.20, 12420], [14.00, 39780], [22.00, 183780], [33.00, 828000]],
      partilha: [
        [18.80, 15.20, 21.50, 44.50],
        [19.80, 15.20, 25.00, 40.00],
        [20.80, 15.20, 24.00, 40.00],
        [17.80, 19.20, 23.00, 40.00],
        [18.80, 19.20, 22.00, 40.00],
        [53.50, 21.50, 25.00, 0.00]
      ] },
    V: { nome: "Anexo V — Serviços (§ 5º-I)", local: null, tributos: ["IRPJ", "CSLL", "CBS", "CPP", "IBS"],
      faixas: [[15.50, 0], [18.00, 4500], [19.50, 9900], [20.50, 17100], [23.00, 62100], [30.50, 540000]],
      partilha: [
        [25.00, 15.00, 17.15, 28.85, 14.00],
        [23.00, 15.00, 17.15, 27.85, 17.00],
        [24.00, 15.00, 18.15, 23.85, 19.00],
        [21.00, 15.00, 19.15, 23.85, 21.00],
        [23.00, 12.50, 17.15, 23.85, 23.50],
        [35.00, 15.50, 20.00, 29.50, 0.00]
      ] }
  }
};

  var NOMES_TRIBUTOS_2 = { CBS: "CBS", IBS: "IBS" };
  for (var k in NOMES_TRIBUTOS_2) NOMES_TRIBUTOS[k] = NOMES_TRIBUTOS_2[k];
  var ISS_MAX = { "2026": 5, "2027": 5, "2029": 4.5, "2030": 4, "2031": 3.5, "2032": 3, "2033": null };
  var PERIODOS = [
    { id: "2026", rotulo: "Até 2026", anos: "2026" },
    { id: "2027", rotulo: "2027 e 2028", anos: "2027–2028" },
    { id: "2029", rotulo: "2029", anos: "2029" },
    { id: "2030", rotulo: "2030", anos: "2030" },
    { id: "2031", rotulo: "2031", anos: "2031" },
    { id: "2032", rotulo: "2032", anos: "2032" },
    { id: "2033", rotulo: "2033 em diante", anos: "2033+" }
  ];

  function arred(v, casas) { var f = Math.pow(10, casas == null ? 2 : casas); return Math.round((v + Number.EPSILON) * f) / f; }
  function periodoDe(ano) {
    var a = Number(ano);
    if (!Number.isFinite(a) || a <= 2026) return "2026";
    if (a <= 2028) return "2027";
    if (a >= 2033) return "2033";
    return String(Math.floor(a));
  }
  function reforma(ano) { return periodoDe(ano) !== "2026"; }
  function tabela(anexo, ano) {
    var per = periodoDe(ano);
    var cfg = per === "2026" ? ANEXOS[anexo] : TABELAS_REFORMA[per][anexo];
    if (!cfg) throw new Error("Anexo inválido.");
    return cfg;
  }
  function faixaDe(rbt12) { for (var i = 0; i < LIMITES.length; i++) if (rbt12 <= LIMITES[i]) return i; return 5; }
  function efetivaFaixa(rbt12, anexo, faixa, ano) {
    var f = tabela(anexo, ano).faixas[faixa];
    return (rbt12 * f[0] / 100 - f[1]) / rbt12 * 100;
  }
  function fmtPct(v) { return String(v).replace(".", ","); }

  /*
   * Alíquota efetiva e percentuais efetivos por tributo.
   * opcoes: { anexo, rbt12, receita, impedido, ano, primeiraFaixa }
   *  - impedido: ICMS/ISS (e IBS, a partir de 2027) fora do Simples por excesso do sublimite;
   *  - ano: ano do período de apuração (até 2026 = tabelas da LC 155/2016; 2027 em diante = Res. CGSN 190/2026);
   *  - primeiraFaixa: 1º e 2º mês de atividade a partir de 2027 (Res. CGSN 190/2026, art. 22, § 2º, I).
   */
  function calcular(opcoes) {
    var anexo = opcoes.anexo, ano = opcoes.ano, per = periodoDe(ano), cfg = tabela(anexo, ano);
    var avisos = [];
    var rbtInformada = Number(opcoes.rbt12) || 0;
    var rbt12, faixa, efetiva;
    if (opcoes.primeiraFaixa) {
      faixa = 0; rbt12 = rbtInformada > 0 ? rbtInformada : 1; efetiva = cfg.faixas[0][0];
      avisos.push("1º ou 2º mês de atividade: aplicam-se as alíquotas da 1ª faixa (Res. CGSN 190/2026, art. 22, § 2º, I).");
    } else {
      rbt12 = rbtInformada > 0 ? rbtInformada : 1;
      if (rbtInformada <= 0) avisos.push("RBT12 igual a zero: para determinar a alíquota considera-se R$ 1,00 (Res. CGSN 140/2018, art. 21, parágrafo único).");
      if (rbt12 > 4800000) avisos.push("RBT12 acima de R$ 4.800.000,00 (limite do Simples). O cálculo usa a 6ª faixa; confira a situação de exclusão.");
      faixa = faixaDe(rbt12);
      efetiva = efetivaFaixa(rbt12, anexo, faixa, ano);
    }
    var nominal = cfg.faixas[faixa][0], deduzir = cfg.faixas[faixa][1];
    var local = cfg.local, idxLocal = local ? cfg.tributos.indexOf(local) : -1, idxIbs = cfg.tributos.indexOf("IBS");
    var issMax = ISS_MAX[per];
    var linhas = cfg.tributos.map(function (t, i) { return { tributo: t, nome: NOMES_TRIBUTOS[t], reparticao: cfg.partilha[faixa][i], percentual: efetiva * cfg.partilha[faixa][i] / 100 }; });
    var regra = "Alíquota efetiva × percentual de repartição da " + (faixa + 1) + "ª faixa.";
    var localFora = false;

    if (faixa === 4 && cfg.tetoIss && efetiva > cfg.tetoIss.limite) {
      var mx = cfg.tetoIss.max != null ? cfg.tetoIss.max : 5, j = 0;
      linhas.forEach(function (l) {
        if (l.tributo === "ISS") { l.percentual = mx; l.reparticao = null; }
        else { l.reparticao = null; l.percentual = (efetiva - mx) * cfg.tetoIss.percentuais[j++] / 100; }
      });
      regra = "5ª faixa com alíquota efetiva acima de " + fmtPct(cfg.tetoIss.limite) + "%: ISS fixo em " + fmtPct(mx) + "% e (alíquota efetiva − " + fmtPct(mx) + "%) repartida entre os demais tributos (nota do " + cfg.nome.split(" —")[0] + ").";
    } else if (faixa < 5 && local === "ISS" && issMax != null && linhas[idxLocal].percentual > issMax) {
      var excesso = linhas[idxLocal].percentual - issMax, somaOutros = 100 - cfg.partilha[faixa][idxLocal];
      linhas.forEach(function (l, i) { if (i === idxLocal) l.percentual = issMax; else l.percentual += excesso * cfg.partilha[faixa][i] / somaOutros; });
      regra = "ISS limitado a " + fmtPct(issMax) + "%; a diferença vai, proporcionalmente, aos demais tributos (LC 123/2006, art. 18, § 1º-B, I; Res. CGSN 190/2026, art. 21, III).";
    }

    var percentualLocal5 = null;
    if (faixa === 5) {
      var sub = [];
      if (idxLocal >= 0) sub.push(idxLocal);
      if (idxIbs >= 0) sub.push(idxIbs);
      var nomesSub = sub.map(function (i) { return cfg.tributos[i]; }).join(" e ");
      if (sub.length) {
        if (opcoes.impedido) {
          localFora = true;
          sub.forEach(function (i) { linhas[i].percentual = 0; });
          avisos.push(nomesSub + " fora do Simples: a empresa está impedida pelo sublimite e recolhe " + (sub.length > 1 ? "esses tributos" : "o imposto") + " pelo regime normal" + (idxIbs >= 0 ? " (o sublimite alcança também o IBS a partir de 2027)" : "") + ".");
        } else {
          var ef5 = efetivaFaixa(rbt12, anexo, 4, ano);
          percentualLocal5 = ef5;
          sub.forEach(function (i) {
            var p = ef5 * cfg.partilha[4][i] / 100;
            if (cfg.tributos[i] === "ISS" && issMax != null && p > issMax) p = issMax;
            linhas[i].percentual = p;
            linhas[i].reparticao = cfg.partilha[4][i];
          });
          regra = "6ª faixa: tributos federais pela 6ª faixa; " + nomesSub + " pela fórmula da 5ª faixa aplicada à RBT12 (" + (per === "2026" ? "Res. CGSN 140/2018, art. 21, III, b" : "Res. CGSN 190/2026, art. 21, IV") + ")" + (local === "ISS" ? ", com o ISS limitado a " + fmtPct(issMax) + "%" : "") + ".";
          avisos.push("Na 6ª faixa, a alíquota total soma os tributos federais (6ª faixa) com " + nomesSub + " calculados pela 5ª faixa, enquanto a empresa não estiver impedida pelo sublimite.");
        }
      }
    }
    var aliquotaTotal = linhas.reduce(function (s, l) { return s + l.percentual; }, 0);
    var receita = Math.max(0, Number(opcoes.receita) || 0);
    linhas.forEach(function (l) { l.valor = arred(receita * l.percentual / 100); });
    var total = arred(receita * aliquotaTotal / 100);
    // diferença de centavos vai para o tributo com maior percentual (LC 123, art. 18, § 1º-B, II)
    var soma = linhas.reduce(function (s, l) { return s + l.valor; }, 0);
    var dif = arred(total - soma);
    if (dif !== 0 && receita > 0) {
      var maior = linhas.reduce(function (a, b) { return b.percentual > a.percentual ? b : a; });
      maior.valor = arred(maior.valor + dif);
    }
    var pct = function (t) { var l = linhas.filter(function (x) { return x.tributo === t; })[0]; return l ? l.percentual : null; };
    return {
      anexo: anexo, nomeAnexo: cfg.nome, periodo: per, rbt12: rbtInformada, rbt12Calculo: rbt12, faixa: faixa + 1, nominal: nominal, deduzir: deduzir,
      efetiva: efetiva, aliquotaTotal: aliquotaTotal, linhas: linhas, local: local, localFora: localFora,
      percentualLocal: idxLocal >= 0 ? linhas[idxLocal].percentual : null, percentualCbs: pct("CBS"), percentualIbs: pct("IBS"),
      efetiva5aFaixa: percentualLocal5, receita: receita, das: total, regra: regra, avisos: avisos
    };
  }

  // RBT12 de quem tem menos de 13 meses de atividade (até 2026: Res. CGSN 140, art. 22, §§ 2º e 3º)
  function rbt12InicioAtividade(mesesAnteriores, receitaMesesAnteriores, receitaMesAtual) {
    var n = Math.floor(Number(mesesAnteriores) || 0);
    if (n <= 0) return arred((Number(receitaMesAtual) || 0) * 12);
    return arred((Number(receitaMesesAnteriores) || 0) / n * 12);
  }
  // A partir de 2027 (Res. CGSN 190/2026, art. 22, § 2º): 1º e 2º mês = 1ª faixa; do 3º ao 13º mês, média dos meses
  // antecedentes ao mês anterior ao período de apuração × 12.
  function inicioAtividade2027(mesDeAtividade, receitaMesesAntecedentes) {
    var m = Math.floor(Number(mesDeAtividade) || 0);
    if (m <= 2) return { primeiraFaixa: true, meses: 0, rbt12: 0 };
    var n = Math.min(12, m - 2);
    return { primeiraFaixa: false, meses: n, rbt12: arred((Number(receitaMesesAntecedentes) || 0) / n * 12) };
  }

  /*
   * Fator "r" (Res. CGSN 140, art. 26, §§ 6º e 7º; a partir de 2027, Res. CGSN 190/2026, art. 26, § 6º: 0,28 nos 2 primeiros meses).
   * opcoes: { inicioAtividade (mês de início), fs12, rbt12r, fspa, rpar, ano }
   */
  function fatorR(opcoes) {
    var regra;
    var r;
    if (opcoes.inicioAtividade && reforma(opcoes.ano)) {
      r = 0.28; regra = "1º ou 2º mês de atividade: fator “r” = 0,28 (Res. CGSN 190/2026, art. 26, § 6º).";
    } else if (opcoes.inicioAtividade) {
      var fspa = Number(opcoes.fspa) || 0, rpa = Number(opcoes.rpar) || 0;
      if (fspa > 0 && rpa === 0) { r = 0.28; regra = "Mês de início: folha do mês maior que zero e receita do mês igual a zero — fator “r” = 0,28 (art. 26, § 6º, I)."; }
      else if (fspa === 0 && rpa > 0) { r = 0.01; regra = "Mês de início: folha do mês igual a zero — fator “r” = 0,01 (art. 26, § 6º, II)."; }
      else if (fspa > 0 && rpa > 0) { r = fspa / rpa; regra = "Mês de início: folha do mês ÷ receita do mês (art. 26, § 6º, III)."; }
      else { r = 0.01; regra = "Mês de início sem folha e sem receita: tratado como fator “r” = 0,01."; }
    } else {
      var fs = Number(opcoes.fs12) || 0, rb = Number(opcoes.rbt12r) || 0;
      if (fs === 0 && rb === 0) { r = 0.01; regra = "Folha e receita dos 12 meses iguais a zero — fator “r” = 0,01 (art. 26, § 7º, I)."; }
      else if (fs > 0 && rb === 0) { r = 0.28; regra = "Folha maior que zero e receita igual a zero — fator “r” = 0,28 (art. 26, § 7º, II)."; }
      else if (fs === 0 && rb > 0) { r = 0.01; regra = "Folha igual a zero — fator “r” = 0,01 (art. 26, § 7º, IV)."; }
      else { r = fs / rb; regra = "Folha de salários dos 12 meses ÷ receita bruta dos 12 meses (art. 26, § 7º, III)."; }
    }
    return { r: r, anexo: r >= 0.28 ? "III" : "V", regra: regra };
  }

  // Alíquota de ISS a informar na NFS-e para retenção (Res. CGSN 140, art. 27; a partir de 2027 com a redação da Res. CGSN 190/2026)
  function aliquotaRetencaoIss(opcoes) {
    var novo = reforma(opcoes.ano);
    if (opcoes.mesInicio) return { aliquota: 2, regra: novo
      ? "Serviço prestado no mês de início de atividade ou no mês seguinte: alíquota de 2% (art. 27, II, na redação da Res. CGSN 190/2026)."
      : "Serviço prestado no mês de início de atividade: alíquota de 2% (art. 27, II). Diferença apurada depois é recolhida em guia do Município (art. 27, III)." };
    var c = calcular({ anexo: opcoes.anexo, rbt12: opcoes.rbt12, receita: 0, impedido: opcoes.impedido, ano: opcoes.ano });
    if (c.localFora) return { aliquota: null, regra: "Com o ISS fora do Simples (sublimite excedido), a retenção segue a legislação municipal do regime normal." };
    if (c.percentualLocal == null) return { aliquota: null, regra: "A partir de 2033 não há ISS: o imposto é extinto (EC 132/2023, ADCT, art. 129)." };
    return { aliquota: c.percentualLocal, calculo: c, regra: novo
      ? "Percentual efetivo do ISS da faixa a que a empresa está sujeita no mês da prestação (art. 27, I, na redação da Res. CGSN 190/2026)."
      : "Percentual efetivo do ISS da faixa a que a empresa está sujeita no mês anterior ao da prestação (art. 27, I)." };
  }

  // Crédito de ICMS a informar na NF-e (Res. CGSN 140, art. 60; a partir de 2027, art. 58, §§ 1º-A e 1º-B, na redação da Res. CGSN 190/2026)
  function creditoIcms(opcoes) {
    var novo = reforma(opcoes.ano);
    if (opcoes.primeirosMeses) {
      var c1 = calcular({ anexo: opcoes.anexo === "II" ? "II" : "I", rbt12: 0, receita: 0, ano: opcoes.ano, primeiraFaixa: true });
      var a = c1.percentualLocal == null ? null : arred(c1.percentualLocal, 4);
      if (a == null) return { aliquota: null, regra: "A partir de 2033 não há ICMS (EC 132/2023, ADCT, art. 129)." };
      return { aliquota: a, regra: novo
        ? "Operação no mês de início de atividade: percentual de ICMS da menor alíquota do Anexo (art. 58, § 1º-B)."
        : "Operação nos 2 primeiros meses de atividade: " + fmtPct(a) + "% (" + (opcoes.anexo === "II" ? "produtos industrializados" : "revenda de mercadorias") + ", art. 60, § 3º)." };
    }
    var c = calcular({ anexo: opcoes.anexo, rbt12: opcoes.rbt12, receita: 0, impedido: opcoes.impedido, ano: opcoes.ano });
    if (c.localFora) return { aliquota: null, regra: "Com o ICMS fora do Simples (sublimite excedido), o crédito segue o regime normal do ICMS." };
    if (c.percentualLocal == null) return { aliquota: null, regra: "A partir de 2033 não há ICMS (EC 132/2023, ADCT, art. 129)." };
    return { aliquota: c.percentualLocal, calculo: c, regra: novo
      ? "Percentual efetivo do ICMS da faixa a que a empresa está sujeita no mês da operação (art. 58, § 1º-A, na redação da Res. CGSN 190/2026)."
      : "Percentual efetivo do ICMS da faixa a que a empresa está sujeita no mês anterior ao da operação (art. 60, § 1º)." };
  }

  // Crédito de CBS e IBS do adquirente (a partir de 2027: LC 123/2006, art. 23, § 1º-A; Res. CGSN 190/2026, art. 58, §§ 4º a 6º)
  function creditoCbsIbs(opcoes) {
    if (!reforma(opcoes.ano)) return { cbs: null, ibs: null, regra: "Até 2026 não há CBS e IBS no Simples; o adquirente segue com os créditos de PIS/Cofins da legislação própria." };
    var c = opcoes.mesInicio
      ? calcular({ anexo: opcoes.anexo, rbt12: 0, receita: 0, ano: opcoes.ano, primeiraFaixa: true })
      : calcular({ anexo: opcoes.anexo, rbt12: opcoes.rbt12, receita: 0, impedido: opcoes.impedido, ano: opcoes.ano });
    var ibs = c.percentualIbs, regra = opcoes.mesInicio
      ? "Operação no mês de início de atividade: percentuais de CBS e IBS da menor alíquota do Anexo (art. 58, § 6º)."
      : "Percentuais efetivos de CBS e IBS da faixa a que a empresa está sujeita no mês da operação (art. 58, § 5º).";
    if (c.localFora) { ibs = null; regra += " IBS fora do Simples (sublimite excedido): o crédito de IBS segue o regime regular."; }
    return { cbs: c.percentualCbs, ibs: ibs, calculo: c, regra: regra };
  }

  return { LIMITES: LIMITES, ANEXOS: ANEXOS, TABELAS_REFORMA: TABELAS_REFORMA, PERIODOS: PERIODOS, ISS_MAX: ISS_MAX, NOMES_TRIBUTOS: NOMES_TRIBUTOS,
    periodoDe: periodoDe, reforma: reforma, tabela: tabela, calcular: calcular, faixaDe: faixaDe, efetivaFaixa: efetivaFaixa,
    rbt12InicioAtividade: rbt12InicioAtividade, inicioAtividade2027: inicioAtividade2027, fatorR: fatorR,
    aliquotaRetencaoIss: aliquotaRetencaoIss, creditoIcms: creditoIcms, creditoCbsIbs: creditoCbsIbs, arred: arred };
});
