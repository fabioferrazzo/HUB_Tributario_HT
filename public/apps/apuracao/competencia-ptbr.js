/*
 * Competência sempre em português (ex.: "Novembro de 2026").
 * O campo é o seletor de mês do próprio navegador, que escreve o mês na língua do navegador
 * ("November 2026" num Chrome em inglês). Aqui o campo continua o mesmo (valor, setas, calendário),
 * só o texto visível passa a ser o português, desenhado por cima.
 */
(function () {
  "use strict";
  var FORMATO = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" });

  var CURTOS = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

  // Três tamanhos, do mais completo ao mais curto: usa o maior que couber no campo.
  function textos(valor) {
    if (!/^\d{4}-\d{2}$/.test(String(valor || ""))) return [];
    var p = String(valor).split("-");
    var ano = Number(p[0]);
    var mes = Number(p[1]);
    var longo = FORMATO.format(new Date(Date.UTC(ano, mes - 1, 1)));
    return [longo.charAt(0).toUpperCase() + longo.slice(1), CURTOS[mes - 1] + "/" + ano, p[1] + "/" + ano];
  }

  function iniciar() {
    var campo = document.getElementById("competenceInput");
    if (!campo || campo.dataset.competenciaPtbr) return;
    campo.dataset.competenciaPtbr = "1";

    var envolto = document.createElement("span");
    envolto.className = "competencia-ptbr";
    campo.parentNode.insertBefore(envolto, campo);
    envolto.appendChild(campo);
    var rotulo = document.createElement("span");
    rotulo.className = "competencia-ptbr__texto";
    rotulo.setAttribute("aria-hidden", "true");
    envolto.appendChild(rotulo);

    function atualizar() {
      var opcoes = textos(campo.value);
      var t = opcoes[0] || "";
      // Lê a cor e a fonte do campo como o tema as define (sem o texto transparente).
      envolto.classList.remove("competencia-ptbr--ativa");
      var estilo = getComputedStyle(campo);
      rotulo.style.color = estilo.color;
      rotulo.style.font = estilo.font;
      rotulo.style.left = parseFloat(estilo.borderLeftWidth || 0) + parseFloat(estilo.paddingLeft || 0) + "px";
      // Mesmo fundo do campo (o texto fica por cima dele), sem cobrir as bordas.
      rotulo.style.backgroundColor = estilo.backgroundColor;
      rotulo.style.top = (parseFloat(estilo.borderTopWidth) || 0) + "px";
      rotulo.style.bottom = (parseFloat(estilo.borderBottomWidth) || 0) + "px";
      rotulo.textContent = t;
      envolto.classList.toggle("competencia-ptbr--ativa", Boolean(t));
      for (var i = 1; i < opcoes.length && rotulo.scrollWidth > rotulo.clientWidth + 1; i++) rotulo.textContent = opcoes[i];
      campo.setAttribute("aria-label", t ? "Competência: " + t : "Competência");
    }

    // O app troca o valor por código (setas, "Atual", histórico): o texto acompanha.
    var original = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
    Object.defineProperty(campo, "value", {
      configurable: true,
      get: function () {
        return original.get.call(this);
      },
      set: function (v) {
        original.set.call(this, v);
        atualizar();
      }
    });
    campo.addEventListener("input", atualizar);
    campo.addEventListener("change", atualizar);
    window.addEventListener("ht-premium-change", atualizar);
    new MutationObserver(atualizar).observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-theme"] });
    if (window.ResizeObserver) new ResizeObserver(atualizar).observe(envolto);
    atualizar();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", iniciar);
  else iniciar();
})();
