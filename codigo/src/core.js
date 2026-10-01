/* BascatQuiz · base común: utilidades, guardado local, conexión en directo, puntuación y vídeos.
   Todo vive en window.BQ para que el editor, la pantalla del staff y el móvil compartan lo mismo. */
(function () {
  'use strict';
  const BQ = window.BQ = {};

  // ── utilidades ──
  BQ.$ = (s, r) => (r || document).querySelector(s);
  BQ.$$ = (s, r) => [...(r || document).querySelectorAll(s)];
  BQ.esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  BQ.uid = (n = 8) => { const a = 'abcdefghijkmnopqrstuvwxyz23456789'; let s = ''; const r = crypto.getRandomValues(new Uint8Array(n)); for (const x of r) s += a[x % a.length]; return s; };
  BQ.code = () => { const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let s = ''; const r = crypto.getRandomValues(new Uint8Array(5)); for (const x of r) s += a[x % a.length]; return s; };
  BQ.clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  BQ.fmtT = s => { if (s == null || !isFinite(s)) return '–'; const m = Math.floor(s / 60), r = s - 60 * m; return (m ? m + ':' + (r < 10 ? '0' : '') : '') + r.toFixed(1); };
  BQ.fmtN = n => Math.round(n).toLocaleString('es-ES');
  BQ.norm = s => String(s || '').normalize('NFC').toLowerCase().replace(/\.[a-z0-9]{2,4}$/i, '').replace(/[_\s]+/g, ' ').trim();
  BQ.sleep = ms => new Promise(r => setTimeout(r, ms));
  BQ.clone = o => JSON.parse(JSON.stringify(o));

  let toastT = null;
  BQ.toast = (msg, ms = 3200) => {
    let el = BQ.$('#toast'); if (!el) { el = document.createElement('div'); el.id = 'toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
    el.textContent = msg; el.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('on'), ms);
  };

  // ── guardado en este navegador ──
  BQ.store = {
    get(k, d) { try { const v = localStorage.getItem('bqz.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('bqz.' + k, JSON.stringify(v)); return true; } catch (e) { return false; } },
    del(k) { try { localStorage.removeItem('bqz.' + k); } catch (e) { } },
  };

  // Vídeos del ordenador guardados en el navegador, para no tener que volver a elegirlos cada vez
  const IDB = { db: null };
  IDB.open = () => IDB.db || (IDB.db = new Promise((res, rej) => {
    try {
      const r = indexedDB.open('bqz', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('files', { keyPath: 'key' });
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    } catch (e) { rej(e); }
  }).catch(() => null));
  IDB.tx = async (mode, fn) => { const db = await IDB.open(); if (!db) return null; return new Promise(res => { try { const t = db.transaction('files', mode), st = t.objectStore('files'); const out = fn(st); t.oncomplete = () => res(out && out.result !== undefined ? out.result : true); t.onerror = () => res(null); t.onabort = () => res(null); } catch (e) { res(null); } }); };
  BQ.idb = {
    put: (rec) => IDB.tx('readwrite', st => st.put(rec)),
    all: () => IDB.tx('readonly', st => st.getAll()),
    del: (key) => IDB.tx('readwrite', st => st.delete(key)),
    clear: () => IDB.tx('readwrite', st => st.clear()),
  };

  // ── ajustes ──
  // La web de BascatApp ya usa este proyecto de Supabase (clave pública); aquí solo se usa su canal en directo
  // y, para el staff, la lista de clips de la biblioteca.
  const DEF = { sbUrl: 'https://amjxnjxjtakgsfpisnbq.supabase.co', sbKey: 'sb_publishable_zDk6pygUKObV7uRHWYCGxw_FpAqfR6B', pubUrl: '', sound: true, net: 'supa' };
  BQ.cfg = () => Object.assign({}, DEF, BQ.store.get('cfg', {}));
  BQ.setCfg = patch => { const c = Object.assign(BQ.store.get('cfg', {}), patch); BQ.store.set('cfg', c); BQ._sb = null; };
  // dirección que se pone en el QR para los móviles
  BQ.HOME = 'https://gonzalo2377.github.io/bascatquiz/'; // donde vive la página publicada (repositorio propio, aparte de BascatApp)
  BQ.joinBase = (net) => {
    const c = BQ.cfg();
    if (net === 'local') return location.href.replace(/#.*$/, ''); // ensayo: pestañas de este mismo navegador
    if (c.pubUrl) return c.pubUrl.replace(/#.*$/, '');
    if (/^https?:$/.test(location.protocol)) return location.origin + location.pathname;
    return BQ.HOME;
  };
  BQ.joinUrl = (code, net) => BQ.joinBase(net) + '#' + code + (net === 'local' ? '.local' : '');
  BQ.prettyUrl = u => u.replace(/^https?:\/\/(www\.)?/, '');

  BQ.sb = () => {
    if (BQ._sb) return BQ._sb;
    if (!window.supabase || !window.supabase.createClient) return null;
    const c = BQ.cfg();
    try { BQ._sb = window.supabase.createClient(c.sbUrl, c.sbKey, { auth: { persistSession: false, autoRefreshToken: false }, realtime: { params: { eventsPerSecond: 30 } } }); } catch (e) { BQ._sb = null; }
    return BQ._sb;
  };

  // ── conexión en directo ──
  // open(código, {msg(evento, datos), status('ok'|'err'|'off')}) → {send(evento, datos) → Promise<bool>, close()}
  // 'supa': canal de Supabase Realtime (los móviles desde cualquier sitio). 'local': solo pestañas de este navegador (para ensayar).
  BQ.net = {
    open(code, net, h) {
      if (net === 'local') return openLocal(code, h);
      return openSupa(code, h);
    },
  };
  function openSupa(code, h) {
    const sb = BQ.sb();
    if (!sb) { setTimeout(() => h.status('err', new Error('No se ha podido cargar la conexión')), 0); return { send: async () => false, close() { } }; }
    const ch = sb.channel('bqz-' + code, { config: { broadcast: { self: false, ack: true } } });
    ch.on('broadcast', { event: '*' }, m => { try { h.msg(m.event, m.payload || {}); } catch (e) { console.error(e); } });
    ch.subscribe((st, err) => h.status(st === 'SUBSCRIBED' ? 'ok' : st === 'CLOSED' ? 'off' : 'err', err));
    return {
      async send(ev, data) { try { return (await ch.send({ type: 'broadcast', event: ev, payload: data })) === 'ok'; } catch (e) { return false; } },
      close() { try { sb.removeChannel(ch); } catch (e) { } },
    };
  }
  function openLocal(code, h) {
    const bc = new BroadcastChannel('bqz-' + code);
    bc.onmessage = e => { try { h.msg(e.data.ev, e.data.d || {}); } catch (err) { console.error(err); } };
    setTimeout(() => h.status('ok'), 30);
    return { async send(ev, d) { bc.postMessage({ ev, d }); return true; }, close() { bc.close(); } };
  }

  // ── preguntas ──
  BQ.SHAPES = [
    '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M16 4 L29 27 H3 Z"/></svg>',
    '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M16 3 L29 16 L16 29 L3 16 Z"/></svg>',
    '<svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="12.5"/></svg>',
    '<svg viewBox="0 0 32 32" aria-hidden="true"><rect x="5" y="5" width="22" height="22" rx="2"/></svg>',
  ];
  BQ.LETTERS = ['A', 'B', 'C', 'D'];
  BQ.newQuestion = (lang, clip) => ({
    id: BQ.uid(6), on: true, clip: clip || null, from: 0, stop: null, to: null,
    ctx: '', text: lang === 'es' ? '¿Cómo acaba la jugada?' : 'Com acaba la jugada?',
    opts: [{ t: '', ok: false }, { t: '', ok: false }, { t: '', ok: false }, { t: '', ok: false }],
    lim: 20, pts: 1, expl: '',
  });
  BQ.newQuiz = (title, lang) => ({ v: 1, id: BQ.uid(8), title: title || 'Nuevo cuestionario', lang: lang || 'ca', created: Date.now(), updated: Date.now(), qs: [] });
  // opciones que se juegan (las vacías no cuentan)
  BQ.liveOpts = q => q.opts.map((o, i) => ({ t: (o.t || '').trim(), ok: !!o.ok, i })).filter(o => o.t);
  BQ.problems = (q, clipOk) => {
    const p = [], o = BQ.liveOpts(q);
    if (!q.clip) p.push('sin clip'); else if (clipOk === false) p.push('falta el vídeo');
    if (!(q.text || '').trim()) p.push('sin pregunta');
    if (o.length < 2) p.push('menos de 2 respuestas');
    else if (!o.some(x => x.ok)) p.push('ninguna correcta');
    if (q.stop == null) p.push('sin parada');
    return p;
  };

  // Puntos: hasta 1000 por acertar, menos cuanto más se tarda (la mitad si se apura el tiempo), ×2 en preguntas dobles.
  // Racha: +100 por cada acierto seguido a partir del segundo (máx. +500).
  BQ.points = (q, ms, streak) => {
    if (!q.pts) return 0;
    const T = Math.max(1, q.lim) * 1000, f = 1 - BQ.clamp(ms / T, 0, 1) / 2;
    return Math.round(1000 * f) * q.pts + (streak >= 2 ? Math.min(5, streak - 1) * 100 : 0);
  };

  // ── vídeos ──
  // Vídeos del ordenador cargados en esta sesión: clave (ruta) → {file, url, name, n (nombre normalizado)}
  BQ.files = new Map();
  BQ.isVideo = n => /\.(mp4|mov|m4v|webm|mkv)$/i.test(n);
  BQ.addFile = (key, file) => {
    key = key.replace(/^\/+/, '').normalize('NFC');
    const prev = BQ.files.get(key); if (prev && prev.url) URL.revokeObjectURL(prev.url);
    const rec = { key, file, url: URL.createObjectURL(file), name: key.split('/').pop().replace(/\.[a-z0-9]{2,4}$/i, ''), n: BQ.norm(key.split('/').pop()) };
    const parts = key.split('/'); rec.folder = parts.length > 1 ? parts[parts.length - 2] : '';
    BQ.files.set(key, rec); return rec;
  };
  BQ.cacheFile = rec => BQ.idb.put({ key: rec.key, blob: rec.file, type: rec.file.type, size: rec.file.size, t: Date.now() });
  BQ.loadCached = async () => {
    const all = await BQ.idb.all(); if (!all) return 0;
    let n = 0; for (const r of all) { if (!BQ.files.has(r.key) && r.blob) { BQ.addFile(r.key, new File([r.blob], r.key.split('/').pop(), { type: r.type || 'video/mp4' })); n++; } }
    return n;
  };
  // Biblioteca de BascatApp: clips subidos a la nube (Cloudinary), organizados por partido → equipo → ataque/defensa → carpeta
  BQ.lib = { rows: null, clips: [] };
  BQ.loadLib = async () => {
    const sb = BQ.sb(); if (!sb) throw new Error('Sin conexión con la base de datos de BascatApp');
    const { data, error } = await sb.from('matches').select('id,nm:match_data->>name,home:match_data->>homeTeam,away:match_data->>awayTeam,vc:match_data->videoClips').not('match_data->videoClips', 'is', null);
    if (error) throw new Error(error.message || 'No se ha podido leer la biblioteca');
    const rows = [], clips = [];
    for (const r of data || []) {
      const vc = r.vc || {}, lib = r.nm || ((r.home || '') + ' vs ' + (r.away || '')), row = { id: r.id, name: lib, created: vc.created || 0, teams: [] };
      for (const [team, cats] of Object.entries(vc.teams || {})) {
        const t = { team, cats: [] };
        for (const cat of ['ataque', 'defensa', ...Object.keys(cats || {}).filter(c => c !== 'ataque' && c !== 'defensa')]) {
          const folders = (cats || {})[cat]; if (!folders) continue;
          const c = { cat, folders: [] };
          for (const f of Object.keys(folders).sort((a, b) => a.localeCompare(b, 'es'))) {
            const list = (folders[f] || []).slice().sort((a, b) => (a.timeSecs || 0) - (b.timeSecs || 0)).map(cl => {
              const x = { src: 'lib', id: String(cl.id), name: cl.label || f, folder: f, lib, team, cat, url: cl.videoUrl || null, dur: cl.dur || (cl.timeEnd && cl.timeSecs != null ? cl.timeEnd - cl.timeSecs : null), n: BQ.norm(cl.label || '') };
              clips.push(x); return x;
            });
            c.folders.push({ name: f, clips: list });
          }
          if (c.folders.length) t.cats.push(c);
        }
        if (t.cats.length) row.teams.push(t);
      }
      if (row.teams.length) rows.push(row);
    }
    rows.sort((a, b) => (b.created || 0) - (a.created || 0));
    BQ.lib.rows = rows; BQ.lib.clips = clips;
    return rows;
  };
  // ¿De dónde sale el vídeo de esta pregunta? → {url, how:'file'|'lib'} o null
  BQ.resolveClip = (clip) => {
    if (!clip) return null;
    if (clip.key && BQ.files.has(clip.key)) return { url: BQ.files.get(clip.key).url, how: 'file' };
    const n = BQ.norm(clip.name);
    if (n) {
      const cands = [...BQ.files.values()].filter(f => f.n === n);
      const f = cands.find(f => !clip.folder || BQ.norm(f.folder) === BQ.norm(clip.folder)) || cands[0];
      if (f) return { url: f.url, how: 'file', key: f.key };
    }
    if (clip.url) return { url: clip.url, how: 'lib' };
    if (n && BQ.lib.clips.length) {
      const cands = BQ.lib.clips.filter(c => c.url && c.n === n);
      const c = cands.find(c => (!clip.folder || BQ.norm(c.folder) === BQ.norm(clip.folder)) && (!clip.lib || BQ.norm(c.lib) === BQ.norm(clip.lib))) || cands[0];
      if (c) return { url: c.url, how: 'lib', lib: c };
    }
    return null;
  };

  // Reproduce [a, b] y llama a onEnd al llegar a b (se queda parado justo en b)
  BQ.playSeg = (v, a, b, rate, onEnd) => {
    const tok = {}; v._seg = tok; v.pause(); v.playbackRate = rate || 1;
    const go = () => {
      if (v._seg !== tok) return;
      const loop = () => {
        if (v._seg !== tok) return;
        if (v.currentTime >= b - 0.03 || v.ended) { v.pause(); if (Math.abs(v.currentTime - b) > 0.04) v.currentTime = b; v._seg = null; onEnd && onEnd(); return; }
        requestAnimationFrame(loop);
      };
      v.play().then(() => requestAnimationFrame(loop)).catch(() => { v.muted = true; v.play().then(() => requestAnimationFrame(loop)).catch(() => { v._seg = null; onEnd && onEnd(); }); });
    };
    if (Math.abs(v.currentTime - a) > 0.05) { v.addEventListener('seeked', go, { once: true }); v.currentTime = a; } else go();
    return () => { if (v._seg === tok) { v._seg = null; v.pause(); } };
  };
  BQ.stopSeg = v => { v._seg = null; v.pause(); };
  BQ.seek = (v, t) => new Promise(res => { if (!isFinite(t)) return res(); if (Math.abs(v.currentTime - t) < 0.01 && v.readyState >= 2) return res(); let done = false; const fin = () => { if (!done) { done = true; res(); } }; v.addEventListener('seeked', fin, { once: true }); setTimeout(fin, 3000); v.currentTime = t; });

  // carga perezosa de JSZip para abrir zips
  BQ.needZip = () => window.JSZip ? Promise.resolve(window.JSZip) : new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js'; s.onload = () => res(window.JSZip); s.onerror = () => rej(new Error('No se ha podido cargar el lector de zip')); document.head.appendChild(s); });

  // ── sonido (pantalla del staff) ──
  let AC = null;
  BQ.sound = {
    unlock() { try { AC = AC || new (window.AudioContext || window.webkitAudioContext)(); if (AC.state === 'suspended') AC.resume(); } catch (e) { } },
    beep(f, d, type, vol, at) {
      if (!AC || !BQ.cfg().sound) return; const t = AC.currentTime + (at || 0);
      const o = AC.createOscillator(), g = AC.createGain(); o.type = type || 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol || 0.18, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
      o.connect(g); g.connect(AC.destination); o.start(t); o.stop(t + d + 0.05);
    },
    tick() { this.beep(1150, 0.07, 'square', 0.06); },
    join() { this.beep(660, 0.09, 'triangle', 0.12); this.beep(990, 0.12, 'triangle', 0.1, 0.07); },
    open() { this.beep(523, 0.14, 'triangle', 0.14); this.beep(784, 0.2, 'triangle', 0.14, 0.1); },
    end() { this.beep(220, 0.5, 'sawtooth', 0.09); this.beep(165, 0.6, 'sawtooth', 0.07, 0.08); },
    reveal() { [523, 659, 784, 1047].forEach((f, i) => this.beep(f, 0.22, 'triangle', 0.12, i * 0.09)); },
    fanfare() { [392, 523, 659, 784, 659, 784, 1047].forEach((f, i) => this.beep(f, 0.3, 'triangle', 0.12, i * 0.13)); },
  };

  // descarga de un archivo generado (CSV, JSON)
  BQ.download = (name, text, type) => {
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: type || 'application/octet-stream' })); a.download = name;
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  };
  BQ.slug = s => BQ.norm(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'cuestionario';
})();
