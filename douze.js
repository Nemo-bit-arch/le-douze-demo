/* =====================================================================
   Le Douze · la logique de la page.
   Geste signature : la page dure un tour d'horloge. L'heure du récit (12 h 30 en haut, minuit en
   bas) règle la couleur de toute la page et l'aiguille de la montre ; dans « Votre table »,
   l'aiguille passe dans les mains du visiteur et règle à la fois l'heure réservée et la lumière.
   Le moteur scroll-craft pilote le défilement ; ce fichier ne le touche pas.
   ===================================================================== */
(function () {
  'use strict';

  // À RENSEIGNER par l'établissement : numéro WhatsApp des réservations, format international sans « + »
  // (exemple : 241XXXXXXXX). Vide : WhatsApp s'ouvre et laisse choisir le destinataire.
  var WHATSAPP = '';
  var ZONE = 'Africa/Libreville';
  var reduit = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var borne = function (v, a, b) { return Math.min(b, Math.max(a, v)); };

  /* ------------------------------------------------------------------
     Les heures en toutes lettres : 20.5 → « 20 h 30 », 24 → « minuit »
     ------------------------------------------------------------------ */
  function texteHeure(h, pas) {
    var mn = Math.round(h * 60 / pas) * pas;
    var hh = Math.floor(mn / 60) % 24, m = mn % 60;
    if (hh === 0 && m === 0) return 'minuit';
    if (hh === 12 && m === 0) return 'midi';
    return hh + ' h' + (m ? ' ' + String(m).padStart(2, '0') : '');
  }

  /* ------------------------------------------------------------------
     La lumière de chaque heure : fond, surface, encre, encre douce, accent, encre sur accent.
     Le passage du clair au sombre (17 h 55 → 18 h 30) tombe pendant le film du coucher,
     qui couvre tout l'écran : aucun texte n'est jamais posé sur un fond de transition.
     ------------------------------------------------------------------ */
  var LUMIERES = [
    [12.0, '#f3eee4', '#e8dfcf', '#1d1b17', '#57514a', '#9b4422', '#fbf7f0'],
    [16.5, '#f1e5cf', '#e6d5b8', '#231b12', '#5b4d3c', '#94421c', '#fbf7f0'],
    [17.9, '#ecd9b8', '#dfc8a2', '#22190f', '#584834', '#8d3f19', '#fbf7f0'],
    [18.5, '#1b2233', '#243047', '#f2e9da', '#bdb4a5', '#e2a556', '#141824'],
    [21.0, '#11161f', '#1a212e', '#f1e8d8', '#b3aa9b', '#dca559', '#11161f'],
    [24.0, '#0a0b0f', '#14161c', '#efe6d6', '#aca394', '#d6a65c', '#0a0b0f']
  ];
  var ROLES = ['--sc-canvas', '--sc-surface', '--sc-ink', '--sc-ink-soft', '--sc-accent', '--sc-accent-ink'];
  var rgb = function (hex) { var n = parseInt(hex.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
  var LUM = LUMIERES.map(function (l) { return [l[0]].concat(l.slice(1).map(rgb)); });
  var racine = document.documentElement, meta = $('meta[name="theme-color"]'), derniereTeinte = '';

  function eclairer(h) {
    var i = 0;
    while (i < LUM.length - 2 && h > LUM[i + 1][0]) i++;
    var a = LUM[i], b = LUM[i + 1], t = borne((h - a[0]) / (b[0] - a[0]), 0, 1);
    var cle = '';
    for (var r = 0; r < ROLES.length; r++) {
      var c = [0, 1, 2].map(function (k) { return Math.round(a[r + 1][k] + (b[r + 1][k] - a[r + 1][k]) * t); });
      var val = 'rgb(' + c.join(' ') + ')';
      cle += val;
      racine.style.setProperty(ROLES[r], val);
      if (r === 0 && meta) meta.setAttribute('content', val);
    }
    if (cle !== derniereTeinte) { derniereTeinte = cle; racine.classList.toggle('nuit', h >= 18.2); }
  }

  /* ------------------------------------------------------------------
     L'heure du récit : chaque section porte son heure (data-heure) ; entre deux sections,
     l'heure avance en proportion du défilement. Le bas de la page vaut minuit.
     ------------------------------------------------------------------ */
  var sections = $$('[data-heure]');
  function heureDuRecit() {
    var y = window.scrollY, ancres = sections.map(function (s) {
      return [s.getBoundingClientRect().top + y, parseFloat(s.getAttribute('data-heure'))];
    });
    ancres.push([Math.max(1, document.documentElement.scrollHeight - innerHeight), 24]);
    if (y <= ancres[0][0]) return ancres[0][1];
    for (var i = 0; i < ancres.length - 1; i++) {
      var a = ancres[i], b = ancres[i + 1];
      if (y < b[0]) return a[1] + (b[1] - a[1]) * (y - a[0]) / Math.max(1, b[0] - a[0]);
    }
    return 24;
  }

  /* La montre (navigation) et les grands chiffres du déjeuner */
  var aiguilleMontre = $('[data-aiguille]'), lueMontre = $('[data-heure-lue]');
  var geanteH = $('[data-geante-h]'), geanteM = $('[data-geante-m]');
  var liensMontre = $$('.montre__heures a');
  function afficherRecit(h) {
    if (aiguilleMontre) aiguilleMontre.style.rotate = ((h - 12) * 30) + 'deg';
    if (lueMontre) lueMontre.textContent = texteHeure(h, 5);
    if (geanteH) {
      var mn = Math.round(Math.min(h, 17.75) * 12) * 5;   // par pas de cinq minutes, arrêt à 17 h 45
      geanteH.textContent = Math.floor(mn / 60);
      geanteM.textContent = String(mn % 60).padStart(2, '0');
    }
    var actuel = null;
    liensMontre.forEach(function (a) { if (h >= parseFloat(a.getAttribute('data-vers')) - 0.01) actuel = a; });
    liensMontre.forEach(function (a) { if (a === actuel) a.setAttribute('aria-current', 'location'); else a.removeAttribute('aria-current'); });
  }

  /* ------------------------------------------------------------------
     La montre : touchée, elle déplie les heures de la journée.
     ------------------------------------------------------------------ */
  var boitier = $('.montre__boitier'), heures = $('#montre-heures');
  function plier(ouvrir) {
    heures.hidden = !ouvrir;
    boitier.setAttribute('aria-expanded', ouvrir ? 'true' : 'false');
  }
  boitier.addEventListener('click', function () { plier(heures.hidden); });
  liensMontre.forEach(function (a) { a.addEventListener('click', function () { plier(false); }); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !heures.hidden) { plier(false); boitier.focus(); } });
  document.addEventListener('click', function (e) { if (!heures.hidden && !e.target.closest('.montre')) plier(false); });

  /* ------------------------------------------------------------------
     Les sous-verres : retournés, ils montrent la recette.
     ------------------------------------------------------------------ */
  $$('.sous-verre').forEach(function (b) {
    b.addEventListener('click', function () { b.setAttribute('aria-pressed', b.getAttribute('aria-pressed') === 'true' ? 'false' : 'true'); });
  });

  /* ------------------------------------------------------------------
     Votre table : l'horloge que l'on tourne (geste signature)
     ------------------------------------------------------------------ */
  var horloge = $('[data-horloge]'), grande = $('[data-grande-aiguille]'), lueChoix = $('[data-heure-choisie]');
  var fondMidi = $('[data-fond="midi"]'), fondNuit = $('[data-fond="nuit"]');
  var MIN = 12, MAX = 23, PAS = 0.5;
  var heureChoisie = 20.5, choixActif = false, reserver = $('#reserver');

  // Les soixante traits des minutes, tracés une fois.
  (function () {
    var g = $('[data-minutes]'), ns = 'http://www.w3.org/2000/svg';
    for (var i = 0; i < 60; i++) {
      if (i % 15 === 0) continue;   // la place des chiffres romains
      var a = i * 6 * Math.PI / 180, forte = i % 5 === 0, r1 = forte ? 74 : 78, r2 = 82;
      var l = document.createElementNS(ns, 'line');
      l.setAttribute('x1', 100 + r1 * Math.sin(a)); l.setAttribute('y1', 100 - r1 * Math.cos(a));
      l.setAttribute('x2', 100 + r2 * Math.sin(a)); l.setAttribute('y2', 100 - r2 * Math.cos(a));
      if (forte) l.setAttribute('class', 'forte');
      g.appendChild(l);
    }
  })();

  function regler(h) {
    heureChoisie = borne(Math.round(h / PAS) * PAS, MIN, MAX);
    grande.style.rotate = ((heureChoisie - 12) * 30) + 'deg';
    var txt = texteHeure(heureChoisie, 30);
    lueChoix.textContent = txt;
    horloge.setAttribute('aria-valuenow', String(heureChoisie));
    horloge.setAttribute('aria-valuetext', txt);
    // La terrasse à l'heure choisie : le midi jusqu'à 16 h, l'heure dorée, puis la nuit dès 19 h.
    fondMidi.style.opacity = borne((16.5 - heureChoisie) / 1, 0, 1);
    fondNuit.style.opacity = borne((heureChoisie - 18.25) / 0.75, 0, 1);
    if (choixActif) eclairer(heureChoisie);
  }

  function angleVersHeure(e) {
    var r = horloge.getBoundingClientRect();
    var dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
    var deg = (Math.atan2(dx, -dy) * 180 / Math.PI + 360) % 360;   // 0° à midi, sens des aiguilles
    var h = 12 + deg / 30;
    // Au-delà de 23 h 30, l'aiguille revient vers midi : on garde la borne la plus proche.
    if (h > MAX + 0.25) h = h > 23.75 ? MIN : MAX;
    return h;
  }
  var saisie = false;
  horloge.addEventListener('pointerdown', function (e) {
    saisie = true; horloge.classList.add('saisie');
    horloge.setPointerCapture(e.pointerId);
    regler(angleVersHeure(e));
  });
  horloge.addEventListener('pointermove', function (e) { if (saisie) regler(angleVersHeure(e)); });
  var lacher = function () { saisie = false; horloge.classList.remove('saisie'); };
  horloge.addEventListener('pointerup', lacher);
  horloge.addEventListener('pointercancel', lacher);
  horloge.addEventListener('keydown', function (e) {
    var d = { ArrowRight: PAS, ArrowUp: PAS, ArrowLeft: -PAS, ArrowDown: -PAS, PageUp: 2, PageDown: -2 }[e.key];
    if (e.key === 'Home') d = MIN - heureChoisie;
    if (e.key === 'End') d = MAX - heureChoisie;
    if (d === undefined) return;
    e.preventDefault(); regler(heureChoisie + d);
  });

  /* L'éphéméride : sept jours à partir d'aujourd'hui, à l'heure de Libreville. */
  var NOMS = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];
  var NOMS_LONGS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
  var MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
  var MOIS_LONGS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  function aujourdhui() {
    var p = new Intl.DateTimeFormat('en-CA', { timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()).split('-');
    return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2], 12));
  }
  var jours = [], zoneJours = $('[data-jours]');
  (function () {
    var base = aujourdhui();
    for (var i = 0; i < 7; i++) {
      var d = new Date(base.getTime() + i * 864e5), j = d.getUTCDay();
      var titre = i === 0 ? 'Aujourd’hui' : i === 1 ? 'Demain' : NOMS[j];
      var label = document.createElement('label');
      label.className = 'feuillet';
      label.innerHTML = '<input type="radio" name="jour" value="' + i + '"' + (i === 0 ? ' checked' : '') + '>' +
        '<span class="feuillet__papier"><span class="feuillet__jour"></span><span class="feuillet__n"></span><span class="feuillet__mois"></span></span>' +
        (j === 5 ? '<span class="feuillet__note">karaoké</span>' : '');
      $('.feuillet__jour', label).textContent = titre;
      $('.feuillet__n', label).textContent = d.getUTCDate();
      $('.feuillet__mois', label).textContent = MOIS[d.getUTCMonth()];
      zoneJours.appendChild(label);
      jours.push({ date: d, vendredi: j === 5, texte: (i === 0 ? 'ce ' : 'le ') + NOMS_LONGS[j] + ' ' + d.getUTCDate() + ' ' + MOIS_LONGS[d.getUTCMonth()] });
    }
  })();

  /* Les coupes : de un à huit convives. */
  var zoneCoupes = $('[data-coupes]'), lusConvives = $('[data-convives-lus]'), convives = 2;
  var COUPE = '<svg viewBox="0 0 30 44" aria-hidden="true"><path class="coupe__vin" d="M5 9 Q15 11 25 9 Q24 17 15 19 Q6 17 5 9z"/><path class="coupe__verre" d="M3 5 Q15 8 27 5 Q26 19 15 21 Q4 19 3 5z M15 21 V38 M8 40 Q15 37 22 40"/></svg>';
  for (var n = 1; n <= 8; n++) {
    var c = document.createElement('label');
    c.className = 'coupe';
    c.innerHTML = '<input type="radio" name="convives" value="' + n + '"' + (n === 2 ? ' checked' : '') + ' aria-label="' + n + (n > 1 ? ' convives' : ' convive') + '">' + COUPE;
    zoneCoupes.appendChild(c);
  }
  function remplirCoupes() {
    $$('.coupe', zoneCoupes).forEach(function (c, i) { c.classList.toggle('pleine', i < convives); });
    lusConvives.textContent = convives + (convives > 1 ? ' convives' : ' convive');
  }
  zoneCoupes.addEventListener('change', function (e) { convives = +e.target.value; remplirCoupes(); });

  /* La fiche du vendredi : choisit le prochain vendredi dans l'éphéméride. */
  $$('[data-vendredi]').forEach(function (a) {
    a.addEventListener('click', function () {
      var i = jours.findIndex(function (j) { return j.vendredi; });
      var radio = i >= 0 && $('input[name="jour"][value="' + i + '"]');
      if (radio) radio.checked = true;
      if (heureChoisie < 21) regler(22);
    });
  });

  /* L'envoi : l'allumette se craque, la demande s'ouvre dans WhatsApp. */
  var carton = $('[data-carton]'), note = $('[data-note]'), nom = $('[data-nom]'), allumette = $('.allumette');
  carton.addEventListener('submit', function (e) {
    e.preventDefault();
    var qui = nom.value.trim();
    if (!qui) { note.textContent = 'Indiquez le nom de la réservation.'; nom.focus(); return; }
    var jour = jours[+(($('input[name="jour"]:checked') || {}).value || 0)];
    var zone = ($('input[name="zone"]:checked') || {}).value || 'sur le toit-terrasse';
    var texte = 'Bonjour, je souhaiterais réserver une table au Douze pour ' + convives + (convives > 1 ? ' personnes' : ' personne') +
      ', ' + jour.texte + ' à ' + texteHeure(heureChoisie, 30) + ', ' + zone + '. Au nom de ' + qui + '.' +
      '\nPourriez-vous me confirmer la disponibilité ? Merci.';
    allumette.classList.add('craquee');
    note.textContent = 'L’allumette est craquée : votre demande vous attend dans WhatsApp.';
    window.open('https://wa.me/' + WHATSAPP + '?text=' + encodeURIComponent(texte), '_blank', 'noopener');
  });

  /* ------------------------------------------------------------------
     Le défilement : l'heure du récit, puis l'heure choisie une fois arrivé à « Votre table ».
     ------------------------------------------------------------------ */
  function suivre() {
    var h = heureDuRecit();
    var r = reserver.getBoundingClientRect();
    choixActif = r.top < innerHeight * 0.45;
    document.body.classList.toggle('reserver-visible', r.top < innerHeight * 0.6);
    afficherRecit(h);
    eclairer(choixActif ? heureChoisie : h);
  }
  var attente = false;
  addEventListener('scroll', function () {
    if (attente) return;
    attente = true;
    requestAnimationFrame(function () { attente = false; suivre(); });
  }, { passive: true });
  addEventListener('resize', suivre);
  addEventListener('load', suivre);

  regler(heureChoisie);
  remplirCoupes();
  suivre();
  if (reduit) racine.classList.add('reduit');
})();
