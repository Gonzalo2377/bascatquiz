#!/usr/bin/env python3
"""Junta BascatQuiz en un solo archivo: dist/quiz.html"""
import pathlib, re
R = pathlib.Path(__file__).parent
src = (R / 'src' / 'index.html').read_text()
libs = [R / 'node_modules/@supabase/supabase-js/dist/umd/supabase.js', R / 'node_modules/qrcode-generator/qrcode.js']
app = ['core.js', 'i18n.js', 'gh.js', 'editor.js', 'live.js', 'player.js', 'main.js']
def safe(js): return js.replace('</script', '<\\/script').replace('<!--', '<\\!--')
L = '\n'.join(safe(p.read_text()) for p in libs)
A = '\n'.join(safe((R / 'src' / f).read_text()) for f in app)
out = src.replace('/*@@LIBS@@*/', L).replace('/*@@APP@@*/', A)
(R / 'dist').mkdir(exist_ok=True)
(R / 'dist' / 'quiz.html').write_text(out)
print('dist/quiz.html', len(out.encode()) // 1024, 'KB')
