/* BascatQuiz · móvil del jugador: entrar con el nombre, responder, ver si ha acertado y en qué puesto va */
(function () {
  'use strict';
  const BQ = window.BQ, { $, esc } = BQ;
  const P = BQ.P = {};
  let code = '', net = 'supa', pid = '', name = '', conn = null, st = null, lastSeq = -1, joined = false, shown = '', hiT = 0, seenAt = {}, deadline = {}, mine = {}, resendT = null, gotState = false, wake = null, connState = '', lostT = null;
  const lang = () => (st && st.lang) || BQ.store.get('plang', 'ca');
  const T = (k, v) => BQ.t(lang(), k, v);

  P.boot = (c, n) => {
    code = (c || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5); net = n || 'supa';
    pid = BQ.store.get('pid', null); if (!pid) { pid = BQ.uid(10); BQ.store.set('pid', pid); }
    name = BQ.store.get('name', '');
    document.title = 'BascatQuiz · ' + (code || 'Entrar');
    $('#app').innerHTML = `<div class="pl"><div class="pbar"><span class="brand">Bascat<span>Quiz</span></span><span class="me" id="pMe"></span></div><div class="pbody" id="pBody"></div><div class="note" style="padding:0 16px calc(12px + env(safe-area-inset-bottom,0px))"><span class="conn" id="pConn" hidden></span></div></div>`;
    const last = BQ.store.get('joined', null);
    if (code && name && last && last.code === code && Date.now() - last.t < 6 * 3600e3) join(); else joinForm();
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && joined) { lockScreen(); if (conn && st) sendHi(true); } });
  };

  function joinForm(err) {
    joined = false; shown = 'join';
    $('#pMe').textContent = '';
    $('#pBody').innerHTML = `<div class="center"><h1>${esc(T('join'))}</h1>
      <form id="pForm" autocomplete="off" novalidate>
        <div><label for="pCode">${esc(T('code'))}</label><input id="pCode" class="code" inputmode="text" maxlength="5" autocapitalize="characters" spellcheck="false" value="${esc(code)}"></div>
        <div><label for="pName">${esc(T('name'))}</label><input id="pName" maxlength="18" placeholder="${esc(T('namePh'))}" value="${esc(name)}" autocapitalize="words" spellcheck="false"></div>
        <div class="err" id="pErr">${esc(err || '')}</div>
        <button class="pbtn" type="submit">${esc(T('enter'))}</button></form></div>`;
    const f = $('#pForm'); setTimeout(() => (code ? $('#pName') : $('#pCode')).focus(), 50);
    f.onsubmit = e => {
      e.preventDefault();
      const c = $('#pCode').value.toUpperCase().replace(/[^A-Z0-9]/g, ''), nm = $('#pName').value.replace(/\s+/g, ' ').trim();
      if (c.length !== 5) { $('#pErr').textContent = T('notFound', { c: c || '—' }).split('.')[0]; return; }
      if (!nm) { $('#pErr').textContent = T('nameTaken'); $('#pName').focus(); return; }
      if (c !== code) { code = c; st = null; lastSeq = -1; gotState = false; if (conn) { conn.close(); conn = null; } }
      name = nm; BQ.store.set('name', name); join();
    };
  }
  function join() {
    joined = true; BQ.store.set('joined', { code, t: Date.now() }); lockScreen();
    $('#pMe').innerHTML = `<span class="nm">${esc(name)}</span>`;
    if (!gotState) screen('connecting', `<div class="center"><div class="spin"></div><div class="sub">${esc(T('connecting'))}</div></div>`);
    if (!conn) conn = BQ.net.open(code, net, { status: onStatus, msg: onMsg });
    sendHi(true);
    clearTimeout(lostT); lostT = setTimeout(() => { if (!gotState && joined) screen('nf', `<div class="center"><div class="spin"></div><div class="sub">${esc(T('notFound', { c: code }))}</div><button class="pbtn ghost" id="pBack">${esc(T('otherName'))}</button></div>`, () => { $('#pBack').onclick = () => joinForm(); }); }, 9000);
  }
  async function lockScreen() { try { if ('wakeLock' in navigator && document.visibilityState === 'visible') wake = await navigator.wakeLock.request('screen'); } catch (e) { wake = null; } }
  function onStatus(s) {
    connState = s; const el = $('#pConn'); if (!el) return;
    el.hidden = s === 'ok' && gotState; el.className = 'conn ' + (s === 'ok' ? 'ok' : 'err'); el.textContent = s === 'ok' ? '' : T('connErr');
    if (s === 'ok') sendHi(true);
  }
  function sendHi(force) { if (!conn || !joined) return; const now = Date.now(); if (!force && now - hiT < 2000) return; hiT = now; conn.send('hi', { p: pid, n: name }); }

  function onMsg(ev, d) {
    if (ev !== 'st' || !d || d.c !== code) return;
    if (typeof d.s === 'number' && d.s <= lastSeq && d.ph === (st && st.ph)) return; lastSeq = d.s;
    st = d; BQ.store.set('plang', d.lang || 'ca');
    if (!gotState) { gotState = true; clearTimeout(lostT); const c = $('#pConn'); if (c && connState === 'ok') c.hidden = true; }
    if (!joined) return;
    if (d.ban && d.ban.includes(pid)) { joined = false; BQ.store.del('joined'); pid = BQ.uid(10); BQ.store.set('pid', pid); screen('ban', `<div class="center"><h1>${esc(T('removed'))}</h1><button class="pbtn" id="pAgain">${esc(T('otherName'))}</button></div>`, () => { $('#pAgain').onclick = () => joinForm(); }); return; }
    const me = d.pl && d.pl[pid];
    if (!me) sendHi();
    $('#pMe').innerHTML = `<span class="nm">${esc(name)}</span>${me && d.ph !== 'lobby' ? `<span class="sc num">${BQ.fmtN(me[0])}</span>` : ''}`;
    const qid = d.q && d.q.id;
    if (qid && d.ph === 'q' && seenAt[qid] == null) { seenAt[qid] = Date.now(); if (navigator.vibrate) try { navigator.vibrate(60); } catch (e) { } }
    if (qid && d.ph === 'q' && typeof d.r === 'number') { const dl = Date.now() + d.r; if (deadline[qid] == null || Math.abs(deadline[qid] - dl) > 1200) deadline[qid] = dl; }
    // respuesta pendiente de confirmar: se reenvía hasta que el staff la tiene
    if (qid && mine[qid] && (d.ph === 'q' || d.ph === 'closed') && !(d.got || []).includes(pid)) resend(qid);
    render();
  }
  function resend(qid) { clearTimeout(resendT); resendT = setTimeout(() => { if (st && st.q && st.q.id === qid && (st.ph === 'q' || st.ph === 'closed') && !(st.got || []).includes(pid)) { conn.send('an', { p: pid, q: qid, o: mine[qid].o, ms: mine[qid].ms }); } }, 400); }

  function screen(key, html, after) { if (shown === key) return false; shown = key; $('#pBody').innerHTML = html; if (after) after(); return true; }
  function head(d) { return `<div class="phead"><span class="num">${esc(T('qn', { i: d.i + 1, n: d.n }))}</span>${d.q && d.q.p === 2 ? `<span style="color:var(--gold)">${esc(T('double'))}</span>` : d.q && d.q.p === 0 ? `<span>${esc(T('noPts'))}</span>` : ''}</div>`; }
  function render() {
    const d = st; if (!d) return; const q = d.q, me = d.pl && d.pl[pid];
    if (d.ph === 'lobby' || (!me && d.ph !== 'q')) {
      screen('lobby' + (me ? 1 : 0), `<div class="center"><h1>${esc(me ? T('in') : T('connecting'))}</h1><div class="big-sh bgB">${BQ.SHAPES[1]}</div><div class="sub">${esc(T('look'))}</div><div class="sub" style="font-size:14px">${esc(T('soon'))}</div><button class="pbtn ghost" id="pRen">${esc(T('otherName'))}</button></div>`, () => { $('#pRen').onclick = () => joinForm(); });
      return;
    }
    if (d.ph === 'play') {
      screen('play' + q.id, `${head(d)}<div class="center">${q.c ? `<div class="pctx">${esc(q.c)}</div>` : ''}<div class="pq">${esc(q.x)}</div><div class="sub">${esc(T('watch'))}</div><div class="spin"></div></div>`);
      return;
    }
    if (d.ph === 'q' && !mine[q.id]) {
      if (screen('q' + q.id, `${head(d)}<div class="ptimer"><i id="pBar"></i></div><div class="pq">${esc(q.x)}</div><div class="ptiles ${q.o.length <= 2 ? 'n2' : ''}">${q.o.map((t, j) => `<button class="ptile bg${BQ.LETTERS[q.k[j]]}" data-o="${j}">${BQ.SHAPES[q.k[j]]}<span>${esc(t)}</span></button>`).join('')}</div>`, () => {
        document.querySelectorAll('.ptile').forEach(b => b.onclick = () => answer(q.id, +b.dataset.o));
      })) bar(q.id, q.l);
      return;
    }
    if (d.ph === 'q' || d.ph === 'closed') {
      const a = mine[q.id];
      if (a) screen(d.ph + 'a' + q.id, `${head(d)}<div class="center"><div class="big-sh bg${BQ.LETTERS[q.k[a.o]]}">${BQ.SHAPES[q.k[a.o]]}</div><h1>${esc(d.ph === 'closed' ? T('timeUp') : T('sent'))}</h1><div class="sub">${esc(q.o[a.o])}</div><div class="sub" style="font-size:14px">${esc(T('look'))}</div></div>`);
      else screen('closedn' + q.id, `${head(d)}<div class="center"><h1>${esc(T('timeUp'))}</h1><div class="sub">${esc(T('noAns'))}</div></div>`);
      return;
    }
    if (d.ph === 'reveal' && me) {
      const ok = me[3], pts = me[2], okTxt = (d.ok || []).map(j => q.o[j]).join(' / ');
      screen('rev' + q.id, `${head(d)}<div class="center"><div class="res ${ok === 1 ? 'ok' : ok === 0 ? 'ko' : 'na'}"><div class="big">${esc(ok === 1 ? T('correct') : ok === 0 ? T('wrong') : T('noAns'))}</div>${ok === 1 ? `<div class="pts num">+${BQ.fmtN(pts)}</div>` : ''}${ok !== 1 ? `<div class="was">${esc(T('was'))}: ${esc(okTxt)}</div>` : ''}${me[4] >= 2 ? `<div class="was">${esc(T('streak', { n: me[4] }))}</div>` : ''}</div><div class="sub">${esc(T('total'))}: <b class="num">${BQ.fmtN(me[0])}</b> ${esc(T('pts'))}</div></div>`);
      return;
    }
    if ((d.ph === 'board' || d.ph === 'end') && me) {
      const n = Object.keys(d.pl).length, r = me[1];
      let gap = '';
      if (r > 1) { const above = Object.values(d.pl).find(x => x[1] === r - 1); if (above) gap = T('behind', { d: BQ.fmtN(above[0] - me[0]), r: BQ.ord(lang(), r - 1) }); }
      else gap = d.ph === 'board' ? T('leader') : '';
      const fin = d.ph === 'end';
      screen((fin ? 'end' : 'board') + (q ? q.id : '') + r + me[0], `<div class="center">${fin ? `<h1>${esc(T('over'))}</h1>` : ''}<div class="rank num">${esc(BQ.ord(lang(), r))}</div><h1>${esc(fin ? T('final', { r: BQ.ord(lang(), r), n }) : T('youAre', { r: BQ.ord(lang(), r), n }))}</h1><div class="sub"><b class="num">${BQ.fmtN(me[0])}</b> ${esc(T('pts'))}${gap ? ' · ' + esc(gap) : ''}</div>${fin ? `<div class="sub">${esc(T('thanks'))}</div>` : `<div class="sub" style="font-size:14px">${esc(T('look'))}</div>`}</div>`);
      return;
    }
  }
  function answer(qid, o) {
    if (mine[qid] || !st || st.ph !== 'q' || !st.q || st.q.id !== qid) return;
    const ms = Date.now() - (seenAt[qid] || Date.now());
    mine[qid] = { o, ms };
    if (navigator.vibrate) try { navigator.vibrate(30); } catch (e) { }
    conn.send('an', { p: pid, q: qid, o, ms });
    render(); resend(qid);
    // reintento por si el mensaje se pierde: hasta que aparezca en «got»
    const again = () => { if (st && st.q && st.q.id === qid && (st.ph === 'q' || st.ph === 'closed') && !(st.got || []).includes(pid)) { conn.send('an', { p: pid, q: qid, o, ms }); setTimeout(again, 800); } };
    setTimeout(again, 800);
  }
  function bar(qid, lim) {
    const el = $('#pBar'); if (!el) return;
    const loop = () => {
      const b = $('#pBar'); if (!b || !st || !st.q || st.q.id !== qid || st.ph !== 'q') return;
      const left = (deadline[qid] || Date.now()) - Date.now(), f = BQ.clamp(left / (lim * 1000), 0, 1);
      b.style.transform = `scaleX(${f})`; b.style.background = left < 5000 ? '#ef5350' : '';
      requestAnimationFrame(loop);
    };
    loop();
  }
})();
