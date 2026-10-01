/* BascatQuiz · arranque: con código en la dirección (#ABCDE) es un móvil de jugador; sin código, el staff prepara y juega */
(function () {
  'use strict';
  const BQ = window.BQ;
  const h = decodeURIComponent(location.hash.replace(/^#/, ''));
  const m = h.match(/^([A-Za-z0-9]{5})(?:\.(local))?$/), inv = h.match(/^staff-([A-Za-z0-9_-]+)$/);
  if (inv) { // enlace de invitación del staff: queda conectado a GitHub y se quita el token de la dirección
    const ok = BQ.gh.acceptInvite(inv[1]); history.replaceState(null, '', location.pathname + location.search); BQ.E.boot({ invited: ok });
  }
  else if (m) BQ.P.boot(m[1], m[2] ? 'local' : 'supa');
  else if (/^(jugar|join|entrar|j)$/i.test(h)) BQ.P.boot('', 'supa');
  else if (window.matchMedia('(max-width: 760px)').matches && !BQ.store.get('quizzes', []).length) chooser();
  else BQ.E.boot();
  window.addEventListener('hashchange', () => location.reload());

  // móvil sin código: lo normal es que sea un jugador que ha escrito la dirección a mano
  function chooser() {
    document.getElementById('app').innerHTML = `<div class="pl"><div class="pbar"><span class="brand">Bascat<span>Quiz</span></span></div><div class="pbody"><div class="center">
      <h1>BascatQuiz</h1><div class="sub">Clips de partido, preguntes i rànquing en directe</div>
      <button class="pbtn" id="cJ" style="width:min(420px,100%)">Entrar a una partida</button>
      <button class="pbtn ghost" id="cS">Sóc del staff: preparar un qüestionari</button></div></div></div>`;
    document.getElementById('cJ').onclick = () => BQ.P.boot('', 'supa');
    document.getElementById('cS').onclick = () => BQ.E.boot();
  }
})();
