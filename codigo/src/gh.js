/* BascatQuiz · guardado en GitHub: cuestionarios, resultados y vídeos del ordenador van al mismo repositorio de la
   página, en una rama aparte («datos») para que guardar no vuelva a publicar la web cada vez. Se usa la API de GitHub
   con un token que solo vive en este navegador. Siempre se guarda primero aquí; GitHub es la copia para otro ordenador. */
(function () {
  'use strict';
  const BQ = window.BQ;
  const G = BQ.gh = { state: 'off', err: '', busy: 0 };
  const subs = new Set();
  G.on = f => { subs.add(f); return () => subs.delete(f); };
  const set = (st, err) => { G.state = st; G.err = err || ''; subs.forEach(f => { try { f(st); } catch (e) { } }); };
  G.DEF_REPO = 'Gonzalo2377/bascatquiz'; G.BRANCH = 'datos';
  G.cfg = () => Object.assign({ token: '', repo: G.DEF_REPO }, BQ.store.get('gh', {}));
  G.setCfg = p => { BQ.store.set('gh', Object.assign(G.cfg(), p)); };
  G.configured = () => { const c = G.cfg(); return !!(c.token && /^[\w.-]+\/[\w.-]+$/.test(c.repo)); };
  G.ok = () => G.state === 'ok' || G.state === 'saving';
  G.fail = e => set('error', e && e.status === 403 ? 'el token no tiene permiso para guardar (en el token: Contents → Read and write)' : e && e.status === 401 ? 'el token no es válido o ha caducado' : (e && e.message) || 'sin conexión con GitHub');

  // texto ↔ base64 (UTF-8) y archivos ↔ base64
  const b64enc = str => { const b = new TextEncoder().encode(str); let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(s); };
  const b64dec = b64 => { const s = atob(String(b64).replace(/\s/g, '')), b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i); return new TextDecoder().decode(b); };
  const blobB64 = blob => new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1] || ''); fr.onerror = () => rej(fr.error); fr.readAsDataURL(blob); });

  async function api(method, path, body, o = {}) {
    const c = G.cfg();
    const r = await fetch('https://api.github.com/repos/' + c.repo + path, {
      method, keepalive: !!o.keepalive, cache: 'no-store',
      headers: Object.assign({ Authorization: 'Bearer ' + c.token, Accept: o.accept || 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }, body ? { 'Content-Type': 'application/json' } : {}),
      body: body ? JSON.stringify(body) : undefined,
    });
    if (o.raw) { if (!r.ok) throw httpErr(r, await r.text().catch(() => '')); return r; }
    const txt = await r.text(); let j = null; try { j = txt ? JSON.parse(txt) : null; } catch (e) { }
    if (!r.ok) throw httpErr(r, j && j.message || txt);
    return j;
  }
  function httpErr(r, msg) { const e = new Error(msg || ('HTTP ' + r.status)); e.status = r.status; return e; }
  const enc = p => p.split('/').map(encodeURIComponent).join('/');
  // todas las escrituras en fila, de una en una (si no, GitHub rechaza cambios simultáneos)
  let chain = Promise.resolve();
  const queue = fn => { const p = chain.then(fn, fn); chain = p.catch(() => { }); return p; };
  const busy = async fn => { G.busy++; set('saving'); try { return await fn(); } finally { G.busy--; if (!G.busy && G.state === 'saving') set('ok'); } };

  // la rama «datos» se crea sola la primera vez (a partir de la principal)
  async function ensureBranch(j) {
    try { await api('GET', '/branches/' + G.BRANCH); return; } catch (e) { if (e.status !== 404) throw e; }
    const main = j.default_branch || 'main', ref = await api('GET', '/git/ref/heads/' + enc(main));
    await api('POST', '/git/refs', { ref: 'refs/heads/' + G.BRANCH, sha: ref.object.sha });
  }
  G.check = async () => {
    if (!G.configured()) { set('off'); return false; }
    set('checking');
    try {
      const j = await api('GET', '');
      if (!j.permissions || !j.permissions.push) { set('error', 'el token no tiene permiso para escribir en ' + G.cfg().repo); return false; }
      G.private = !!j.private; await ensureBranch(j); set('ok'); return true;
    } catch (e) {
      set('error', e.status === 401 ? 'el token no es válido o ha caducado' : e.status === 404 ? 'no encuentro el repositorio ' + G.cfg().repo + ' (o el token no tiene acceso)' : (e.message || 'sin conexión'));
      return false;
    }
  };
  // carpeta → [{name, path, sha, size}] (vacía si aún no existe)
  const REF = () => '?ref=' + encodeURIComponent(G.BRANCH);
  G.list = async dir => { try { const j = await api('GET', '/contents/' + enc(dir) + REF()); return Array.isArray(j) ? j.filter(x => x.type === 'file') : []; } catch (e) { if (e.status === 404) return []; throw e; } };
  G.getJSON = async path => { const j = await api('GET', '/contents/' + enc(path) + REF()); return { sha: j.sha, data: JSON.parse(b64dec(j.content || '')) }; };
  G.putJSON = (path, obj, sha, msg, o = {}) => queue(() => busy(async () => {
    const body = { message: msg || 'BascatQuiz: ' + path, content: b64enc(JSON.stringify(obj, null, 1)), branch: G.BRANCH }; if (sha) body.sha = sha;
    const j = await api('PUT', '/contents/' + enc(path), body, o); return j.content.sha;
  }));
  G.del = (path, sha, msg) => queue(() => busy(async () => { await api('DELETE', '/contents/' + enc(path), { message: msg || 'BascatQuiz: borrar ' + path, sha, branch: G.BRANCH }); }));
  G.putBlob = (path, blob, msg) => queue(() => busy(async () => {
    let sha; try { const j = await api('GET', '/contents/' + enc(path) + REF()); sha = j.sha; } catch (e) { if (e.status !== 404) throw e; }
    if (sha) return sha; // ya estaba
    const j = await api('PUT', '/contents/' + enc(path), { message: msg || 'BascatQuiz: vídeo ' + path, content: await blobB64(blob), branch: G.BRANCH });
    return j.content.sha;
  }));
  G.getBlob = async (path, type) => { const r = await api('GET', '/contents/' + enc(path) + REF(), null, { accept: 'application/vnd.github.raw+json', raw: true }); const b = await r.blob(); return type ? new Blob([b], { type }) : b; };
})();
