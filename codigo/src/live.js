/* BascatQuiz · pantalla del staff: sala de espera con QR, clip hasta la parada, respuestas con tiempo,
   solución, clasificación y podio. El staff decide cuándo pasa cada cosa (botón Siguiente o barra espaciadora). */
(function () {
  'use strict';
  const BQ = window.BQ, { $, $$, esc } = BQ;
  const Live = BQ.Live = {};
  let G = null, conn = null, connOk = false, hb = null, tmr = null, bcT = null, stopSeg = null, slow = false, podT = [];
  const T = (k, v) => BQ.t(G.lang, k, v);
  const q = () => G && G.i >= 0 ? G.qs[G.i] : null;
  const CHECK = '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7"/></svg>';

  // ───────── partida guardada (por si se recarga la página a media partida) ─────────
  const persist = () => { if (G) BQ.store.set('game', G); };
  Live.pending = () => { const g = BQ.store.get('game', null); return g && g.ph !== 'end' && Date.now() - (g.touched || g.started) < 12 * 3600e3 ? g : null; };
  Live.offerResume = () => {
    const g = Live.pending(); if (!g) return;
    const m = BQ.modal('Partida a medias', `<p style="margin:0">Hay una partida sin terminar de «${esc(g.title)}» (código <b>${esc(g.code)}</b>, ${Object.keys(g.players).length} jugadores, ${g.i < 0 ? 'en la sala de espera' : `pregunta ${g.i + 1} de ${g.qs.length}`}). Los móviles siguen dentro si no han cerrado la página.</p>`,
      `<button class="btn danger" data-d>Descartarla</button><button class="btn pri" data-r>Continuar la partida</button>`);
    m.querySelector('[data-d]').onclick = () => { BQ.store.del('game'); m.close(); };
    m.querySelector('[data-r]').onclick = () => { m.close(); BQ.sound.unlock(); resume(g); };
  };

  Live.start = quiz => {
    const qs = quiz.qs.filter(x => x.on).map(x => {
      const c = BQ.clone(x); c.o = BQ.liveOpts(x); return c;
    });
    G = { code: BQ.code(), net: BQ.cfg().net, quizId: quiz.id, title: quiz.title, lang: quiz.lang || 'ca', started: Date.now(), touched: Date.now(), qs, ph: 'lobby', i: -1, players: {}, order: [], ban: [], openAt: 0, closedAt: 0, seq: 0, extra: 0 };
    persist(); mount();
  };
  function resume(g) {
    G = g; if (G.ph === 'q') { G.ph = 'closed'; G.closedAt = Date.now(); scoreQuestion(); }
    mount(); if (G.ph === 'play') startQ(G.i); else if (G.ph === 'closed' || G.ph === 'reveal') showStopFrame();
  }
  function showStopFrame() { const x = q(), s = x && BQ.resolveClip(x.clip); if (s) loadVideo(s.url).then(() => BQ.seek($('#lv'), x.stop == null ? $('#lv').duration : x.stop)).catch(() => { }); }

  // ───────── conexión ─────────
  function connect() {
    if (conn) conn.close();
    conn = BQ.net.open(G.code, G.net, {
      status: (s) => { connOk = s === 'ok'; const p = $('#lConn'); if (p) { p.className = 'pill conn ' + (s === 'ok' ? 'ok' : 'err'); p.textContent = s === 'ok' ? 'Conectado' : 'Sin conexión, reintentando…'; } if (s === 'ok') sendState(); },
      msg: onMsg,
    });
    clearInterval(hb); hb = setInterval(() => sendState(), 2500);
  }
  function stateMsg() {
    const x = q(), m = { c: G.code, s: ++G.seq, ph: G.ph, i: G.i, n: G.qs.length, lang: G.lang };
    if (x && ['play', 'q', 'closed', 'reveal'].includes(G.ph)) m.q = { id: x.id, x: x.text, c: x.ctx, p: x.pts, l: x.lim };
    if (x && ['q', 'closed', 'reveal'].includes(G.ph)) { m.q.o = x.o.map(o => o.t); m.q.k = x.o.map(o => o.i); }
    if (G.ph === 'q') m.r = Math.max(0, G.openAt + (x.lim + G.extra) * 1000 - Date.now());
    if (x && ['q', 'closed'].includes(G.ph)) m.got = G.order.filter(pid => G.players[pid] && G.players[pid].ans[x.id]);
    const showRes = x && ['reveal', 'board', 'end'].includes(G.ph);
    if (showRes) m.ok = x.o.map((o, j) => o.ok ? j : -1).filter(j => j >= 0);
    m.pl = {};
    for (const pid of G.order) { const p = G.players[pid]; if (!p) continue; m.pl[pid] = showRes || G.ph === 'board' || G.ph === 'end' ? [p.score, p.rank, p.last ? p.last.pts : 0, p.last ? p.last.ok : -1, p.streak, p.last ? p.last.o : -1] : [p.score, p.rank]; }
    m.np = G.order.length; if (G.ban.length) m.ban = G.ban;
    return m;
  }
  function sendState() { if (!G || !conn) return; G.touched = Date.now(); conn.send('st', stateMsg()); }
  function sendSoon() { clearTimeout(bcT); bcT = setTimeout(sendState, 180); }
  const cleanName = s => String(s || '').replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁯]/g, '').replace(/\s+/g, ' ').trim().slice(0, 18);
  function onMsg(ev, d) {
    if (!G || !d) return;
    if (ev === 'hi') {
      const pid = String(d.p || '').slice(0, 16), name = cleanName(d.n); if (!pid || !name || G.ban.includes(pid)) { sendSoon(); return; }
      const p = G.players[pid];
      if (p) { if (p.name !== name && !nameTaken(name, pid)) { p.name = name; renderPanel(); } }
      else {
        let nm = name, k = 2; while (nameTaken(nm, pid)) nm = name.slice(0, 15) + ' ' + k++;
        G.players[pid] = { name: nm, score: 0, streak: 0, ans: {}, joined: Date.now(), last: null, rank: G.order.length + 1, prev: G.order.length + 1, tms: 0 };
        G.order.push(pid); BQ.sound.join(); rank(); persist();
        if (G.ph === 'lobby') renderPanel(); updBar();
      }
      sendSoon(); return;
    }
    if (ev === 'an') {
      const x = q(), pid = String(d.p || ''), p = G.players[pid]; if (!x || !p || d.q !== x.id) return;
      const late = G.ph === 'closed' && Date.now() - G.closedAt < 900;
      if (G.ph !== 'q' && !late) { sendSoon(); return; }
      if (p.ans[x.id]) { sendSoon(); return; }
      const o = d.o | 0; if (o < 0 || o >= x.o.length) return;
      const el = Date.now() - G.openAt, ms = BQ.clamp(+d.ms || el, Math.max(0, el - 2500), Math.max(0, el));
      p.ans[x.id] = { o, ms: Math.round(ms) };
      if (late) { scoreOne(x, pid); rank(); }
      persist(); sendSoon(); renderCount();
      if (G.ph === 'q' && G.order.every(id => G.players[id].ans[x.id])) { clearTimeout(tmr); tmr = setTimeout(() => { if (G.ph === 'q') closeQ(); }, 700); }
    }
  }
  const nameTaken = (nm, pid) => G.order.some(id => id !== pid && G.players[id] && G.players[id].name.toLowerCase() === nm.toLowerCase());

  // ───────── puntos y clasificación ─────────
  function scoreOne(x, pid) {
    const p = G.players[pid], a = p.ans[x.id];
    if (p.last && p.last.q === x.id) { if (p.last.ok !== -1 || !a) return; p.streak = p.last.ps; } // ya contado (salvo respuesta que llega justo al cerrar)
    const ps = p.streak, ok = !!(a && x.o[a.o] && x.o[a.o].ok);
    if (x.pts) p.streak = ok ? p.streak + 1 : 0;
    const pts = ok ? BQ.points(x, a.ms, p.streak) : 0;
    if (a) { a.ok = ok; a.pts = pts; if (ok) p.tms += a.ms; }
    p.score += pts; p.last = { q: x.id, pts, ok: a ? (ok ? 1 : 0) : -1, o: a ? a.o : -1, ps };
  }
  function scoreQuestion() { const x = q(); if (!x) return; G.order.forEach(pid => { G.players[pid].prev = G.players[pid].rank; }); G.order.forEach(pid => scoreOne(x, pid)); rank(); }
  function rank() {
    const ids = G.order.filter(id => G.players[id]).sort((a, b) => { const A = G.players[a], B = G.players[b]; return B.score - A.score || A.tms - B.tms || G.order.indexOf(a) - G.order.indexOf(b); });
    ids.forEach((id, i) => { G.players[id].rank = i + 1; });
    return ids;
  }

  // ───────── fases ─────────
  function next() {
    if (!G) return;
    BQ.sound.unlock();
    if (G.ph === 'lobby') startQ(0);
    else if (G.ph === 'play') openQ();
    else if (G.ph === 'q') closeQ();
    else if (G.ph === 'closed') reveal();
    else if (G.ph === 'reveal') board();
    else if (G.ph === 'board') { if (G.i + 1 < G.qs.length) startQ(G.i + 1); else end(); }
    else if (G.ph === 'end') { exit(); BQ.history(0); }
  }
  function startQ(i) {
    G.i = i; G.ph = 'play'; G.extra = 0; slow = false; persist(); sendState(); render();
    const x = q(), v = $('#lv'), src = BQ.resolveClip(x.clip);
    if (!src) { setTimeout(() => { if (G && G.ph === 'play' && q() === x) openQ(); }, 2200); return; }
    loadVideo(src.url).then(() => {
      if (!G || G.ph !== 'play' || q() !== x) return;
      const stop = x.stop == null ? v.duration : Math.min(x.stop, v.duration);
      stopSeg = BQ.playSeg(v, x.from || 0, stop, 1, () => { if (G && G.ph === 'play' && q() === x) openQ(); });
      watchdog(x, v);
    }).catch(() => { $('#lMsg').hidden = false; $('#lMsg').textContent = 'No se puede reproducir el vídeo'; setTimeout(() => { if (G && G.ph === 'play' && q() === x) openQ(); }, 1800); });
  }
  // si el vídeo se queda colgado (red lenta, archivo dañado) la pregunta se abre igualmente
  function watchdog(x, v) {
    let last = v.currentTime, still = 0;
    const iv = setInterval(() => {
      if (!G || G.ph !== 'play' || q() !== x) { clearInterval(iv); return; }
      if (Math.abs(v.currentTime - last) < 0.01) still++; else still = 0; last = v.currentTime;
      if (still >= 8) { clearInterval(iv); BQ.toast('El vídeo no avanza: se abre la pregunta'); openQ(); }
    }, 1000);
  }
  function loadVideo(url) {
    const v = $('#lv'); $('#lMsg').hidden = true;
    return new Promise((res, rej) => {
      if (v._src === url && v.readyState >= 1) return res();
      v._src = url; v.src = url; v.muted = !BQ.cfg().sound;
      const ok = () => { cleanup(); res(); }, ko = () => { cleanup(); rej(new Error('video')); };
      const cleanup = () => { v.removeEventListener('loadedmetadata', ok); v.removeEventListener('error', ko); };
      v.addEventListener('loadedmetadata', ok); v.addEventListener('error', ko);
    });
  }
  function openQ() {
    if (stopSeg) { stopSeg(); stopSeg = null; }
    const x = q(), v = $('#lv');
    if (v && v.src && x.stop != null && Math.abs(v.currentTime - x.stop) > 0.05) { v.pause(); v.currentTime = x.stop; }
    G.ph = 'q'; G.openAt = Date.now(); persist(); sendState(); BQ.sound.open(); render(); runTimer();
  }
  function runTimer() {
    clearInterval(tmr); let lastS = null;
    tmr = setInterval(() => {
      if (!G || G.ph !== 'q') { clearInterval(tmr); return; }
      const x = q(), left = G.openAt + (x.lim + G.extra) * 1000 - Date.now(), s = Math.ceil(left / 1000);
      drawRing(left, (x.lim + G.extra) * 1000);
      if (s !== lastS && s <= 5 && s > 0) BQ.sound.tick(); lastS = s;
      if (left <= 0) closeQ();
    }, 100);
  }
  function closeQ() {
    clearInterval(tmr); clearTimeout(tmr);
    G.ph = 'closed'; G.closedAt = Date.now(); scoreQuestion(); persist(); sendState(); BQ.sound.end(); render();
  }
  function reveal() {
    const x = q(); G.ph = 'reveal'; persist(); sendState(); BQ.sound.reveal(); render();
    playOutcome();
  }
  function playOutcome() {
    const x = q(), v = $('#lv'); if (!x || !v || !v.src || !isFinite(v.duration)) return;
    const stop = x.stop == null ? v.duration : x.stop, to = x.to == null ? v.duration : Math.min(x.to, v.duration);
    if (stopSeg) stopSeg();
    if (to - stop > 0.3) stopSeg = BQ.playSeg(v, stop, to, slow ? 0.5 : 1, null);
    else stopSeg = BQ.playSeg(v, x.from || 0, to, slow ? 0.5 : 0.75, null);
  }
  function board() {
    if (stopSeg) { stopSeg(); stopSeg = null; }
    G.ph = 'board'; persist(); sendState(); render();
    // ir cargando el siguiente clip
    const nx = G.qs[G.i + 1]; if (nx) { const s = BQ.resolveClip(nx.clip); if (s) loadVideo(s.url).then(() => BQ.seek($('#lv'), nx.from || 0)).catch(() => { }); }
  }
  function end() {
    G.ph = 'end'; persist(); sendState(); BQ.sound.fanfare(); render(); saveHistory();
  }
  function saveHistory() {
    const ids = rank(), H = BQ.store.get('hist', []);
    H.unshift({
      date: G.started, title: G.title, code: G.code,
      qs: G.qs.map(x => ({ text: x.text, ctx: x.ctx, opts: x.o.map(o => o.t), ok: x.o.map((o, j) => o.ok ? j : -1).filter(j => j >= 0) })),
      players: ids.map(id => { const p = G.players[id]; return { name: p.name, score: p.score, ans: G.qs.map(x => p.ans[x.id] ? { o: p.ans[x.id].o, ms: p.ans[x.id].ms, ok: !!p.ans[x.id].ok, pts: p.ans[x.id].pts || 0 } : null) }; }),
    });
    BQ.store.set('hist', H.slice(0, 60));
    if (BQ.E.pushResult) BQ.E.pushResult(H[0]);
  }
  async function exit() {
    clearInterval(hb); clearInterval(tmr); clearTimeout(tmr); podT.forEach(clearTimeout);
    if (stopSeg) stopSeg(); if (conn) { conn.close(); conn = null; }
    if (G && G.ph === 'end') BQ.store.del('game');
    G = null; BQ.E.live = false; const l = $('#live'); if (l) l.remove();
    if (document.fullscreenElement) document.exitFullscreen().catch(() => { });
    document.removeEventListener('keydown', onKey);
    BQ.E.refresh && BQ.E.refresh();
  }

  // ───────── pantalla ─────────
  function mount() {
    BQ.E.live = true; if (BQ.E.v) BQ.E.v.pause();
    const old = $('#live'); if (old) old.remove();
    const el = document.createElement('div'); el.className = 'live'; el.id = 'live';
    el.innerHTML = `
<div class="lbar">
  <span class="brand">Bascat<span>Quiz</span></span>
  <span class="pill">Código <b>${esc(G.code)}</b></span>
  <span class="pill num" id="lQn"></span><span class="pill num" id="lNp"></span>
  <span class="pill conn" id="lConn">Conectando…</span>
  <span class="grow"></span>
  <button class="lbtn" id="lSnd"></button><button class="lbtn" id="lFs" title="Pantalla completa (F)">⛶ Pantalla completa</button>
  <div class="menu right" id="lMenu"><button class="lbtn" aria-haspopup="true" aria-label="Más opciones">⋯</button><div class="pop">
    <button data-m="replay">Repetir el clip (R)</button><button data-m="slow">Cámara lenta al enseñar la respuesta</button><button data-m="more">＋10 segundos para responder</button>
    <button data-m="player">Abrir un móvil de prueba en otra pestaña</button><button data-m="copy">Copiar el enlace para los jugadores</button>
    <hr><button data-m="end">Terminar la partida ahora</button><button data-m="exit">Volver al editor</button></div></div>
</div>
<div class="stage" id="stage">
  <div class="qhead" id="lHead"></div>
  <div class="mid"><div id="lLeft"></div><div class="vwrap"><video id="lv" playsinline preload="auto"></video><div class="vmsg" id="lMsg" hidden></div><div class="flash" id="lFlash" hidden></div><div class="expl" id="lExpl" hidden></div></div><div id="lRight"></div></div>
  <div class="tiles" id="lTiles"></div>
  <div class="panel" id="lPanel" hidden></div>
</div>
<div class="lfoot"><span class="hint2" id="lHint"></span><button class="lbtn" id="lPrev" hidden>Repetir clip</button><button class="lbtn pri go" id="lNext">Siguiente ▶</button></div>`;
    document.body.appendChild(el);
    $('#lNext').onclick = next;
    $('#lPrev').onclick = replay;
    $('#lFs').onclick = fullscreen;
    $('#lSnd').onclick = () => { BQ.setCfg({ sound: !BQ.cfg().sound }); $('#lv').muted = !BQ.cfg().sound; updBar(); };
    const menu = $('#lMenu'); menu.querySelector('.lbtn').onclick = e => { e.stopPropagation(); menu.classList.toggle('open'); };
    el.addEventListener('click', e => { if (!e.target.closest('#lMenu .pop')) menu.classList.remove('open'); });
    menu.querySelectorAll('[data-m]').forEach(b => b.onclick = () => { menu.classList.remove('open'); menuAct(b.dataset.m); });
    document.addEventListener('keydown', onKey);
    connect(); render();
    if (G.ph === 'q') runTimer();
  }
  async function menuAct(a) {
    if (a === 'replay') replay();
    else if (a === 'slow') { slow = !slow; BQ.toast(slow ? 'La respuesta se enseñará a cámara lenta' : 'Velocidad normal'); if (G.ph === 'reveal') playOutcome(); }
    else if (a === 'more') { if (G.ph === 'q') { G.extra += 10; persist(); sendState(); BQ.toast('+10 segundos'); } else BQ.toast('Solo mientras se responde'); }
    else if (a === 'player') window.open(BQ.joinUrl(G.code, G.net), '_blank');
    else if (a === 'copy') { const u = BQ.joinUrl(G.code, G.net); try { await navigator.clipboard.writeText(u); BQ.toast('Enlace copiado'); } catch (e) { BQ.toast(u, 8000); } }
    else if (a === 'end') { if (G.ph === 'end') return; if (await BQ.ask('Terminar la partida', 'Se pasa directamente al podio con los puntos de ahora.', 'Terminar', true)) { if (G.ph === 'q') { clearInterval(tmr); G.ph = 'closed'; scoreQuestion(); } end(); } }
    else if (a === 'exit') { if (G.ph !== 'end' && G.ph !== 'lobby' && !await BQ.ask('Volver al editor', 'La partida queda guardada: al volver a abrir esta página podrás continuarla.', 'Salir')) return; if (G.ph === 'lobby') BQ.store.del('game'); exit(); }
  }
  function replay() {
    const x = q(), v = $('#lv'); if (!x || !v || !v.src || !isFinite(v.duration)) return;
    if (stopSeg) stopSeg();
    if (G.ph === 'play') { stopSeg = BQ.playSeg(v, x.from || 0, x.stop == null ? v.duration : x.stop, 1, () => { if (G && G.ph === 'play' && q() === x) openQ(); }); }
    else if (G.ph === 'reveal' || G.ph === 'closed' || G.ph === 'q') { const stop = x.stop == null ? v.duration : x.stop; stopSeg = BQ.playSeg(v, x.from || 0, G.ph === 'reveal' ? (x.to == null ? v.duration : x.to) : stop, slow ? 0.5 : 1, null); }
  }
  function fullscreen() { const l = $('#live'); if (document.fullscreenElement) document.exitFullscreen().catch(() => { }); else if (l && l.requestFullscreen) l.requestFullscreen().catch(() => BQ.toast('Este navegador no deja poner pantalla completa')); }
  function onKey(e) {
    if (!G || $('.modal')) return; const tg = e.target; if (tg && (tg.tagName === 'INPUT' || tg.tagName === 'TEXTAREA')) return;
    if (e.key === ' ' || e.key === 'Enter' || e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); next(); }
    else if (e.key === 'r' || e.key === 'R') replay();
    else if (e.key === 'f' || e.key === 'F') fullscreen();
  }
  function updBar() {
    if (!G) return; const n = G.order.length;
    $('#lQn').textContent = G.i < 0 ? `${G.qs.length} preguntas` : `Pregunta ${G.i + 1} / ${G.qs.length}`;
    $('#lNp').textContent = `${n} ${n === 1 ? 'jugador' : 'jugadores'}`;
    $('#lSnd').textContent = BQ.cfg().sound ? '🔊 Sonido' : '🔇 Sin sonido';
  }
  const HINT = {
    lobby: 'Los jugadores entran con el QR o el código. Toca un nombre para sacarlo de la partida. Cuando estén todos, empieza.',
    play: 'El clip se para solo en el momento elegido. Siguiente = saltar a la parada.',
    q: 'Respondiendo… Puedes repetir el clip mientras tanto. Se cierra al acabar el tiempo o cuando han respondido todos. Siguiente = cerrar ya.',
    closed: 'Respuestas cerradas. Cuando quieras, enseña la respuesta correcta.',
    reveal: 'Se ve cómo acaba la jugada. Repítelo o comenta, y luego pasa a la clasificación.',
    board: 'Clasificación después de esta pregunta.',
    end: 'Partida terminada.',
  };
  const NEXT = { lobby: 'Empezar ▶', play: 'Saltar a la parada ▶', q: 'Cerrar respuestas', closed: 'Mostrar la respuesta ▶', reveal: 'Clasificación ▶', board: 'Siguiente pregunta ▶', end: 'Ver resultados' };

  function render() {
    if (!G || !$('#live')) return; updBar();
    const x = q(), ph = G.ph;
    $('#lHint').textContent = HINT[ph];
    const nb = $('#lNext'); nb.textContent = ph === 'board' && G.i + 1 >= G.qs.length ? 'Podio ▶' : NEXT[ph]; nb.classList.toggle('pulse', ph === 'closed' || (ph === 'lobby' && G.order.length > 0));
    $('#lPrev').hidden = !(ph === 'q' || ph === 'closed' || ph === 'reveal'); // en cuanto el clip ha llegado a la parada
    const panel = $('#lPanel');
    if (ph === 'lobby' || ph === 'board' || ph === 'end') { panel.hidden = false; renderPanel(); }
    else panel.hidden = true;
    if (!x) { $('#lHead').innerHTML = ''; $('#lTiles').innerHTML = ''; $('#lLeft').innerHTML = ''; $('#lRight').innerHTML = ''; return; }
    // cabecera: número, contexto y pregunta
    $('#lHead').innerHTML = `<span class="qn num">${esc(T('qn', { i: G.i + 1, n: G.qs.length }))}</span><span class="qt">${esc(x.text)}</span>${x.pts === 2 ? `<span class="tag">${esc(T('double'))}</span>` : x.pts === 0 ? `<span class="tag">${esc(T('noPts'))}</span>` : ''}${x.ctx ? `<span class="ctx">${esc(x.ctx)}</span>` : ''}`;
    const src = BQ.resolveClip(x.clip); const msg = $('#lMsg');
    if (!src) { msg.hidden = false; msg.textContent = x.ctx || T('qn', { i: G.i + 1, n: G.qs.length }); } else if (ph !== 'play') msg.hidden = true;
    const fl = $('#lFlash');
    if (ph === 'play') { fl.hidden = false; fl.textContent = T('watch'); } else if (ph === 'closed') { fl.hidden = false; fl.textContent = T('timeUp'); } else if (ph === 'reveal' && (x.to == null || x.to - (x.stop || 0) > 0.3)) { fl.hidden = false; fl.textContent = T('outcome'); } else fl.hidden = true;
    const ex = $('#lExpl'); ex.hidden = !(ph === 'reveal' && x.expl); ex.textContent = x.expl || '';
    // lados: tiempo y respuestas recibidas
    if (ph === 'q') { $('#lLeft').innerHTML = `<div class="ring" id="lRing"><svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="44" fill="none" stroke="#3a2c2f" stroke-width="8"/><circle id="lArc" cx="50" cy="50" r="44" fill="none" stroke="#e2b23a" stroke-width="8" stroke-linecap="round" stroke-dasharray="276.5" stroke-dashoffset="0"/></svg><span class="v num" id="lSec"></span></div>`; drawRing(G.openAt + (x.lim + G.extra) * 1000 - Date.now(), (x.lim + G.extra) * 1000); }
    else if (ph === 'closed' || ph === 'reveal') $('#lLeft').innerHTML = `<div class="cnt"><div class="v">0</div><div class="l">${esc(T('timeUp'))}</div></div>`;
    else $('#lLeft').innerHTML = '';
    renderCount();
    // respuestas
    if (ph === 'q' || ph === 'closed' || ph === 'reveal') {
      const counts = x.o.map(() => 0); let tot = 0; G.order.forEach(id => { const a = G.players[id].ans[x.id]; if (a) { counts[a.o]++; tot++; } });
      const max = Math.max(1, ...counts);
      $('#lTiles').innerHTML = x.o.map((o, j) => {
        const rev = ph === 'reveal';
        return `<div class="tile bg${BQ.LETTERS[o.i]} ${rev ? (o.ok ? 'ok' : 'dim') : ''}">${rev ? `<span class="bar" style="width:0" data-w="${(100 * counts[j] / max).toFixed(1)}"></span>` : ''}${BQ.SHAPES[o.i]}<span class="tt">${esc(o.t)}</span>${rev ? `<span class="k num">${counts[j]}${o.ok ? `<span class="chk">${CHECK}</span>` : ''}</span>` : ''}</div>`;
      }).join('');
      $('#lTiles').style.gridTemplateColumns = x.o.length <= 2 ? '1fr 1fr' : '';
      if (ph === 'reveal') requestAnimationFrame(() => $$('#lTiles .bar').forEach(b => { b.style.width = b.dataset.w + '%'; }));
    } else $('#lTiles').innerHTML = '';
  }
  function renderCount() {
    const x = q(); if (!x || !$('#lRight')) return;
    if (G.ph === 'q' || G.ph === 'closed' || G.ph === 'reveal') {
      const a = G.order.filter(id => G.players[id].ans[x.id]).length;
      $('#lRight').innerHTML = `<div class="cnt"><div class="v num">${a}</div><div class="l">${esc(T('answers'))}<br>${esc(T('ofN', { n: G.order.length }))}</div></div>`;
    } else $('#lRight').innerHTML = '';
  }
  function drawRing(left, total) {
    const s = $('#lSec'), arc = $('#lArc'), ring = $('#lRing'); if (!s || !arc) return;
    const f = BQ.clamp(left / total, 0, 1); arc.setAttribute('stroke-dashoffset', String(276.5 * (1 - f)));
    s.textContent = Math.max(0, Math.ceil(left / 1000)); ring.classList.toggle('low', left < 5000);
  }
  function qrSvg(text) {
    if (typeof qrcode === 'undefined') return `<div style="color:#000;padding:10px;text-align:center">${esc(text)}</div>`;
    const qr = qrcode(0, 'M'); qr.addData(text); qr.make(); const n = qr.getModuleCount(); let d = '';
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`;
    return `<svg viewBox="-2 -2 ${n + 4} ${n + 4}" shape-rendering="crispEdges" role="img" aria-label="Código QR para entrar"><rect x="-2" y="-2" width="${n + 4}" height="${n + 4}" fill="#fff"/><path d="${d}" fill="#140e0f"/></svg>`;
  }
  function renderPanel() {
    const p = $('#lPanel'); if (!p || !G) return;
    if (G.ph === 'lobby') {
      const url = BQ.joinUrl(G.code, G.net), base = BQ.prettyUrl(BQ.joinBase(G.net));
      if (!p.querySelector('.lobby')) p.innerHTML = `<div class="lobby"><div class="qr">${qrSvg(url)}</div><div><div class="how">${esc(T('joinAt'))}</div><div class="url">${esc(base)}</div><div class="how">${esc(T('withCode'))}</div><div class="bigcode">${esc(G.code)}</div><div class="np" id="lNp2"></div><div class="names" id="lNames"></div>${G.net === 'local' ? '<p style="color:var(--gold);font:600 14px var(--fb)">Modo ensayo: solo funciona con pestañas de este navegador.</p>' : ''}</div></div>`;
      const n = G.order.length; $('#lNp2').textContent = n ? `${n} ${n === 1 ? T('player1') : T('players')}` : T('waiting');
      const box = $('#lNames'), have = new Set($$('.nm', box).map(b => b.dataset.p));
      G.order.forEach(id => { if (!have.has(id)) { const b = document.createElement('button'); b.className = 'nm'; b.dataset.p = id; b.title = 'Sacar de la partida'; b.textContent = G.players[id].name; b.onclick = () => kick(id); box.appendChild(b); } });
      $$('.nm', box).forEach(b => { if (!G.players[b.dataset.p]) b.remove(); else b.textContent = G.players[b.dataset.p].name; });
      return;
    }
    if (G.ph === 'board') {
      const ids = rank(), top = ids.slice(0, 5), x = q();
      p.innerHTML = `<div class="board"><h2>${esc(T('board'))}</h2>${top.map(id => { const pl = G.players[id], mv = (pl.prev || pl.rank) - pl.rank, d = pl.last && pl.last.q === x.id ? pl.last.pts : 0; return `<div class="brow ${pl.rank === 1 ? 'first' : ''}"><span class="r num">${pl.rank}</span><span class="nm">${esc(pl.name)}</span><span class="d num">${d ? '+' + BQ.fmtN(d) : ''}</span><span class="num">${BQ.fmtN(pl.score)}<span class="mv ${mv > 0 ? 'up' : mv < 0 ? 'dn' : ''}">${mv > 0 ? '▲' + mv : mv < 0 ? '▼' + (-mv) : ''}</span></span></div>`; }).join('') || `<p class="how">${esc(T('waiting'))}</p>`}
        ${ids.length > 5 ? `<p style="text-align:center;color:var(--stage-muted);font:600 15px var(--fb)">${ids.length - 5} más · cada uno ve su puesto en el móvil</p>` : ''}</div>`;
      return;
    }
    if (G.ph === 'end') {
      const ids = rank(), pod = [ids[1], ids[0], ids[2]];
      p.innerHTML = `<div class="board" style="width:min(1100px,100%)"><h2>${esc(T('podium'))}</h2><div class="podium">${pod.map((id, k) => { const pos = [2, 1, 3][k], pl = id && G.players[id]; return `<div class="pod p${pos}" data-pos="${pos}">${pl ? `<div class="who">${esc(pl.name)}</div><div class="sc num">${BQ.fmtN(pl.score)} ${esc(T('pts'))}</div>` : '<div class="who"></div><div class="sc"></div>'}<div class="blk">${pos}</div></div>`; }).join('')}</div></div>`;
      podT.forEach(clearTimeout); podT = [3, 2, 1].map((pos, k) => setTimeout(() => { const el = p.querySelector(`.pod[data-pos="${pos}"]`); if (el) el.classList.add('on'); }, 400 + k * 1300));
    }
  }
  async function kick(id) {
    const pl = G.players[id]; if (!pl) return;
    if (!await BQ.ask('Sacar de la partida', `¿Sacar a «${pl.name}»? Podrá volver a entrar con otro nombre.`, 'Sacar', true)) return;
    delete G.players[id]; G.order = G.order.filter(x => x !== id); G.ban.push(id); rank(); persist(); sendState(); renderPanel(); updBar();
  }
})();
