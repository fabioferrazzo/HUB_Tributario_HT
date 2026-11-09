// Aplica o tema salvo ANTES de desenhar a página (evita piscar claro -> escuro).
// 'claro' | 'escuro' ficam em data-tema no <html>; sem valor = automático (segue o Windows).
(function () {
  try {
    var t = localStorage.getItem('htferias-tema');
    if (t === 'claro' || t === 'escuro') document.documentElement.setAttribute('data-tema', t);
  } catch (e) { /* navegador sem localStorage: fica no automático */ }
})();
