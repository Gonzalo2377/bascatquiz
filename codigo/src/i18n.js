/* BascatQuiz · textos que ven los jugadores (pantalla grande y móvil), en catalán o castellano según el cuestionario */
(function () {
  'use strict';
  const S = {
    ca: {
      join: 'Entra a la partida', code: 'Codi', name: 'El teu nom', namePh: 'Nom o malnom', enter: 'Entrar',
      in: 'Ja ets dins!', look: 'Mira la pantalla gran', soon: 'La partida comença aviat',
      qn: 'Pregunta {i} de {n}', watch: 'Mira el clip', sent: 'Resposta enviada', waitRest: 'Esperant la resta…',
      timeUp: 'Temps!', correct: 'Correcte!', wrong: 'Incorrecte', noAns: 'No has respost', was: 'Era', pts: 'punts',
      streak: 'Ratxa de {n}', youAre: 'Vas {r} de {n}', behind: 'a {d} punts del {r}', leader: 'Vas primer!',
      final: 'Has quedat {r} de {n}', board: 'Classificació', podium: 'Podi', answers: 'respostes', players: 'jugadors', player1: 'jugador',
      joinAt: 'Entra a', withCode: 'amb el codi', waiting: 'Esperant jugadors…', removed: 'T’han tret de la partida',
      notFound: 'No trobo la partida {c}. Revisa el codi o espera que el staff l’obri.', connecting: 'Connectant…', connErr: 'Sense connexió, tornant a provar…',
      double: 'Punts dobles', noPts: 'Sense punts', over: 'Fi de la partida', thanks: 'Gràcies per jugar!', total: 'Total',
      nameTaken: 'Escriu el teu nom', otherName: 'Canviar de nom', yourAns: 'La teva resposta', ofN: 'de {n}', gotIt: '{a} de {n} han respost',
      outcome: 'Mireu com acaba', ready: 'Preparats?', fast: 'Ràpid!',
    },
    es: {
      join: 'Entra en la partida', code: 'Código', name: 'Tu nombre', namePh: 'Nombre o apodo', enter: 'Entrar',
      in: '¡Ya estás dentro!', look: 'Mira la pantalla grande', soon: 'La partida empieza enseguida',
      qn: 'Pregunta {i} de {n}', watch: 'Mira el clip', sent: 'Respuesta enviada', waitRest: 'Esperando al resto…',
      timeUp: '¡Tiempo!', correct: '¡Correcto!', wrong: 'Incorrecto', noAns: 'No has respondido', was: 'Era', pts: 'puntos',
      streak: 'Racha de {n}', youAre: 'Vas {r} de {n}', behind: 'a {d} puntos del {r}', leader: '¡Vas primero!',
      final: 'Has quedado {r} de {n}', board: 'Clasificación', podium: 'Podio', answers: 'respuestas', players: 'jugadores', player1: 'jugador',
      joinAt: 'Entra en', withCode: 'con el código', waiting: 'Esperando jugadores…', removed: 'Te han sacado de la partida',
      notFound: 'No encuentro la partida {c}. Revisa el código o espera a que el staff la abra.', connecting: 'Conectando…', connErr: 'Sin conexión, reintentando…',
      double: 'Puntos dobles', noPts: 'Sin puntos', over: 'Fin de la partida', thanks: '¡Gracias por jugar!', total: 'Total',
      nameTaken: 'Escribe tu nombre', otherName: 'Cambiar de nombre', yourAns: 'Tu respuesta', ofN: 'de {n}', gotIt: '{a} de {n} han respondido',
      outcome: 'Mirad cómo acaba', ready: '¿Preparados?', fast: '¡Rápido!',
    },
  };
  const BQ = window.BQ;
  BQ.t = (lang, k, vars) => { let s = (S[lang] || S.ca)[k]; if (s == null) s = S.ca[k] || k; if (vars) s = s.replace(/\{(\w+)\}/g, (_, v) => vars[v] != null ? vars[v] : ''); return s; };
  BQ.ord = (lang, r) => lang === 'es' ? r + 'º' : (r === 1 ? '1r' : r === 2 ? '2n' : r === 3 ? '3r' : r === 4 ? '4t' : r + 'è');
})();
