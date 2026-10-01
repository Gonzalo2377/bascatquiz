# Código de BascatQuiz

La página publicada es `index.html` (en la raíz del repositorio), que se genera juntando estos archivos:

- `src/index.html` — estructura y estilos
- `src/core.js` — utilidades, conexión en directo, puntos y vídeos
- `src/i18n.js` — textos en catalán y castellano para la pantalla grande y los móviles
- `src/gh.js` — guardado en GitHub (rama `datos` de este mismo repositorio)
- `src/editor.js` — preparar cuestionarios
- `src/live.js` — pantalla del staff durante la partida
- `src/player.js` — móvil del jugador
- `src/main.js` — arranque

Para volver a generarla: `npm install` y `python3 build.py`, y copiar `dist/quiz.html` a `../index.html`.
