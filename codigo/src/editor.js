/* BascatQuiz · Preparar: cuestionarios, preguntas, clips (biblioteca de BascatApp u ordenador), dónde para cada clip y las respuestas */
(function () {
  'use strict';
  const BQ = window.BQ, { $, $$, esc } = BQ;
  const E = BQ.E = { quiz: null, sel: null, v: null, lib: null };
  const L = () => E.quiz.lang || 'ca';

  // ───────── cuestionarios guardados en este navegador ─────────
  const index = () => BQ.store.get('quizzes', []);
  const writeIndex = list => BQ.store.set('quizzes', list);
  let saveT = null;
  function save(now) {
    clearTimeout(saveT);
    const go = () => {
      const q = E.quiz; q.updated = Date.now(); const me = BQ.gh.me(); if (me) { if (!q.author) q.author = me; q.by = me; }
      if (!BQ.store.set('quiz.' + q.id, q)) BQ.toast('No se ha podido guardar en este navegador (¿sin espacio?). Exporta el cuestionario.');
      const list = index().filter(x => x.id !== q.id); list.unshift({ id: q.id, title: q.title, updated: q.updated, n: q.qs.length, author: q.author || '', by: q.by || '' });
      writeIndex(list); BQ.store.set('cur', q.id);
      ghLater(q.id);
    };
    if (now) go(); else saveT = setTimeout(go, 350);
  }
  // que no se pierda el último cambio al cerrar la pestaña
  window.addEventListener('pagehide', () => { if (saveT) { clearTimeout(saveT); save(true); } ghFlush(true); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') { if (saveT) { clearTimeout(saveT); save(true); } ghFlush(); } else ghSyncSoon(); });
  E.save = save;
  // un cuestionario nuevo que se ha quedado vacío no se guarda en la lista al cambiar a otro
  function dropEmpty(keep) { const q = E.quiz; if (q && q.id !== keep && !q.qs.length && /^Nuevo cuestionario$/.test(q.title)) { BQ.store.del('quiz.' + q.id); writeIndex(index().filter(x => x.id !== q.id)); } }
  function openQuiz(id) {
    const q = BQ.store.get('quiz.' + id, null); if (!q) return false; dropEmpty(id);
    E.quiz = fixQuiz(q); E.sel = (E.quiz.qs[0] || {}).id || null; BQ.store.set('cur', id);
    renderAll(); if (BQ.gh && BQ.gh.ok()) setTimeout(fetchVideos, 0); return true;
  }
  function fixQuiz(q) {
    q.v = 1; q.id = q.id || BQ.uid(8); q.lang = q.lang === 'es' ? 'es' : 'ca'; q.title = q.title || 'Cuestionario'; q.qs = Array.isArray(q.qs) ? q.qs : [];
    for (const x of q.qs) {
      x.id = x.id || BQ.uid(6); x.on = x.on !== false; x.opts = Array.isArray(x.opts) ? x.opts.slice(0, 4).map(o => ({ t: String(o.t || ''), ok: !!o.ok })) : [];
      while (x.opts.length < 2) x.opts.push({ t: '', ok: false });
      x.lim = +x.lim || 20; x.pts = [0, 1, 2].includes(+x.pts) ? +x.pts : 1; x.from = +x.from || 0; x.stop = x.stop == null ? null : +x.stop; x.to = x.to == null ? null : +x.to;
      x.text = x.text || ''; x.ctx = x.ctx || ''; x.expl = x.expl || '';
    }
    return q;
  }
  function newQuiz(title) { dropEmpty(); E.quiz = BQ.newQuiz(title, E.quiz ? L() : 'ca'); E.quiz.author = BQ.gh.me(); E.sel = null; save(true); renderAll(); }
  function importQuiz(text, name) {
    let q; try { q = JSON.parse(text); } catch (e) { BQ.toast('Ese archivo no es un cuestionario válido'); return; }
    if (!q || !Array.isArray(q.qs)) { BQ.toast('Ese archivo no es un cuestionario de BascatQuiz'); return; }
    q = fixQuiz(q);
    if (BQ.store.get('quiz.' + q.id, null)) q.id = BQ.uid(8); // no pisar uno que ya existe
    dropEmpty(q.id); E.quiz = q; E.sel = (q.qs[0] || {}).id || null; save(true); renderAll();
    const miss = q.qs.filter(x => x.clip && !BQ.resolveClip(x.clip)).length;
    BQ.toast(`«${q.title}» importado: ${q.qs.length} preguntas` + (miss ? ` · faltan ${miss} vídeos (cárgalos desde la biblioteca o el ordenador)` : ''), 6000);
    if (miss && !BQ.lib.rows) tryLibQuiet();
  }
  function exportQuiz() {
    const q = BQ.clone(E.quiz);
    BQ.download(BQ.slug(q.title) + '.bascatquiz.json', JSON.stringify(q, null, 1), 'application/json');
  }

  // ───────── copia en GitHub (repositorio de datos del staff) ─────────
  const QDIR = 'cuestionarios', RDIR = 'resultados', VDIR = 'videos';
  const qPath = id => `${QDIR}/${id}.json`;
  const shasOf = () => BQ.store.get('ghsha', {});      // id → {sha, at}: lo último que hay en GitHub y de cuándo es
  const pristine = q => !q || (!q.qs.length && /^Nuevo cuestionario$/.test(q.title));
  const pushT = new Map();
  function ghLater(id) { if (!BQ.gh.ok()) return; clearTimeout(pushT.get(id)); pushT.set(id, setTimeout(() => { pushT.delete(id); pushQuiz(id); }, 5000)); }
  function ghFlush(leaving) { if (!BQ.gh.ok()) return; for (const [id, t] of pushT) { clearTimeout(t); pushT.delete(id); pushQuiz(id, leaving); } }
  // sube los vídeos del ordenador que use el cuestionario (una sola vez cada vídeo) y apunta dónde quedan
  async function uploadVideos(q) {
    const vids = BQ.store.get('ghvid', {}); let changed = false;
    const todo = q.qs.filter(x => x.clip && x.clip.src !== 'lib' && !x.clip.gh);
    let n = 0;
    for (const x of todo) {
      const r = BQ.resolveClip(x.clip); if (!r || r.how !== 'file') continue;
      const rec = BQ.files.get(r.key || x.clip.key); if (!rec) continue;
      const k = rec.key + '|' + rec.file.size;
      if (!vids[k]) {
        if (rec.file.size > 45e6) { BQ.toast(`«${rec.name}» pesa más de 45 MB: no se sube a GitHub (en otro ordenador habrá que cargarlo a mano)`, 6000); continue; }
        const ext = (rec.file.name.match(/\.(\w{2,4})$/) || [, 'mp4'])[1].toLowerCase();
        const path = `${VDIR}/${BQ.slug(rec.name).slice(0, 60)}-${rec.file.size}.${ext}`;
        BQ.toast(`Subiendo vídeos a GitHub (${++n}/${todo.length})…`, 60000);
        await BQ.gh.putBlob(path, rec.file, 'Vídeo: ' + rec.name);
        vids[k] = path; BQ.store.set('ghvid', vids);
      }
      x.clip.gh = vids[k]; changed = true;
    }
    if (n) BQ.toast('Vídeos subidos a GitHub');
    return changed;
  }
  async function pushQuiz(id, leaving) {
    if (!BQ.gh.ok()) return;
    let q = BQ.store.get('quiz.' + id, null); if (!q || pristine(q)) return;
    try {
      if (!leaving && await uploadVideos(q)) { BQ.store.set('quiz.' + id, q); if (E.quiz && E.quiz.id === id) E.quiz.qs.forEach((x, i) => { if (q.qs[i] && q.qs[i].clip && x.clip) x.clip.gh = q.qs[i].clip.gh; }); }
      const shas = shasOf(), s = shas[id];
      let sha;
      try { sha = await BQ.gh.putJSON(qPath(id), q, s && s.sha, 'Cuestionario: ' + q.title, { keepalive: !!leaving && JSON.stringify(q).length < 48000 }); }
      catch (e) {
        if (e.status !== 409 && e.status !== 422) throw e;
        // en GitHub hay otra versión: gana la más reciente
        const r = await BQ.gh.getJSON(qPath(id));
        if ((r.data.updated || 0) > (q.updated || 0)) { takeRemote(id, r); return; }
        sha = await BQ.gh.putJSON(qPath(id), q, r.sha, 'Cuestionario: ' + q.title);
      }
      const s2 = shasOf(); s2[id] = { sha, at: q.updated || 0 }; BQ.store.set('ghsha', s2);
    } catch (e) { ghError(e); }
  }
  function takeRemote(id, r) {
    const q = fixQuiz(r.data); BQ.store.set('quiz.' + id, q);
    const list = index().filter(x => x.id !== id); list.push({ id, title: q.title, updated: q.updated, n: q.qs.length, author: q.author || '', by: q.by || '' }); list.sort((a, b) => (b.updated || 0) - (a.updated || 0)); writeIndex(list);
    const s = shasOf(); s[id] = { sha: r.sha, at: q.updated || 0 }; BQ.store.set('ghsha', s);
    return q;
  }
  function ghError(e) { console.warn('GitHub', e); if (e && (e.status === 401 || e.status === 403)) BQ.gh.fail(e); else BQ.gh.check().then(okk => { if (okk) BQ.gh.fail(e); }); }
  const typing = () => { const a = document.activeElement; return a && (/INPUT|TEXTAREA|SELECT/.test(a.tagName)); };
  let syncing = null, lastSync = 0;
  function ghSyncSoon() { if (BQ.gh.configured() && Date.now() - lastSync > 30000) ghSync(); }
  setInterval(() => { if (document.visibilityState === 'visible' && !E.live && BQ.gh.configured() && Date.now() - lastSync > 55000) ghSync(); }, 60000);
  // traer de GitHub lo nuevo y subir lo que solo está aquí
  function ghSync() { if (!syncing) syncing = doSync().finally(() => { syncing = null; lastSync = Date.now(); }); return syncing; }
  async function doSync() {
    if (!BQ.gh.configured()) return;
    if (!BQ.gh.ok() && !(await BQ.gh.check())) return;
    let remote; try { remote = await BQ.gh.list(QDIR); } catch (e) { ghError(e); return; }
    const rem = new Map(remote.filter(f => /\.json$/.test(f.name)).map(f => [f.name.replace(/\.json$/, ''), f]));
    let cur = null, curBy = '';
    const news = [], firstTime = !Object.keys(shasOf()).length;
    // borrados aquí sin conexión: borrarlos también allí
    const dels = BQ.store.get('ghdel', []);
    for (const id of dels.slice()) { const f = rem.get(id); try { if (f) await BQ.gh.del(f.path, f.sha, 'Borrar cuestionario'); rem.delete(id); dels.splice(dels.indexOf(id), 1); } catch (e) { } }
    BQ.store.set('ghdel', dels);
    // borrados en otro ordenador (ya estaban sincronizados y ya no están)
    const shas = shasOf();
    for (const l of index()) {
      const s = shas[l.id], local = BQ.store.get('quiz.' + l.id, null);
      if (!rem.has(l.id) && s && local && (local.updated || 0) <= (s.at || 0)) {
        BQ.store.del('quiz.' + l.id); writeIndex(index().filter(x => x.id !== l.id)); delete shas[l.id]; if (E.quiz && E.quiz.id === l.id) cur = 'gone';
      }
    }
    BQ.store.set('ghsha', shas);
    // nuevos o cambiados allí
    for (const [id, f] of rem) {
      const s = shasOf()[id]; if (s && s.sha === f.sha) continue;
      let r; try { r = await BQ.gh.getJSON(f.path); } catch (e) { continue; }
      const local = BQ.store.get('quiz.' + id, null);
      if (!local || (r.data.updated || 0) >= (local.updated || 0)) { takeRemote(id, r); if (E.quiz && E.quiz.id === id) { cur = cur || 'changed'; curBy = r.data.by; } if (!local) news.push(r.data); }
      else { const s2 = shasOf(); s2[id] = { sha: r.sha, at: r.data.updated || 0 }; BQ.store.set('ghsha', s2); }
    }
    // lo que solo está aquí o es más nuevo aquí
    const s3 = shasOf();
    for (const l of index()) { const local = BQ.store.get('quiz.' + l.id, null), s = s3[l.id]; if (local && !pristine(local) && (!s || (local.updated || 0) > (s.at || 0))) await pushQuiz(l.id); }
    // el cuestionario abierto
    const others = index().filter(x => !pristine(BQ.store.get('quiz.' + x.id, null)));
    if (cur === 'gone') { const n = others[0]; if (!n || !openQuiz(n.id)) newQuiz('Nuevo cuestionario'); BQ.toast('Ese cuestionario se borró en otro ordenador'); }
    else if (cur === 'changed' && !typing()) { const sel = E.sel; openQuiz(E.quiz.id); if (E.quiz.qs.some(x => x.id === sel)) select(sel); if (curBy && curBy !== BQ.gh.me()) BQ.toast(`«${E.quiz.title}» actualizado con los cambios de ${curBy}`, 4500); }
    else if (E.quiz && pristine(E.quiz) && others.length) { const old = E.quiz.id; openQuiz(others[0].id); BQ.store.del('quiz.' + old); writeIndex(index().filter(x => x.id !== old)); }
    const mine = BQ.gh.me(), fromOthers = news.filter(q => !q.deleted && q.author !== mine || !mine);
    if (fromOthers.length && !firstTime) BQ.toast(fromOthers.length === 1 ? `Nuevo cuestionario${fromOthers[0].author ? ' de ' + fromOthers[0].author : ''}: «${fromOthers[0].title}» (en Cuestionarios)` : `${fromOthers.length} cuestionarios nuevos del staff (en Cuestionarios)`, 5000);
    else if (news.length && firstTime) BQ.toast(`${news.length} ${news.length === 1 ? 'cuestionario del staff' : 'cuestionarios del staff'} en Cuestionarios`, 4000);
    fetchVideos();
  }
  // vídeos guardados en GitHub que faltan en este ordenador (para el cuestionario abierto)
  let fetching = false;
  async function fetchVideos() {
    if (fetching || !BQ.gh.ok() || !E.quiz) return; fetching = true;
    try {
      const need = E.quiz.qs.filter(x => x.clip && x.clip.gh && !BQ.resolveClip(x.clip)); const paths = [...new Set(need.map(x => x.clip.gh))];
      let i = 0;
      for (const path of paths) {
        BQ.toast(`Bajando vídeos de GitHub (${++i}/${paths.length})…`, 60000);
        try {
          const ext = (path.match(/\.(\w+)$/) || [, 'mp4'])[1], blob = await BQ.gh.getBlob(path, ext === 'webm' ? 'video/webm' : 'video/mp4');
          const users = need.filter(x => x.clip.gh === path), c = users[0].clip;
          const rec = BQ.addFile(c.key || path, new File([blob], (c.name || 'clip') + '.' + ext, { type: blob.type })); BQ.cacheFile(rec);
          const vids = BQ.store.get('ghvid', {}); vids[rec.key + '|' + rec.file.size] = path; BQ.store.set('ghvid', vids);
          renderList(); if (users.some(x => x.id === E.sel)) renderMain();
        } catch (e) { console.warn('vídeo', path, e); }
      }
      if (paths.length) BQ.toast('Vídeos listos');
    } finally { fetching = false; }
  }
  E.pushResult = async h => {
    if (!BQ.gh.ok()) return;
    const d = new Date(h.date), p = n => String(n).padStart(2, '0');
    h.gh = `${RDIR}/${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}_${BQ.slug(h.title).slice(0, 40)}_${h.code}.json`;
    try { await BQ.gh.putJSON(h.gh, h, null, 'Resultados: ' + h.title); const H = BQ.store.get('hist', []), x = H.find(y => y.date === h.date && y.code === h.code); if (x) { x.gh = h.gh; BQ.store.set('hist', H); } } catch (e) { ghError(e); }
  };
  async function pullResults() {
    if (!BQ.gh.ok()) return false;
    try {
      const files = await BQ.gh.list(RDIR), H = BQ.store.get('hist', []), have = new Set(H.map(h => h.gh).filter(Boolean)); let n = 0;
      for (const f of files) { if (have.has(f.path) || !/\.json$/.test(f.name)) continue; try { const r = await BQ.gh.getJSON(f.path); r.data.gh = f.path; r.data.ghsha = r.sha; if (!H.some(h => h.date === r.data.date && h.code === r.data.code)) { H.push(r.data); n++; } } catch (e) { } }
      // las de aquí que aún no están allí
      for (const h of H) if (!h.gh) await E.pushResult(h);
      H.sort((a, b) => b.date - a.date); BQ.store.set('hist', H.slice(0, 60)); return n > 0;
    } catch (e) { ghError(e); return false; }
  }
  // botón de estado y ventana para conectar
  function ghChip() {
    const b = $('#bGh'); if (!b) return; const st = BQ.gh.state;
    const T = { off: 'Solo en este navegador', checking: 'Conectando con GitHub…', ok: '✓ Guardado en GitHub', saving: 'Guardando en GitHub…', error: '⚠ GitHub: sin guardar' };
    b.textContent = T[st] || T.off; b.classList.toggle('warn', st === 'error' || st === 'off'); b.title = st === 'error' ? BQ.gh.err : 'Dónde se guardan los cuestionarios';
  }
  function ghWindow(intro) {
    const c = BQ.gh.cfg(), st = BQ.gh.state, conn = BQ.gh.configured();
    const local = E.quiz.qs.filter(x => x.clip && x.clip.src !== 'lib' && !x.clip.gh).length;
    const m = BQ.modal(intro ? 'Bienvenido al staff' : 'Guardar en GitHub', `
      ${intro ? '<p class="okmsg" style="margin:0 0 10px">Ya estás conectado a los cuestionarios del staff. Escribe tu nombre y pulsa Guardar cambios.</p>' : ''}
      <p style="margin:0 0 10px">Los cuestionarios se guardan siempre en este navegador. Conectando GitHub, además se guarda una copia de <b>los cuestionarios, los resultados y los vídeos que cargues desde el ordenador</b> en el mismo repositorio del quiz (rama «datos»), y al abrir la página en otro ordenador con el token aparece todo.</p>
      ${st === 'error' ? `<p class="warns">${esc(BQ.gh.err)}</p>` : st === 'ok' || st === 'saving' ? `<p class="okmsg">Conectado a ${esc(c.repo)} · rama ${esc(BQ.gh.BRANCH)}</p>` : ''}
      ${conn ? '' : `<ol style="margin:0 0 12px;padding-left:20px;display:flex;flex-direction:column;gap:6px">
        <li>Crea un token en <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">github.com/settings/personal-access-tokens/new</a>: en <i>Repository access</i> elige <i>Only select repositories</i> → <b>bascatquiz</b>; en <i>Permissions → Repository permissions</i> pon <b>Contents: Read and write</b>; caducidad, la más larga. Genera y copia el token.</li>
        <li>Pégalo aquí debajo y pulsa Conectar. En cada ordenador que uses, lo mismo (una sola vez).</li></ol>`}
      <p class="muted" style="margin:0 0 10px;font-size:13px">El repositorio es público: lo que se guarda (preguntas, resultados con nombres y puntos, vídeos) se puede ver en GitHub.</p>
      <div class="f"><label for="ghName">Tu nombre (así se ve quién ha hecho cada cuestionario)</label><input type="text" id="ghName" class="inp" value="${esc(c.name || '')}" maxlength="24" placeholder="Ej.: Gonzalo"></div>
      <div class="f"><label for="ghRepo">Repositorio</label><input type="text" id="ghRepo" class="inp" value="${esc(c.repo)}" spellcheck="false"></div>
      <div class="f"><label for="ghTok">Token</label><input type="password" id="ghTok" class="inp" value="${esc(c.token)}" placeholder="github_pat_…" autocomplete="off" spellcheck="false"><span class="hint" style="margin:0">El token se queda solo en este navegador; nunca va en la página ni en el repositorio.</span></div>
      ${local && (st === 'ok' || st === 'saving') ? `<p class="muted" style="margin:0">${local} ${local === 1 ? 'clip de este cuestionario se subirá' : 'clips de este cuestionario se subirán'} a GitHub al guardar.</p>` : ''}
      ${st === 'ok' || st === 'saving' ? `<hr style="border:0;border-top:1px solid var(--line);margin:14px 0">
        <h3 style="font-size:15px;margin-bottom:6px">Compartir con el resto del staff</h3>
        <p style="margin:0 0 8px">Pásales este enlace (por privado). Al abrirlo quedan conectados y ven todos los cuestionarios del staff: pueden prepararlos, cambiarlos e iniciarlos, y tú ves los suyos.</p>
        <div class="row"><input type="text" id="ghInv" class="inp" readonly value="${esc(BQ.gh.inviteLink())}" style="flex:1;min-width:0;font-size:12px"><button class="btn sm" id="ghInvCp">Copiar</button></div>
        <p class="hint" style="margin:6px 0 0">Quien tenga el enlace puede guardar en el repositorio: no lo pongas en ningún grupo con jugadores.</p>` : ''}`,
      `${conn ? '<button class="btn danger" data-off>Desconectar este ordenador</button><span class="grow"></span><button class="btn" data-sync>Sincronizar ahora</button>' : '<span class="grow"></span>'}<button class="btn pri" data-go>${conn ? 'Guardar cambios' : 'Conectar'}</button>`);
    m.querySelector('[data-go]').onclick = async () => {
      BQ.gh.setCfg({ name: m.querySelector('#ghName').value.trim(), repo: m.querySelector('#ghRepo').value.trim().replace(/^https?:\/\/github\.com\//, '').replace(/\.git$|\/$/g, ''), token: m.querySelector('#ghTok').value.trim() });
      m.close(); if (await BQ.gh.check()) { BQ.toast('Conectado: sincronizando…'); await ghSync(); BQ.toast('Todo guardado en GitHub'); } else ghWindow();
    };
    const cp = m.querySelector('#ghInvCp'); if (cp) cp.onclick = async () => { const i = m.querySelector('#ghInv'); try { await navigator.clipboard.writeText(i.value); BQ.toast('Enlace copiado'); } catch (e) { i.select(); BQ.toast('Copia el enlace seleccionado (Ctrl+C)'); } };
    const off = m.querySelector('[data-off]'); if (off) off.onclick = () => { BQ.gh.setCfg({ token: '' }); BQ.gh.check(); m.close(); BQ.toast('Este ordenador ya no guarda en GitHub (lo que ya está allí no se toca)'); };
    const sy = m.querySelector('[data-sync]'); if (sy) sy.onclick = async () => { m.close(); await ghSync(); await pullResults(); BQ.toast(BQ.gh.ok() ? 'Sincronizado con GitHub' : 'No se ha podido sincronizar'); };
  }

  // ───────── ventanas ─────────
  BQ.modal = (title, body, foot, opt = {}) => {
    const m = document.createElement('div'); m.className = 'modal';
    m.innerHTML = `<div class="box ${opt.wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="mh"><h2>${esc(title)}</h2><button class="btn ghost sm" data-x aria-label="Cerrar">✕</button></div><div class="mb">${body}</div>${foot ? `<div class="mf">${foot}</div>` : ''}</div>`;
    const close = () => { m.remove(); document.removeEventListener('keydown', onk); opt.onClose && opt.onClose(); };
    const onk = e => { if (e.key === 'Escape') close(); };
    m.addEventListener('mousedown', e => { if (e.target === m) close(); });
    m.querySelector('[data-x]').onclick = close; document.addEventListener('keydown', onk);
    (opt.parent || document.body).appendChild(m); m.close = close; return m;
  };
  BQ.ask = (title, text, okLabel, danger) => new Promise(res => {
    let done = false;
    const m = BQ.modal(title, `<p style="margin:0">${esc(text)}</p>`, `<button class="btn" data-no>Cancelar</button><button class="btn ${danger ? 'danger' : 'pri'}" data-ok>${esc(okLabel || 'Aceptar')}</button>`, { onClose: () => { if (!done) res(false); } });
    m.querySelector('[data-no]').onclick = () => m.close();
    m.querySelector('[data-ok]').onclick = () => { done = true; m.close(); res(true); };
    setTimeout(() => m.querySelector('[data-ok]').focus(), 30);
  });

  // ───────── estructura de la página ─────────
  function shell() {
    $('#app').innerHTML = `
<header class="top">
  <span class="brand">Bascat<span>Quiz</span></span>
  <div class="menu" id="mQuiz"><button class="btn" aria-haspopup="true">Cuestionarios ▾</button><div class="pop" id="mQuizPop"></div></div>
  <input class="title" id="qTitle" aria-label="Nombre del cuestionario" spellcheck="false">
  <select id="qLang" aria-label="Idioma para los jugadores" title="Idioma de la pantalla grande y los móviles"><option value="ca">Català</option><option value="es">Castellano</option></select>
  <span class="grow"></span>
  <button class="btn ghost ghchip" id="bGh"></button>
  <button class="btn" id="bHelp">Ayuda</button>
  <button class="btn" id="bHist">Resultados</button>
  <button class="btn" id="bCfg">Ajustes</button>
  <button class="btn pri big" id="bPlay">▶ Jugar</button>
</header>
<div class="app">
  <aside class="side drop" id="side">
    <div class="hd"><h2>Preguntas</h2><span class="muted num" id="qCount"></span></div>
    <ol class="qlist" id="qList"></ol>
    <div class="row">
      <div class="menu" id="mAdd"><button class="btn pri" aria-haspopup="true">＋ Añadir clips ▾</button><div class="pop">
        <button id="aLib">De la biblioteca de BascatApp…</button>
        <hr><div class="cap">Del ordenador</div>
        <label>Vídeos…<input type="file" accept="video/*,.mp4,.mov,.m4v,.webm" multiple id="fVids"></label>
        <label>Una carpeta…<input type="file" webkitdirectory multiple id="fDir"></label>
        <label>Un zip…<input type="file" accept=".zip" id="fZip"></label>
      </div></div>
      <button class="btn" id="aBlank" title="Pregunta nueva con el mismo clip que la elegida">＋ Pregunta</button>
    </div>
    <p class="hint">Cada clip es una pregunta. También puedes arrastrar aquí vídeos, una carpeta, un zip o un cuestionario (.json).</p>
  </aside>
  <main class="mainp" id="main"></main>
</div>`;
    // menús
    $$('.menu > .btn').forEach(b => b.onclick = e => { e.stopPropagation(); const m = b.parentElement, was = m.classList.contains('open'); closeMenus(); if (!was) { if (m.id === 'mQuiz') { renderQuizMenu(); if (BQ.gh.configured() && Date.now() - lastSync > 8000) ghSync().then(() => { if (m.classList.contains('open')) renderQuizMenu(); }); } m.classList.add('open'); } });
    document.addEventListener('click', e => { if (!e.target.closest('.menu .pop')) closeMenus(); });
    $('#qTitle').oninput = e => { E.quiz.title = e.target.value; save(); };
    $('#qLang').onchange = e => { E.quiz.lang = e.target.value; save(); renderMain(); };
    $('#bPlay').onclick = () => startGame();
    $('#bCfg').onclick = () => settings();
    $('#bHist').onclick = () => history();
    $('#bHelp').onclick = () => help();
    $('#bGh').onclick = () => ghWindow(); BQ.gh.on(ghChip); ghChip();
    $('#aLib').onclick = () => { closeMenus(); libPicker('add'); };
    $('#aBlank').onclick = () => { const cur = curQ(); const q = BQ.newQuestion(L(), cur && cur.clip ? BQ.clone(cur.clip) : null); if (cur) { q.from = cur.from; q.to = cur.to; q.stop = cur.stop; } insertAfter(q); };
    $('#fVids').onchange = e => { addFiles([...e.target.files].map(f => ({ path: f.name, file: f }))); e.target.value = ''; closeMenus(); };
    $('#fDir').onchange = e => { addFiles([...e.target.files].map(f => ({ path: f.webkitRelativePath || f.name, file: f }))); e.target.value = ''; closeMenus(); };
    $('#fZip').onchange = e => { const f = e.target.files[0]; e.target.value = ''; closeMenus(); if (f) openZip(f); };
    // arrastrar y soltar
    document.addEventListener('dragover', e => { if (E.live) return; if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { e.preventDefault(); $$('.drop').forEach(d => d.classList.add('over')); } });
    document.addEventListener('dragleave', e => { if (!e.relatedTarget) $$('.drop').forEach(d => d.classList.remove('over')); });
    document.addEventListener('drop', onDrop);
    document.addEventListener('keydown', onKey);
  }
  function closeMenus() { $$('.menu.open').forEach(m => m.classList.remove('open')); }
  function ago(t) { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'ahora' : m < 60 ? `hace ${m} min` : m < 1440 ? `hace ${Math.round(m / 60)} h` : new Date(t).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }); }
  function renderQuizMenu() {
    const list = index().slice().sort((a, b) => (b.updated || 0) - (a.updated || 0));
    const shared = BQ.gh.configured();
    $('#mQuizPop').innerHTML = `<div class="cap">${shared ? 'Cuestionarios del staff' : 'Mis cuestionarios'}</div>` +
      list.map(x => `<button data-open="${esc(x.id)}" class="qm ${x.id === E.quiz.id ? 'cur' : ''}"><span class="qmt">${x.id === E.quiz.id ? '● ' : ''}${esc(x.title)}</span><span class="qms muted">${x.n || 0} preg.${x.author ? ' · de ' + esc(x.author) : ''}${x.updated ? ' · ' + esc(ago(x.updated)) : ''}${x.by && x.by !== x.author ? ' (' + esc(x.by) + ')' : ''}</span></button>`).join('') +
      (shared && BQ.gh.state === 'checking' ? '<div class="cap">Buscando en GitHub…</div>' : '') +
      `<hr><button data-a="new">Nuevo cuestionario</button><button data-a="dup">Duplicar este</button>
       <label>Importar (.json)…<input type="file" accept=".json,application/json" id="fImp"></label>
       <button data-a="exp">Exportar este (.json)</button><hr><button data-a="del" class="danger">Borrar este cuestionario…</button>`;
    $$('#mQuizPop [data-open]').forEach(b => b.onclick = () => { closeMenus(); openQuiz(b.dataset.open); });
    $('#mQuizPop [data-a=new]').onclick = () => { closeMenus(); newQuiz('Nuevo cuestionario'); };
    $('#mQuizPop [data-a=dup]').onclick = () => { closeMenus(); const q = BQ.clone(E.quiz); q.id = BQ.uid(8); q.title += ' (copia)'; q.created = Date.now(); E.quiz = q; save(true); renderAll(); BQ.toast('Copia creada'); };
    $('#mQuizPop [data-a=exp]').onclick = () => { closeMenus(); exportQuiz(); };
    $('#mQuizPop [data-a=del]').onclick = async () => {
      closeMenus();
      if (!await BQ.ask('Borrar cuestionario', `Se borrará «${E.quiz.title}»${BQ.gh.configured() ? ' de este navegador y de GitHub' : ' de este navegador'} (los vídeos no se tocan). Si quieres conservarlo, expórtalo antes.`, 'Borrar', true)) return;
      const gone = E.quiz.id, sh = shasOf(); BQ.store.del('quiz.' + gone); writeIndex(index().filter(x => x.id !== gone));
      clearTimeout(pushT.get(gone)); pushT.delete(gone);
      if (sh[gone]) { delete sh[gone]; BQ.store.set('ghsha', sh); const dels = BQ.store.get('ghdel', []); dels.push(gone); BQ.store.set('ghdel', dels); if (BQ.gh.ok()) ghSync(); }
      const next = index()[0]; if (!next || !openQuiz(next.id)) newQuiz('Nuevo cuestionario');
    };
    $('#fImp').onchange = async e => { const f = e.target.files[0]; e.target.value = ''; closeMenus(); if (f) importQuiz(await f.text(), f.name); };
  }

  function renderAll() { $('#qTitle').value = E.quiz.title; $('#qLang').value = L(); renderList(); renderMain(); }
  const curQ = () => E.quiz.qs.find(q => q.id === E.sel) || null;
  function select(id) { E.sel = id; renderList(); renderMain(); }
  function insertAfter(q) { const i = E.quiz.qs.findIndex(x => x.id === E.sel); E.quiz.qs.splice(i < 0 ? E.quiz.qs.length : i + 1, 0, q); save(); select(q.id); }

  // ───────── lista de preguntas ─────────
  function clipLabel(c) { return c ? c.name || 'clip' : 'sin clip'; }
  function renderList() {
    const qs = E.quiz.qs, on = qs.filter(q => q.on).length;
    $('#qCount').textContent = qs.length ? (on === qs.length ? `${qs.length}` : `${on} de ${qs.length} activas`) : '';
    let n = 0;
    $('#qList').innerHTML = qs.map(q => {
      const pr = BQ.problems(q, q.clip ? !!BQ.resolveClip(q.clip) : null), num = q.on ? ++n : '–';
      return `<li class="qi ${q.id === E.sel ? 'cur' : ''} ${q.on ? '' : 'off'}" data-id="${q.id}" draggable="true">
        <span class="n">${num}</span>
        <div class="tx">${itemText(q, pr)}</div>
        <div class="acts">
          <button data-a="on" title="${q.on ? 'Quitar de la partida (se guarda)' : 'Volver a incluir en la partida'}">${q.on ? '◉' : '○'}</button>
          <button data-a="up" title="Subir">↑</button><button data-a="dn" title="Bajar">↓</button>
          <button data-a="dup" title="Duplicar">⧉</button><button data-a="del" title="Borrar">✕</button>
        </div></li>`;
    }).join('');
    $$('#qList .qi').forEach(li => {
      const id = li.dataset.id;
      li.onclick = e => { const a = e.target.closest('[data-a]'); if (a) { e.stopPropagation(); listAct(id, a.dataset.a); } else if (id !== E.sel) select(id); };
      li.ondragstart = e => { e.dataTransfer.setData('text/x-bqz', id); e.dataTransfer.effectAllowed = 'move'; };
      li.ondragover = e => { if ([...e.dataTransfer.types].includes('text/x-bqz')) { e.preventDefault(); e.stopPropagation(); li.classList.add('drag-over'); } };
      li.ondragleave = () => li.classList.remove('drag-over');
      li.ondrop = e => { const from = e.dataTransfer.getData('text/x-bqz'); if (!from) return; e.preventDefault(); e.stopPropagation(); li.classList.remove('drag-over'); move(from, id); };
    });
  }
  function move(fromId, beforeId) {
    const qs = E.quiz.qs, a = qs.findIndex(q => q.id === fromId); if (a < 0 || fromId === beforeId) return;
    const [x] = qs.splice(a, 1); const b = qs.findIndex(q => q.id === beforeId); qs.splice(b < 0 ? qs.length : b, 0, x); save(); renderList();
  }
  async function listAct(id, a) {
    const qs = E.quiz.qs, i = qs.findIndex(q => q.id === id), q = qs[i]; if (!q) return;
    if (a === 'on') { q.on = !q.on; save(); renderList(); return; }
    if (a === 'up' && i > 0) { qs.splice(i, 1); qs.splice(i - 1, 0, q); }
    else if (a === 'dn' && i < qs.length - 1) { qs.splice(i, 1); qs.splice(i + 1, 0, q); }
    else if (a === 'dup') { const c = BQ.clone(q); c.id = BQ.uid(6); qs.splice(i + 1, 0, c); save(); select(c.id); return; }
    else if (a === 'del') {
      if (!await BQ.ask('Borrar pregunta', `¿Borrar «${q.text || 'pregunta'}» (${clipLabel(q.clip)})?`, 'Borrar', true)) return;
      qs.splice(i, 1); if (E.sel === id) E.sel = (qs[i] || qs[i - 1] || {}).id || null; save(); renderList(); renderMain(); return;
    }
    save(); renderList();
  }

  // ───────── añadir clips ─────────
  function clipFromFile(rec) { return { src: 'file', key: rec.key, name: rec.name, folder: rec.folder || '' }; }
  async function addFiles(list) {
    const vids = list.filter(x => BQ.isVideo(x.path)).sort((a, b) => a.path.localeCompare(b.path, 'es', { numeric: true }));
    if (!vids.length) { BQ.toast('No hay vídeos en lo que has elegido'); return; }
    let added = 0, linked = 0, first = null;
    for (const { path, file } of vids) {
      const rec = BQ.addFile(path, file); BQ.cacheFile(rec);
      // si alguna pregunta ya usa este clip (por ruta o por nombre), solo se vuelve a enlazar
      const users = E.quiz.qs.filter(q => q.clip && (q.clip.key === rec.key || (BQ.norm(q.clip.name) === rec.n && (!q.clip.folder || !rec.folder || BQ.norm(q.clip.folder) === BQ.norm(rec.folder)))));
      if (users.length) { users.forEach(q => { if (q.clip.src !== 'lib' || !q.clip.url) { q.clip.key = rec.key; q.clip.src = 'file'; } }); linked++; continue; }
      const q = BQ.newQuestion(L(), clipFromFile(rec)); E.quiz.qs.push(q); added++; if (!first) first = q.id;
    }
    save(); if (first) E.sel = first; else if (!E.sel && E.quiz.qs[0]) E.sel = E.quiz.qs[0].id;
    renderList(); renderMain();
    BQ.toast([added ? `${added} ${added === 1 ? 'pregunta nueva' : 'preguntas nuevas'}` : '', linked ? `${linked} ${linked === 1 ? 'vídeo enlazado a su pregunta' : 'vídeos enlazados a sus preguntas'}` : ''].filter(Boolean).join(' · '));
  }
  async function openZip(f) {
    BQ.toast('Abriendo el zip…', 60000);
    try {
      const JSZip = await BQ.needZip(), z = await JSZip.loadAsync(f), list = [];
      for (const [p, ent] of Object.entries(z.files)) { if (ent.dir || !BQ.isVideo(p) || /__MACOSX/.test(p)) continue; const b = await ent.async('blob'); list.push({ path: p, file: new File([b], p.split('/').pop(), { type: /\.webm$/i.test(p) ? 'video/webm' : 'video/mp4' }) }); }
      await addFiles(list);
    } catch (err) { BQ.toast('No he podido abrir el zip: ' + err.message); }
  }
  async function readEntry(ent, path, out) {
    if (ent.isFile) { const f = await new Promise((res, rej) => ent.file(res, rej)); out.push({ path: path + f.name, file: f }); }
    else if (ent.isDirectory) { const rd = ent.createReader(); let batch; do { batch = await new Promise((res, rej) => rd.readEntries(res, rej)); for (const e of batch) await readEntry(e, path + ent.name + '/', out); } while (batch.length); }
  }
  async function onDrop(e) {
    if (E.live || !e.dataTransfer || !e.dataTransfer.files.length) return;
    e.preventDefault(); $$('.drop').forEach(d => d.classList.remove('over'));
    const files = [...e.dataTransfer.files];
    const json = files.find(f => /\.json$/i.test(f.name)); if (json) { importQuiz(await json.text(), json.name); return; }
    const zip = files.find(f => /\.zip$/i.test(f.name)); if (zip) { openZip(zip); return; }
    const ents = [...e.dataTransfer.items].map(i => i.webkitGetAsEntry && i.webkitGetAsEntry()).filter(Boolean), out = [];
    if (ents.length) { for (const ent of ents) await readEntry(ent, '', out); } else files.forEach(f => out.push({ path: f.name, file: f }));
    addFiles(out);
  }

  // ───────── biblioteca de BascatApp ─────────
  async function tryLibQuiet() { try { await BQ.loadLib(); renderList(); renderMain(); } catch (e) { /* sin biblioteca: se queda con los vídeos del ordenador */ } }
  async function libPicker(mode) {
    const m = BQ.modal(mode === 'pick' ? 'Elegir clip de la biblioteca' : 'Clips de la biblioteca de BascatApp', `<div class="libt" id="libT"><div class="row"><div class="spin" style="border-color:var(--line);border-top-color:var(--accent)"></div> Cargando la biblioteca…</div></div>`,
      mode === 'pick' ? '' : `<span class="muted grow" id="libN">Ninguno elegido</span><button class="btn" data-x2>Cancelar</button><button class="btn pri" id="libAdd" disabled>Añadir</button>`, { wide: true });
    if (mode !== 'pick') m.querySelector('[data-x2]').onclick = () => m.close();
    let rows;
    try { rows = BQ.lib.rows || await BQ.loadLib(); }
    catch (err) { m.querySelector('#libT').innerHTML = `<p class="warns">No he podido leer la biblioteca: ${esc(err.message)}</p><p class="muted">Puedes añadir los vídeos desde el ordenador (Añadir clips → Vídeos / Carpeta / Zip).</p>`; return; }
    if (!rows.length) { m.querySelector('#libT').innerHTML = '<p class="muted">La biblioteca no tiene clips todavía.</p>'; return; }
    const used = new Set(E.quiz.qs.map(q => q.clip && (q.clip.url || BQ.norm(q.clip.name))));
    let k = 0; const all = [];
    const clipRow = c => { const i = k++; all[i] = c; const ok = !!c.url; return `<div class="cl ${ok ? '' : 'na'}">${mode === 'pick' ? `<button class="btn sm" data-pick="${i}" ${ok ? '' : 'disabled'}>Elegir</button>` : `<input type="checkbox" data-c="${i}" ${ok ? '' : 'disabled'} aria-label="${esc(c.name)}">`}<span>${esc(c.name)}</span>${used.has(c.url) || used.has(c.n) ? '<span class="muted" style="font-size:12px">· ya está en el cuestionario</span>' : ''}<span class="d num">${ok ? (c.dur ? Math.round(c.dur) + ' s' : '') : 'solo marca de tiempo'}</span></div>`; };
    m.querySelector('#libT').innerHTML = rows.map((r, ri) => `<details ${ri === 0 ? 'open' : ''}><summary>${esc(r.name)}</summary>${r.teams.map(t => `<details open><summary>${esc(t.team)}</summary>${t.cats.map(c => `<details open><summary>${c.cat === 'ataque' ? 'Ataque' : c.cat === 'defensa' ? 'Defensa' : esc(c.cat)}</summary>${c.folders.map(f => `<details ${r.teams.length * t.cats.length * c.folders.length <= 6 ? 'open' : ''}><summary>${esc(f.name)} <span class="muted num">(${f.clips.length})</span>${mode === 'pick' ? '' : ` <button class="btn sm ghost" data-all>todos</button>`}</summary>${f.clips.map(clipRow).join('')}</details>`).join('')}</details>`).join('')}</details>`).join('')}</details>`).join('');
    const upd = () => { const n = m.querySelectorAll('input[data-c]:checked').length; const b = m.querySelector('#libAdd'); if (b) { b.disabled = !n; b.textContent = n ? `Añadir ${n} ${n === 1 ? 'clip' : 'clips'}` : 'Añadir'; } const s = m.querySelector('#libN'); if (s) s.textContent = n ? `${n} ${n === 1 ? 'clip elegido' : 'clips elegidos'} (una pregunta por clip)` : 'Ninguno elegido'; };
    m.querySelectorAll('input[data-c]').forEach(x => x.onchange = upd);
    m.querySelectorAll('[data-all]').forEach(b => b.onclick = e => { e.preventDefault(); const box = b.closest('details'); const cs = [...box.querySelectorAll('input[data-c]:not(:disabled)')]; const on = cs.some(x => !x.checked); cs.forEach(x => x.checked = on); box.open = true; upd(); });
    m.querySelectorAll('[data-pick]').forEach(b => b.onclick = () => { const c = all[+b.dataset.pick], q = curQ(); if (q) { q.clip = libClip(c); q.stop = null; q.from = 0; q.to = null; save(); renderList(); renderMain(); } m.close(); });
    const add = m.querySelector('#libAdd');
    if (add) add.onclick = () => {
      const cs = [...m.querySelectorAll('input[data-c]:checked')].map(x => all[+x.dataset.c]); let first = null;
      for (const c of cs) { const q = BQ.newQuestion(L(), libClip(c)); if (c.dur) q.clip.dur = c.dur; E.quiz.qs.push(q); if (!first) first = q.id; }
      save(); m.close(); if (first) select(first); BQ.toast(`${cs.length} ${cs.length === 1 ? 'pregunta nueva' : 'preguntas nuevas'}: falta decidir dónde para cada clip y las respuestas`, 5000);
    };
  }
  const libClip = c => ({ src: 'lib', url: c.url, name: c.name, folder: c.folder, lib: c.lib, dur: c.dur || null });

  // ───────── editor de la pregunta ─────────
  let tl = null; // estado de la línea de tiempo
  function renderMain() {
    const main = $('#main'); stopPreview();
    if (!E.quiz.qs.length) {
      main.innerHTML = `<div class="empty drop"><h2>Empieza añadiendo clips</h2><p>Cada clip será una pregunta: decides dónde se para, qué se pregunta y cuáles son las respuestas. Los jugadores contestan desde el móvil.</p>
        <div class="row"><button class="btn pri" id="eLib">De la biblioteca de BascatApp</button><label class="btn">Vídeos del ordenador<input type="file" accept="video/*,.mp4,.mov,.m4v,.webm" multiple id="eVids"></label><label class="btn">Importar cuestionario (.json)<input type="file" accept=".json" id="eImp"></label></div></div>`;
      $('#eLib').onclick = () => libPicker('add');
      $('#eVids').onchange = e => { addFiles([...e.target.files].map(f => ({ path: f.name, file: f }))); e.target.value = ''; };
      $('#eImp').onchange = async e => { const f = e.target.files[0]; e.target.value = ''; if (f) importQuiz(await f.text(), f.name); };
      E.v = null; return;
    }
    let q = curQ(); if (!q) { E.sel = E.quiz.qs[0].id; q = E.quiz.qs[0]; renderList(); }
    const lang = L(), src = BQ.resolveClip(q.clip), nOpts = q.opts.length;
    const presetsQ = lang === 'es' ? ['¿Cómo acaba la jugada?', '¿Qué debería hacer el defensor?', '¿Quién comete el error?', '¿Cómo defendemos este bloqueo?', '¿Cuál es el mejor pase?'] : ['Com acaba la jugada?', 'Què hauria de fer el defensor?', 'Qui comet l’error?', 'Com defensem aquest bloqueig?', 'Quina és la millor passada?'];
    const presetsO = lang === 'es' ? ['Triple', 'Canasta de 2', 'Falta y tiros libres', 'Tiro fallado y rebote nuestro', 'Rebote ofensivo y canasta', 'Pérdida', 'Falta en ataque', 'Tapón', 'Robo'] : ['Triple', 'Cistella de 2', 'Falta i tirs lliures', 'Tir fallat i rebot nostre', 'Rebot ofensiu i cistella', 'Pèrdua', 'Falta en atac', 'Tap', 'Robatori'];
    main.innerHTML = `<div class="qe">
  <div>
    <div class="vbox" id="vbox"><video id="ev" playsinline preload="auto"></video>${src ? '' : `<div class="nov"><div><b>${q.clip ? 'Falta el vídeo de este clip' : 'Esta pregunta no tiene clip'}</b><br><span style="opacity:.8">${q.clip ? esc(q.clip.name) + '<br>Cárgalo desde el ordenador o elígelo de la biblioteca.' : 'Elige uno de la biblioteca o del ordenador.'}</span></div></div>`}<div class="pov" id="pov" hidden></div></div>
    <div class="tl" id="tl" aria-label="Línea de tiempo del clip"><div class="tr"></div><div class="seg" id="segA"></div><div class="seg b" id="segB"></div><div class="ph" id="ph"></div>
      <div class="mk from" data-m="from" title="Inicio: desde aquí se reproduce"><b>Inicio</b><i></i></div><div class="mk stop" data-m="stop" title="Parada: aquí se congela y salen las respuestas"><b>Parada</b><i></i></div><div class="mk to" data-m="to" title="Final: hasta aquí se ve al enseñar la respuesta"><b>Final</b><i></i></div></div>
    <div class="ctrls">
      <button class="btn sm" id="cBack" title="Un fotograma atrás (←)">◀︎</button><button class="btn sm" id="cPlay" title="Reproducir / pausa (espacio)">▶︎</button><button class="btn sm" id="cFwd" title="Un fotograma adelante (→)">▶︎❙</button>
      <span class="tt num" id="cT">0.0</span><span class="sep"></span>
      <button class="btn sm" data-set="from">Inicio aquí <span class="kbd">I</span></button>
      <button class="btn sm pri" data-set="stop">Parada aquí <span class="kbd" style="color:inherit;border-color:rgba(255,255,255,.5)">P</span></button>
      <button class="btn sm" data-set="to">Final aquí <span class="kbd">F</span></button><span class="sep"></span>
      <button class="btn sm" id="cTest" title="Reproduce como en la partida (T)">Probar <span class="kbd">T</span></button>
    </div>
    <div class="clipinfo"><span>Clip: <b>${esc(q.clip ? q.clip.name : '—')}</b>${q.clip && q.clip.folder ? ` · ${esc(q.clip.folder)}` : ''}${src ? ` · ${src.how === 'lib' ? 'biblioteca (nube)' : 'ordenador'}` : ''}</span>
      <span class="grow"></span><button class="btn sm" id="cLib">Cambiar por uno de la biblioteca…</button><label class="btn sm">…o del ordenador<input type="file" accept="video/*,.mp4,.mov,.m4v,.webm" id="cFile"></label></div>
    <p class="hint" style="margin-top:8px">El nombre del clip no lo ve nadie (suele decir cómo acaba). En la partida solo se ve el texto de contexto y la pregunta.</p>
  </div>
  <div>
    <div class="f"><label for="fCtx">Contexto (se ve mientras corre el clip)</label><input type="text" id="fCtx" maxlength="80" placeholder="${lang === 'es' ? 'Ej.: Balance defensivo · 2º cuarto' : 'Ex.: Balanç defensiu · 2n quart'}"></div>
    <div class="f"><label for="fText">Pregunta</label><input type="text" id="fText" class="qtext" maxlength="120"><div class="chips">${presetsQ.map(p => `<button class="chip" data-qp="${esc(p)}">${esc(p)}</button>`).join('')}</div></div>
    <div class="f"><span class="lab">Respuestas · marca la correcta</span>
      <div class="opts" id="opts"></div>
      <div class="row" style="margin-top:2px">${nOpts < 4 ? '<button class="btn sm" id="oAdd">＋ Respuesta</button>' : ''}<button class="btn sm ghost" id="oYN">${lang === 'es' ? 'Sí / No' : 'Sí / No'}</button><button class="btn sm ghost" id="oClr">Vaciar</button></div>
      <div class="chips" style="margin-top:4px">${presetsO.map(p => `<button class="chip" data-op="${esc(p)}">${esc(p)}</button>`).join('')}</div></div>
    <div class="two">
      <div class="f"><label for="fLim">Tiempo para responder</label><select id="fLim">${[5, 10, 15, 20, 30, 45, 60, 90, 120].map(s => `<option value="${s}">${s} segundos</option>`).join('')}</select></div>
      <div class="f"><label for="fPts">Puntos</label><select id="fPts"><option value="1">Normales</option><option value="2">Dobles</option><option value="0">Sin puntos (para comentar)</option></select></div>
    </div>
    <div class="f"><label for="fExpl">Explicación al enseñar la respuesta (opcional)</label><textarea id="fExpl" maxlength="220" placeholder="${lang === 'es' ? 'Ej.: #44 no sale al flash → 2 puntos de #15' : 'Ex.: el #44 no surt al flash → 2 punts del #15'}"></textarea></div>
    <div class="f"><label class="row" style="text-transform:none;letter-spacing:0;font-size:14px;color:var(--ink);font-weight:500"><input type="checkbox" id="fOn"> Incluir esta pregunta en la partida</label></div>
    <div id="warn"></div>
  </div>
</div>`;
    const v = E.v = $('#ev');
    $('#fCtx').value = q.ctx; $('#fText').value = q.text; $('#fLim').value = String(q.lim); $('#fPts').value = String(q.pts); $('#fExpl').value = q.expl; $('#fOn').checked = q.on;
    $('#fCtx').oninput = e => { q.ctx = e.target.value; save(); };
    $('#fText').oninput = e => { q.text = e.target.value; save(); refreshListItem(); };
    $('#fLim').onchange = e => { q.lim = +e.target.value; save(); };
    $('#fPts').onchange = e => { q.pts = +e.target.value; save(); };
    $('#fExpl').oninput = e => { q.expl = e.target.value; save(); };
    $('#fOn').onchange = e => { q.on = e.target.checked; save(); renderList(); };
    $$('[data-qp]').forEach(b => b.onclick = () => { q.text = b.dataset.qp; $('#fText').value = q.text; save(); refreshListItem(); });
    $$('[data-op]').forEach(b => b.onclick = () => {
      const focusI = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.oi : null;
      let i = focusI != null ? +focusI : q.opts.findIndex(o => !o.t.trim());
      if (i < 0) { if (q.opts.length < 4) { q.opts.push({ t: '', ok: false }); i = q.opts.length - 1; } else { BQ.toast('Ya hay 4 respuestas: vacía una o escribe encima'); return; } }
      q.opts[i].t = b.dataset.op; save(); renderOpts(q); refreshListItem();
      const nx = $(`#opts input[data-oi="${q.opts.findIndex(o => !o.t.trim())}"]`); if (nx) nx.focus();
    });
    const oAdd = $('#oAdd'); if (oAdd) oAdd.onclick = () => { q.opts.push({ t: '', ok: false }); save(); renderMain(); };
    $('#oYN').onclick = () => { q.opts = [{ t: 'Sí', ok: false }, { t: 'No', ok: false }]; save(); renderMain(); };
    $('#oClr').onclick = () => { q.opts = [0, 1, 2, 3].map(() => ({ t: '', ok: false })); save(); renderMain(); };
    $('#cLib').onclick = () => libPicker('pick');
    $('#cFile').onchange = e => { const f = e.target.files[0]; e.target.value = ''; if (!f) return; const rec = BQ.addFile(f.name, f); BQ.cacheFile(rec); q.clip = clipFromFile(rec); q.stop = null; q.from = 0; q.to = null; save(); renderList(); renderMain(); };
    renderOpts(q); renderWarn(q);
    // vídeo y línea de tiempo
    tl = { q, dur: q.clip && q.clip.dur || 0 };
    if (src) {
      v.src = src.url;
      v.onloadedmetadata = () => {
        if (curQ() !== q) return;
        tl.dur = v.duration; if (q.clip && (!q.clip.dur || Math.abs(q.clip.dur - v.duration) > 0.05)) q.clip.dur = +v.duration.toFixed(2);
        if (q.stop == null) { q.stop = +Math.max(0.5, Math.min(v.duration - 0.2, v.duration - 2.5)).toFixed(2); save(); refreshListItem(); }
        if (q.to != null && q.to > v.duration) q.to = null;
        if (q.stop > v.duration) q.stop = +v.duration.toFixed(2);
        BQ.seek(v, q.stop).then(drawTL); drawTL(); renderWarn(q);
      };
      v.onerror = () => { if (curQ() === q) { $('#vbox').insertAdjacentHTML('beforeend', `<div class="nov"><div><b>No se puede reproducir este vídeo</b><br><span style="opacity:.8">${src.how === 'lib' ? 'Revisa la conexión a internet.' : 'Formato no compatible con este navegador.'}</span></div></div>`); } };
      v.ontimeupdate = drawPH; v.onplay = () => { $('#cPlay').textContent = '❚❚'; phLoop(); }; v.onpause = () => { const b = $('#cPlay'); if (b) b.textContent = '▶︎'; drawPH(); };
    }
    $('#cPlay').onclick = () => { if (!src) return; stopPreview(); if (v.paused) { BQ.stopSeg(v); v.play().catch(() => { }); } else v.pause(); };
    $('#cBack').onclick = () => step(-1 / 30); $('#cFwd').onclick = () => step(1 / 30);
    $$('[data-set]').forEach(b => b.onclick = () => setMark(b.dataset.set, v.currentTime));
    $('#cTest').onclick = () => test();
    initTL(); drawTL();
  }
  // en la lista manda el nombre del clip (las preguntas suelen repetirse); debajo, la pregunta y lo que falte
  function itemText(q, pr) { return `<div class="t1">${esc(q.clip ? clipLabel(q.clip) : (q.text || 'Pregunta sin texto'))}</div><div class="t2">${pr.length ? `<span class="w">${esc(pr[0])}</span> · ` : ''}${esc(q.clip ? (q.text || 'sin pregunta') : 'sin clip')}${q.stop != null ? ` · para en ${BQ.fmtT(q.stop)}` : ''}</div>`; }
  function refreshListItem() { const q = curQ(); if (!q) return; const li = $(`#qList .qi[data-id="${q.id}"]`); if (!li) return renderList(); li.querySelector('.tx').innerHTML = itemText(q, BQ.problems(q, q.clip ? !!BQ.resolveClip(q.clip) : null)); renderWarn(q); }
  function renderOpts(q) {
    $('#opts').innerHTML = q.opts.map((o, i) => `<div class="opt"><span class="sh bg${BQ.LETTERS[i]}" title="${BQ.LETTERS[i]}">${BQ.SHAPES[i]}</span><input type="text" data-oi="${i}" maxlength="70" value="${esc(o.t)}" placeholder="Respuesta ${BQ.LETTERS[i]}" aria-label="Respuesta ${BQ.LETTERS[i]}"><button class="okb ${o.ok ? 'on' : ''}" data-ok="${i}" aria-pressed="${o.ok}">${o.ok ? '✓ Correcta' : 'Correcta'}</button>${q.opts.length > 2 ? `<button class="x" data-rm="${i}" title="Quitar esta respuesta" aria-label="Quitar respuesta ${BQ.LETTERS[i]}">✕</button>` : '<span></span>'}</div>`).join('');
    $$('#opts input[data-oi]').forEach(inp => inp.oninput = () => { q.opts[+inp.dataset.oi].t = inp.value; save(); refreshListItem(); });
    $$('#opts [data-ok]').forEach(b => b.onclick = () => { const i = +b.dataset.ok; q.opts[i].ok = !q.opts[i].ok; save(); renderOpts(q); refreshListItem(); });
    $$('#opts [data-rm]').forEach(b => b.onclick = () => { q.opts.splice(+b.dataset.rm, 1); save(); renderMain(); });
  }
  function renderWarn(q) {
    const w = $('#warn'); if (!w) return; const pr = BQ.problems(q, q.clip ? !!BQ.resolveClip(q.clip) : null);
    const multi = BQ.liveOpts(q).filter(o => o.ok).length > 1;
    w.innerHTML = pr.length ? `<div class="warns">Falta: ${esc(pr.join(', '))}</div>` : `<div class="okmsg">Lista para jugar${multi ? ' · hay más de una respuesta correcta (cualquiera vale)' : ''}</div>`;
  }
  // línea de tiempo con las tres marcas
  function setMark(m, t) {
    const q = tl && tl.q; if (!q || !tl.dur) return; t = +BQ.clamp(t, 0, tl.dur).toFixed(2);
    const stop = q.stop == null ? tl.dur : q.stop, to = q.to == null ? tl.dur : q.to;
    if (m === 'from') q.from = Math.min(t, Math.max(0, stop - 0.2));
    else if (m === 'stop') { q.stop = Math.max(t, q.from + 0.2); if (q.stop > to) q.to = null; q.stop = Math.min(q.stop, tl.dur); }
    else if (m === 'to') { q.to = t >= tl.dur - 0.05 ? null : Math.max(t, stop); }
    q.from = +q.from.toFixed(2); save(); drawTL(); refreshListItem();
  }
  function initTL() {
    const el = $('#tl'); if (!el) return; let drag = null;
    const tAt = e => { const r = el.getBoundingClientRect(); return BQ.clamp((e.clientX - r.left) / r.width, 0, 1) * (tl.dur || 0); };
    el.onpointerdown = e => {
      if (!tl.dur) return; stopPreview(); BQ.stopSeg(E.v);
      const mk = e.target.closest('.mk'); drag = mk ? mk.dataset.m : 'seek'; el.setPointerCapture(e.pointerId);
      const t = tAt(e); if (drag === 'seek') E.v.currentTime = t; else { setMark(drag, t); E.v.currentTime = t; }
    };
    el.onpointermove = e => { if (!drag) return; const t = tAt(e); E.v.currentTime = t; if (drag !== 'seek') setMark(drag, t); };
    el.onpointerup = el.onpointercancel = () => { drag = null; };
  }
  function drawTL() {
    const q = tl && tl.q, el = $('#tl'); if (!q || !el) return; const D = tl.dur || 1;
    const pct = t => (BQ.clamp(t / D, 0, 1) * 100) + '%';
    const stop = q.stop == null ? D : q.stop, to = q.to == null ? D : q.to;
    el.querySelector('[data-m=from]').style.left = pct(q.from); el.querySelector('[data-m=stop]').style.left = pct(stop); el.querySelector('[data-m=to]').style.left = pct(to);
    el.querySelector('[data-m=to]').hidden = to >= D - 0.05 && stop >= D - 0.3;
    const a = $('#segA'), b = $('#segB'); a.style.left = pct(q.from); a.style.width = `calc(${pct(stop)} - ${pct(q.from)})`; b.style.left = pct(stop); b.style.width = `calc(${pct(to)} - ${pct(stop)})`;
    drawPH();
  }
  function drawPH() { const v = E.v, ph = $('#ph'), t = $('#cT'); if (!v || !ph || !tl) return; ph.style.left = (BQ.clamp(v.currentTime / (tl.dur || 1), 0, 1) * 100) + '%'; if (t) t.textContent = BQ.fmtT(v.currentTime) + (tl.dur ? ' / ' + BQ.fmtT(tl.dur) : ''); }
  function phLoop() { const v = E.v; if (!v || v.paused) return; drawPH(); requestAnimationFrame(phLoop); }
  function step(d) { const v = E.v; if (!v || !tl || !tl.dur) return; stopPreview(); BQ.stopSeg(v); v.pause(); v.currentTime = BQ.clamp(v.currentTime + d, 0, tl.dur); }
  // probar como en la partida: del inicio a la parada, respuestas encima, y el final
  function test() {
    const q = curQ(), v = E.v; if (!q || !v || !tl || !tl.dur) return; stopPreview();
    const stop = q.stop == null ? tl.dur : q.stop, to = q.to == null ? tl.dur : q.to;
    BQ.playSeg(v, q.from, stop, 1, () => {
      if (curQ() !== q) return; const pov = $('#pov'); if (!pov) return;
      const os = BQ.liveOpts(q);
      pov.innerHTML = `<div class="ptq">${esc(q.text)}</div>${os.map(o => `<div class="po bg${BQ.LETTERS[o.i]} ${o.ok ? 'ok' : ''}">${BQ.SHAPES[o.i]}<span>${esc(o.t)}</span></div>`).join('')}<div class="go"><button class="btn sm pri" id="pGo">${to - stop > 0.3 ? 'Ver cómo acaba ▶' : 'Volver a ver ▶'}</button> <button class="btn sm" id="pX">Cerrar</button></div>`;
      pov.hidden = false;
      $('#pGo').onclick = () => { pov.hidden = true; if (to - stop > 0.3) BQ.playSeg(v, stop, to, 1, null); else BQ.playSeg(v, q.from, to, 0.6, null); };
      $('#pX').onclick = () => { pov.hidden = true; };
    });
  }
  function stopPreview() { const p = $('#pov'); if (p) p.hidden = true; }
  function onKey(e) {
    if (E.live || $('.modal')) return;
    const tg = e.target, typing = tg && (tg.tagName === 'INPUT' && tg.type !== 'checkbox' || tg.tagName === 'TEXTAREA' || tg.tagName === 'SELECT');
    if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
    const v = E.v; if (!v || !tl || !tl.dur) return;
    if (e.key === ' ') { e.preventDefault(); $('#cPlay').click(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); step(e.shiftKey ? -1 : -1 / 30); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); step(e.shiftKey ? 1 : 1 / 30); }
    else if (e.key === 'i' || e.key === 'I') setMark('from', v.currentTime);
    else if (e.key === 'p' || e.key === 'P') setMark('stop', v.currentTime);
    else if (e.key === 'f' || e.key === 'F') setMark('to', v.currentTime);
    else if (e.key === 't' || e.key === 'T') test();
  }

  // ───────── ajustes ─────────
  function settings() {
    const c = BQ.cfg();
    const m = BQ.modal('Ajustes', `
      <div class="f"><label for="sPub">Dirección de la página para los móviles (va en el QR)</label><input type="text" id="sPub" class="inp" placeholder="${esc(BQ.joinBase())}"><span class="hint" style="margin:0">Vacío = esta misma página${/^https?:$/.test(location.protocol) ? '' : ' (abierta desde archivo: se usará ${esc(BQ.prettyUrl(BQ.HOME))})'}.</span></div>
      <div class="f"><label for="sNet">Conexión con los móviles</label><select id="sNet" class="inp"><option value="supa">Por internet (Supabase de BascatApp)</option><option value="local">Ensayo en este ordenador (pestañas del mismo navegador)</option></select></div>
      <div class="f"><label class="row" style="text-transform:none;letter-spacing:0;font-size:14px;color:var(--ink);font-weight:500"><input type="checkbox" id="sSnd"> Sonidos en la pantalla grande</label></div>
      <details><summary class="muted" style="cursor:pointer">Avanzado: proyecto de Supabase</summary>
        <div class="f" style="margin-top:10px"><label for="sUrl">URL</label><input type="text" id="sUrl" class="inp"></div>
        <div class="f"><label for="sKey">Clave pública (publishable / anon)</label><input type="text" id="sKey" class="inp"></div></details>
      <hr style="border:0;border-top:1px solid var(--line);margin:14px 0">
      <div class="row"><span class="muted grow" id="sFiles"></span><button class="btn sm danger" id="sForget">Olvidar vídeos guardados</button></div>`,
      `<button class="btn" data-c>Cancelar</button><button class="btn pri" data-s>Guardar</button>`);
    m.querySelector('#sPub').value = BQ.store.get('cfg', {}).pubUrl || ''; m.querySelector('#sNet').value = c.net; m.querySelector('#sSnd').checked = !!c.sound; m.querySelector('#sUrl').value = c.sbUrl; m.querySelector('#sKey').value = c.sbKey;
    m.querySelector('#sFiles').textContent = `${BQ.files.size} vídeos del ordenador guardados en este navegador`;
    m.querySelector('#sForget').onclick = async () => { await BQ.idb.clear(); BQ.files.forEach(f => URL.revokeObjectURL(f.url)); BQ.files.clear(); m.querySelector('#sFiles').textContent = 'Vídeos olvidados'; renderList(); renderMain(); };
    m.querySelector('[data-c]').onclick = () => m.close();
    m.querySelector('[data-s]').onclick = () => { BQ.setCfg({ pubUrl: m.querySelector('#sPub').value.trim(), net: m.querySelector('#sNet').value, sound: m.querySelector('#sSnd').checked, sbUrl: m.querySelector('#sUrl').value.trim() || c.sbUrl, sbKey: m.querySelector('#sKey').value.trim() || c.sbKey }); BQ.lib.rows = null; m.close(); BQ.toast('Ajustes guardados'); };
  }

  function help() {
    BQ.modal('Cómo funciona', `
      <ol style="margin:0 0 12px;padding-left:20px;display:flex;flex-direction:column;gap:8px">
        <li><b>Preparar.</b> Añade clips de la biblioteca de BascatApp o del ordenador: cada clip es una pregunta. Marca dónde empieza, dónde <b>se para</b> (ahí salen las respuestas) y hasta dónde se ve al enseñar la solución. Escribe la pregunta y de 2 a 4 respuestas, y marca la correcta. <b>Probar</b> lo reproduce como en la partida.</li>
        <li><b>Jugar.</b> En la pantalla grande sale un QR y un código de 5 letras. Los jugadores entran desde el móvil en <b>${esc(BQ.prettyUrl(BQ.joinBase()))}</b> y ponen su nombre.</li>
        <li><b>Tú mandas.</b> Con <b>Siguiente</b> (o la barra espaciadora): clip → se para → responden con tiempo → <b>Mostrar la respuesta</b> (se ve cómo acaba) → <b>Clasificación</b> → siguiente pregunta. Al final, podio y tabla de resultados (se puede descargar en CSV).</li>
      </ol>
      <p style="margin:0 0 8px"><b>Puntos:</b> hasta 1000 por acertar, menos cuanto más se tarda (nunca menos de 500), el doble en preguntas de puntos dobles. Cada acierto seguido a partir del segundo suma 100 más (hasta +500).</p>
      <p style="margin:0 0 8px"><b>Atajos al preparar:</b> espacio reproduce, ← → fotograma a fotograma (con Mayús, 1 segundo), <span class="kbd">I</span> inicio, <span class="kbd">P</span> parada, <span class="kbd">F</span> final, <span class="kbd">T</span> probar. <b>En la pantalla grande:</b> espacio o → siguiente, <span class="kbd">R</span> repetir el clip, <span class="kbd">F</span> pantalla completa.</p>
      <p style="margin:0" class="muted">Los cuestionarios se guardan en este navegador y, si conectas GitHub (botón de arriba), también allí con los resultados y los vídeos del ordenador: así los tienes en cualquier ordenador. Sin GitHub, con Cuestionarios → Exportar los pasas a mano. Los vídeos de la biblioteca se ven desde cualquier sitio; los del ordenador solo en el que los cargaste. Si la página se recarga a media partida, al volver a abrirla puedes continuarla.</p>`);
  }

  // ───────── resultados de partidas anteriores ─────────
  async function history(focusIdx) {
    if (BQ.gh.ok()) { BQ.toast('Mirando resultados en GitHub…', 8000); await pullResults(); BQ.toast('Resultados al día', 1200); }
    const H = BQ.store.get('hist', []);
    if (!H.length) { BQ.modal('Resultados', `<p class="muted">Todavía no hay partidas terminadas${BQ.gh.ok() ? '' : ' en este navegador'}.</p>`); return; }
    const m = BQ.modal('Resultados', `<div class="row" style="margin-bottom:10px"><select id="hSel" class="inp" style="max-width:480px">${H.map((h, i) => `<option value="${i}">${esc(new Date(h.date).toLocaleString('es-ES', { dateStyle: 'medium', timeStyle: 'short' }))} · ${esc(h.title)} · ${h.players.length} jugadores</option>`).join('')}</select><span class="grow"></span><button class="btn sm" id="hCsv">Descargar CSV</button><button class="btn sm danger" id="hDel">Borrar</button></div><div id="hBody" class="scrollx"></div>`, '', { wide: true });
    const show = i => { const h = H[i]; m.querySelector('#hBody').innerHTML = BQ.resultsTable(h); };
    const sel = m.querySelector('#hSel'); sel.value = String(focusIdx || 0); sel.onchange = () => show(+sel.value); show(+sel.value);
    m.querySelector('#hCsv').onclick = () => { const h = H[+sel.value]; BQ.download(BQ.slug(h.title) + '_' + new Date(h.date).toISOString().slice(0, 10) + '.csv', BQ.resultsCsv(h), 'text/csv'); };
    m.querySelector('#hDel').onclick = async () => { const i = +sel.value; if (!await BQ.ask('Borrar resultados', 'Se borrarán los resultados de esta partida.', 'Borrar', true)) return; const [h] = H.splice(i, 1); BQ.store.set('hist', H); m.close(); if (h && h.gh && BQ.gh.ok()) { try { const r = await BQ.gh.getJSON(h.gh); await BQ.gh.del(h.gh, r.sha, 'Borrar resultados'); } catch (e) { } } if (H.length) history(0); };
  }
  BQ.history = history;
  BQ.resultsTable = h => {
    const qs = h.qs, ps = h.players;
    return `<table class="tbl"><thead><tr><th>#</th><th>Jugador</th><th>Puntos</th><th>Aciertos</th>${qs.map((q, i) => `<th class="c" title="${esc(q.text)}">P${i + 1}</th>`).join('')}</tr></thead><tbody>` +
      ps.map((p, r) => `<tr><td class="num">${r + 1}</td><td>${esc(p.name)}</td><td class="num">${BQ.fmtN(p.score)}</td><td class="num">${p.ans.filter(a => a && a.ok).length} / ${qs.length}</td>${qs.map((q, i) => { const a = p.ans[i]; return `<td class="c ${a ? (a.ok ? 'y' : 'n') : ''}" title="${a ? esc((q.opts[a.o] || '?') + ' · ' + (a.ms / 1000).toFixed(1) + ' s') : 'sin respuesta'}">${a ? (a.ok ? '✓' : '✗') + ' ' + BQ.LETTERS[a.o] : '–'}</td>`; }).join('')}</tr>`).join('') +
      `</tbody><tfoot><tr><td></td><td class="muted">% de acierto</td><td></td><td></td>${qs.map((q, i) => { const n = ps.filter(p => p.ans[i]).length, k = ps.filter(p => p.ans[i] && p.ans[i].ok).length; return `<td class="c num">${n ? Math.round(100 * k / ps.length) + '%' : '–'}</td>`; }).join('')}</tr></tfoot></table>` +
      `<ol class="muted" style="font-size:13px;margin-top:12px">${qs.map(q => `<li>${esc(q.text)} — <b>${esc(q.opts.filter((o, j) => q.ok.includes(j)).join(' / '))}</b>${q.ctx ? ' · ' + esc(q.ctx) : ''}</li>`).join('')}</ol>`;
  };
  BQ.resultsCsv = h => {
    const q = s => '"' + String(s).replace(/"/g, '""') + '"';
    const head = ['Puesto', 'Jugador', 'Puntos', 'Aciertos', ...h.qs.map((x, i) => `P${i + 1} ${x.text}`)];
    const rows = h.players.map((p, r) => [r + 1, p.name, p.score, p.ans.filter(a => a && a.ok).length, ...h.qs.map((x, i) => { const a = p.ans[i]; return a ? `${a.ok ? 'OK' : 'NO'} ${x.opts[a.o] || ''} (${(a.ms / 1000).toFixed(1)} s, ${a.pts} pts)` : ''; })]);
    return '﻿' + [head, ...rows].map(r => r.map(q).join(';')).join('\r\n');
  };

  // ───────── jugar ─────────
  async function startGame() {
    const qs = E.quiz.qs.filter(q => q.on);
    if (!qs.length) { BQ.toast('No hay preguntas activas'); return; }
    const bad = qs.map((q, i) => ({ i, q, pr: BQ.problems(q, q.clip ? !!BQ.resolveClip(q.clip) : null).filter(p => p !== 'falta el vídeo' && p !== 'sin clip') })).filter(x => x.pr.length);
    if (bad.length) { select(bad[0].q.id); BQ.toast(`La pregunta ${bad[0].i + 1} no está lista: ${bad[0].pr.join(', ')}`, 5000); return; }
    const noVid = qs.filter(q => !BQ.resolveClip(q.clip)).length;
    if (noVid && !await BQ.ask('Faltan vídeos', `${noVid} ${noVid === 1 ? 'pregunta no tiene' : 'preguntas no tienen'} el vídeo cargado. Se jugarán solo con el texto. ¿Seguir?`, 'Jugar igualmente')) return;
    if (E.v) E.v.pause();
    BQ.sound.unlock();
    BQ.Live.start(E.quiz);
  }

  // ───────── arranque del editor ─────────
  E.boot = async (o = {}) => {
    shell();
    const cur = BQ.store.get('cur', null);
    if (!(cur && openQuiz(cur))) { const first = index()[0]; if (!(first && openQuiz(first.id))) newQuiz('Nuevo cuestionario'); }
    const n = await BQ.loadCached(); if (n) { renderList(); renderMain(); }
    if (E.quiz.qs.some(q => q.clip && !BQ.resolveClip(q.clip))) tryLibQuiet();
    if (BQ.Live.pending()) BQ.Live.offerResume();
    if (BQ.gh.configured()) { await ghSync(); if (o.invited) ghWindow(true); }
    else if (o.invited === false) BQ.toast('El enlace de invitación no es válido');
  };
  E.refresh = () => { renderList(); renderMain(); };
})();
