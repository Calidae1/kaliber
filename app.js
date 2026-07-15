/* app.js — KALIBER Munitions-Kompendium */
(function () {
  'use strict';

  const view = document.getElementById('view');
  const searchEl = document.getElementById('search');
  const backEl = document.getElementById('back');
  const stampEl = document.getElementById('dbstamp');
  const refreshEl = document.getElementById('refresh');

  let INDEX = null;
  let PREISE = null;
  let GLOSSAR = null;
  const CACHE = new Map();      // id -> Kaliberdatensatz
  let filterGruppe = null;

  /* ---------- Hilfsfunktionen ---------- */

  const $ = (sel, root) => (root || document).querySelector(sel);
  const esc = s => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  const nf = (n, d) => {
    if (n == null || !isFinite(n)) return '–';
    return n.toLocaleString('de-DE', { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 });
  };
  const eur = n => n == null ? '–' : n.toLocaleString('de-DE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2 });
  const range = (a, unit, d) => !a ? '–' : `${nf(a[0], d)}–${nf(a[1], d)}${unit ? ' ' + unit : ''}`;

  async function getJSON(url, bust) {
    const u = bust ? url + '?v=' + Date.now() : url;
    const r = await fetch(u, { cache: bust ? 'reload' : 'default' });
    if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
    return r.json();
  }

  /* ---------- Glossar ---------- */

  // Macht aus einem Kürzel eine antippbare Erklärung. Unbekannte Schlüssel
  // fallen still auf reinen Text zurück, damit ein Tippfehler im Datensatz
  // nie die Seite zerlegt.
  function gl(key, label) {
    const t = GLOSSAR && GLOSSAR.begriffe[key];
    return t ? `<button type="button" class="gl" data-gl="${key}">${esc(label)}</button>` : esc(label);
  }

  function zeigeBegriff(key) {
    const t = GLOSSAR && GLOSSAR.begriffe[key];
    if (!t) return;
    const d = document.getElementById('gldlg');
    $('#gl-t', d).textContent = t.titel;
    $('#gl-x', d).textContent = t.text;
    const f = $('#gl-f', d);
    if (t.faustregel) { f.textContent = t.faustregel; f.hidden = false; } else { f.hidden = true; }
    if (!d.open) d.showModal();
  }

  document.addEventListener('click', e => {
    const b = e.target.closest('[data-gl]');
    if (b) { e.preventDefault(); zeigeBegriff(b.dataset.gl); }
  });

  // Kein <form method="dialog">, damit die Content-Security-Policy form-action
  // sperren kann, ohne dass der Dialog davon betroffen wäre.
  document.getElementById('gl-close').addEventListener('click', () => {
    document.getElementById('gldlg').close();
  });

  /* ---------- Suche ---------- */

  // Zwei Normalisierungen: einmal alles außer Buchstaben/Ziffern weg, einmal
  // zusätzlich ohne "mm". Sonst findet "5,56mm" die Alias "5,56x45" nicht,
  // weil daraus "55645" wird und die Einheit dazwischenfunkt.
  const normA = s => String(s).toLowerCase()
    .replace(/ß/g, 'ss').replace(/ä/g, 'a').replace(/ö/g, 'o').replace(/ü/g, 'u')
    .replace(/[^a-z0-9]/g, '');
  const normB = s => normA(s).replace(/mm/g, '');

  function levenshtein(a, b) {
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;
    let vor = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 0; i < a.length; i++) {
      const akt = [i + 1];
      for (let j = 0; j < b.length; j++) {
        akt[j + 1] = Math.min(
          vor[j + 1] + 1,
          akt[j] + 1,
          vor[j] + (a[i] === b[j] ? 0 : 1)
        );
      }
      vor = akt;
    }
    return vor[b.length];
  }

  const maxAbstand = len => (len <= 4 ? 1 : len <= 7 ? 2 : 3);

  /** Bewertet, wie gut ein Kaliber zur Eingabe passt. 0 = kein Bezug. */
  function bewerte(k, q) {
    const qa = normA(q);
    if (!qa) return 0;
    // Die "mm"-lose Variante nur nutzen, wenn davon noch etwas Aussagekräftiges
    // übrig bleibt: aus "9mm" würde sonst eine blanke "9", und die steckt in
    // fast jeder Kaliberbezeichnung — das flutet die Trefferliste.
    const qbRoh = normB(q);
    const qb = (qbRoh !== qa && qbRoh.length >= 3) ? qbRoh : null;

    let best = 0;
    const kandidaten = [k.name, ...(k.aliase || []), ...(k.suchbegriffe || [])];

    const paare = [[qa, null], [qa, 'b']];
    if (qb) paare.push([qb, null], [qb, 'b']);

    for (const kand of kandidaten) {
      const ka = normA(kand), kb = normB(kand);
      for (const [q_, welche] of paare) {
        const k_ = welche === 'b' ? kb : ka;
        if (!q_ || !k_) continue;
        if (q_ === k_) { best = Math.max(best, 100); continue; }
        // Kurze Eingaben nur streng matchen — bei zwei Zeichen ist jede
        // Teilstring- oder Tippfehlersuche reines Rauschen.
        if (q_.length >= 2 && k_.startsWith(q_)) { best = Math.max(best, 85); continue; }
        if (q_.length < 3) continue;
        if (k_.includes(q_)) { best = Math.max(best, 70); continue; }
        if (k_.length >= 3 && q_.includes(k_)) { best = Math.max(best, 60); continue; }
        // Tippfehler: erst gegen den ganzen Kandidaten, dann gegen dessen Anfang
        const d = levenshtein(q_, k_);
        if (d <= maxAbstand(q_.length)) { best = Math.max(best, 50 - d * 5); continue; }
        if (k_.length > q_.length) {
          const d2 = levenshtein(q_, k_.slice(0, q_.length));
          if (d2 <= maxAbstand(q_.length)) best = Math.max(best, 45 - d2 * 5);
        }
      }
      // Wortweise, damit "blakout" noch ".300 AAC Blackout" findet
      if (qa.length >= 3) {
        for (const tok of String(kand).toLowerCase().split(/[^a-z0-9äöüß]+/i)) {
          const t = normA(tok);
          if (t.length < 3) continue;
          if (t === qa) { best = Math.max(best, 92); continue; }
          if (t.startsWith(qa)) { best = Math.max(best, 78); continue; }
          const d = levenshtein(qa, t);
          if (d <= maxAbstand(qa.length)) best = Math.max(best, 52 - d * 5);
        }
      }
    }
    return best;
  }

  // 75 liegt bewusst über der Teilstring-Bewertung (70): Eine Bezeichnung wie
  // "9x29mmR" enthält die Zeichenfolge "9mm" rein zufällig über die
  // Zifferngrenze hinweg. Solche Funde sind einen Vorschlag wert, aber kein
  // Treffer — echte Treffer kommen über Wortanfang (78/85) oder Volltreffer.
  const TREFFER_AB = 75;
  const VORSCHLAG_AB = 35; // darunter bis hier: "Meintest du …?"

  function suche(q) {
    const bewertet = INDEX.kaliber
      .map(k => ({ k, s: bewerte(k, q) }))
      .filter(x => x.s >= VORSCHLAG_AB)
      .sort((a, b) => b.s - a.s || a.k.name.localeCompare(b.k.name, 'de'));
    return {
      treffer: bewertet.filter(x => x.s >= TREFFER_AB).map(x => x.k),
      vorschlaege: bewertet.filter(x => x.s < TREFFER_AB).map(x => x.k)
    };
  }

  /* ---------- Patronen-Zeichnung (parametrisch aus den Maßen) ---------- */

  function zeichnePatrone(m) {
    if (!m || !m.col_mm || !m.huelsenlaenge_mm) return '';

    const COL = m.col_mm, CL = m.huelsenlaenge_mm;
    const dBoden = m.boden_mm || m.rand_mm || 9.5;
    const dRand = m.rand_mm || dBoden;
    const dHals = m.hals_mm || m.geschoss_mm + 0.6;
    const dGesch = m.geschoss_mm;
    const dSchulter = m.schulter_mm || null;

    // Zeichenfläche in mm, dann per viewBox skaliert
    const padX = 6, padY = 5;
    const maxD = Math.max(dRand, dBoden, dSchulter || 0);
    const W = COL + padX * 2;
    const H = maxD + padY * 2 + 12;      // + Platz für Maßlinie
    const cy = padY + maxD / 2;
    const x0 = padX;

    const y = d => cy - d / 2;            // Oberkante bei Durchmesser d
    const P = [];                         // Oberkante von hinten nach vorn

    // Boden + Auszieherrille
    P.push([x0, y(dRand)]);
    P.push([x0 + 1.2, y(dRand)]);
    P.push([x0 + 1.6, y(dRand - 1.3)]);
    P.push([x0 + 3.0, y(dRand - 1.3)]);
    P.push([x0 + 3.6, y(dBoden)]);

    let mundD;
    if (dSchulter) {
      // Flaschenhals: Körper (leichte Konizität) -> Schulter -> Hals
      const halsL = m.hals_laenge_mm || Math.max(4, dGesch * 0.7);
      const schulterL = m.schulter_laenge_mm || 3.0;
      const koerperEnde = CL - halsL - schulterL;
      P.push([x0 + koerperEnde, y(dSchulter)]);
      P.push([x0 + koerperEnde + schulterL, y(dHals)]);
      P.push([x0 + CL, y(dHals)]);
      mundD = dHals;
    } else {
      // Zylinder-/Konushülse: gleichmäßige Verjüngung bis zur Mündung
      P.push([x0 + CL, y(dHals)]);
      mundD = dHals;
    }

    // Geschoss: Führungsteil + Ogive bis zur Spitze
    const sichtbar = COL - CL;
    const fuehrung = Math.min(sichtbar * 0.3, dGesch * 0.5);
    const ogive = sichtbar - fuehrung;
    const yG = y(dGesch);
    const spitzeR = Math.max(0.35, dGesch * 0.06);

    let d = 'M ' + P.map(p => `${p[0].toFixed(2)} ${p[1].toFixed(2)}`).join(' L ');
    // Übergang Hülsenmund -> Geschoss
    d += ` L ${(x0 + CL).toFixed(2)} ${yG.toFixed(2)}`;
    d += ` L ${(x0 + CL + fuehrung).toFixed(2)} ${yG.toFixed(2)}`;
    // Tangentiale Ogive als quadratische Kurve
    d += ` Q ${(x0 + CL + fuehrung + ogive * 0.62).toFixed(2)} ${yG.toFixed(2)}` +
         ` ${(x0 + COL).toFixed(2)} ${(cy - spitzeR).toFixed(2)}`;
    // Spitze
    d += ` L ${(x0 + COL).toFixed(2)} ${(cy + spitzeR).toFixed(2)}`;
    // Spiegeln (Unterkante rückwärts)
    d += ` Q ${(x0 + CL + fuehrung + ogive * 0.62).toFixed(2)} ${(cy + dGesch / 2).toFixed(2)}` +
         ` ${(x0 + CL + fuehrung).toFixed(2)} ${(cy + dGesch / 2).toFixed(2)}`;
    d += ` L ${(x0 + CL).toFixed(2)} ${(cy + dGesch / 2).toFixed(2)}`;
    const mirror = P.slice().reverse().map(p => [p[0], cy + (cy - p[1])]);
    d += ' L ' + mirror.map(p => `${p[0].toFixed(2)} ${p[1].toFixed(2)}`).join(' L ');
    d += ' Z';

    // Trennlinie Hülsenmund
    const halsY1 = y(mundD), halsY2 = cy + mundD / 2;
    const yMass = cy + maxD / 2 + 7;

    return `
    <svg viewBox="0 0 ${W.toFixed(1)} ${H.toFixed(1)}" role="img"
         aria-label="Maßstäbliche Seitenansicht der Patrone ${esc(m._name || '')}">
      <defs>
        <linearGradient id="msg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stop-color="#e8c078"/>
          <stop offset="42%"  stop-color="#c9963f"/>
          <stop offset="68%"  stop-color="#8f6a2b"/>
          <stop offset="100%" stop-color="#5c441b"/>
        </linearGradient>
        <linearGradient id="blg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stop-color="#c08a5e"/>
          <stop offset="45%"  stop-color="#9c6740"/>
          <stop offset="100%" stop-color="#5f3d26"/>
        </linearGradient>
        <clipPath id="clipGesch">
          <rect x="${(x0 + CL).toFixed(2)}" y="0" width="${(sichtbar + 1).toFixed(2)}" height="${H}"/>
        </clipPath>
      </defs>
      <path d="${d}" fill="url(#msg)" stroke="#2a1f0d" stroke-width="0.22"/>
      <path d="${d}" fill="url(#blg)" stroke="none" clip-path="url(#clipGesch)" opacity="0.95"/>
      <path d="${d}" fill="none" stroke="#2a1f0d" stroke-width="0.22"/>
      <line x1="${(x0 + CL).toFixed(2)}" y1="${halsY1.toFixed(2)}"
            x2="${(x0 + CL).toFixed(2)}" y2="${halsY2.toFixed(2)}"
            stroke="#2a1f0d" stroke-width="0.25" opacity=".7"/>
      <g stroke="#5d6979" stroke-width="0.18" fill="none">
        <line x1="${x0.toFixed(2)}" y1="${(yMass - 2.5).toFixed(2)}" x2="${x0.toFixed(2)}" y2="${(yMass + 1.5).toFixed(2)}"/>
        <line x1="${(x0 + CL).toFixed(2)}" y1="${(yMass - 2.5).toFixed(2)}" x2="${(x0 + CL).toFixed(2)}" y2="${(yMass + 1.5).toFixed(2)}"/>
        <line x1="${(x0 + COL).toFixed(2)}" y1="${(yMass - 2.5).toFixed(2)}" x2="${(x0 + COL).toFixed(2)}" y2="${(yMass + 1.5).toFixed(2)}"/>
        <line x1="${x0.toFixed(2)}" y1="${yMass.toFixed(2)}" x2="${(x0 + CL).toFixed(2)}" y2="${yMass.toFixed(2)}"/>
        <line x1="${(x0 + CL).toFixed(2)}" y1="${(yMass + 3.6).toFixed(2)}" x2="${(x0 + COL).toFixed(2)}" y2="${(yMass + 3.6).toFixed(2)}"/>
        <line x1="${x0.toFixed(2)}" y1="${(yMass + 2.6).toFixed(2)}" x2="${x0.toFixed(2)}" y2="${(yMass + 4.6).toFixed(2)}"/>
        <line x1="${(x0 + COL).toFixed(2)}" y1="${(yMass + 2.6).toFixed(2)}" x2="${(x0 + COL).toFixed(2)}" y2="${(yMass + 4.6).toFixed(2)}"/>
      </g>
      <text x="${(x0 + CL / 2).toFixed(2)}" y="${(yMass - 0.9).toFixed(2)}" fill="#8b97a8"
            font-size="2.4" text-anchor="middle" font-family="ui-monospace, monospace">${nf(CL, 2)} mm Hülse</text>
      <text x="${(x0 + COL / 2).toFixed(2)}" y="${(yMass + 2.9).toFixed(2)}" fill="#8b97a8"
            font-size="2.4" text-anchor="middle" font-family="ui-monospace, monospace">${nf(COL, 2)} mm gesamt</text>
    </svg>`;
  }

  /* ---------- Diagramme ---------- */

  function linienChart(opts) {
    const { serien, xLabel, yLabel, yEinheit, marken, xMarken } = opts;
    // Die viewBox ist bewusst schmal gehalten: Auf einem 375-px-Handy bleibt der
    // Skalierungsfaktor damit nahe 1, sodass die Beschriftung lesbar groß bleibt.
    // Eine breite viewBox (etwa 700) schrumpft die Schrift auf dem Handy auf
    // unter 5 px zusammen. Nach oben begrenzt .chart per CSS die Breite.
    const W = 340, H = 214, ml = 48, mr = 10, mt = 14, mb = 32;
    const alle = serien.flatMap(s => s.punkte);
    if (!alle.length) return '';
    const xs = alle.map(p => p.x), ys = alle.map(p => p.y);
    let yMin = Math.min(0, ...ys), yMax = Math.max(...ys, ...(marken || []).map(m => m.y));
    const xMin = 0, xMax = Math.max(...xs);
    if (yMax === yMin) yMax = yMin + 1;
    const pad = (yMax - yMin) * 0.08;
    yMax += pad; yMin -= pad;

    const px = x => ml + (x - xMin) / (xMax - xMin) * (W - ml - mr);
    const py = y => mt + (yMax - y) / (yMax - yMin) * (H - mt - mb);

    const gridY = [];
    const stepsY = 4;
    for (let i = 0; i <= stepsY; i++) {
      const v = yMin + (yMax - yMin) * i / stepsY;
      gridY.push(`<line x1="${ml}" y1="${py(v).toFixed(1)}" x2="${W - mr}" y2="${py(v).toFixed(1)}" stroke="#1c2431" stroke-width="0.7"/>
      <text x="${ml - 5}" y="${(py(v) + 3.2).toFixed(1)}" fill="#5d6979" font-size="9" text-anchor="end" font-family="ui-monospace, monospace">${nf(v, Math.abs(yMax) < 20 ? 1 : 0)}</text>`);
    }
    const gridX = [];
    const stepX = xMax <= 120 ? 25 : (xMax <= 320 ? 50 : 100);
    for (let x = 0; x <= xMax + 0.1; x += stepX) {
      gridX.push(`<line x1="${px(x).toFixed(1)}" y1="${mt}" x2="${px(x).toFixed(1)}" y2="${H - mb}" stroke="#1c2431" stroke-width="0.7"/>
      <text x="${px(x).toFixed(1)}" y="${H - mb + 12}" fill="#5d6979" font-size="9" text-anchor="middle" font-family="ui-monospace, monospace">${x}</text>`);
    }

    const markLines = (marken || []).map(m => `
      <line x1="${ml}" y1="${py(m.y).toFixed(1)}" x2="${W - mr}" y2="${py(m.y).toFixed(1)}"
            stroke="${m.farbe}" stroke-width="0.9" stroke-dasharray="4 3" opacity=".85"/>
      <text x="${W - mr - 3}" y="${(py(m.y) - 3).toFixed(1)}" fill="${m.farbe}" font-size="8.5"
            text-anchor="end" font-family="ui-monospace, monospace">${esc(m.text)}</text>`).join('');

    const paths = serien.map(s => {
      const dd = s.punkte.map((p, i) => `${i ? 'L' : 'M'} ${px(p.x).toFixed(1)} ${py(p.y).toFixed(1)}`).join(' ');
      return `<path d="${dd}" fill="none" stroke="${s.farbe}" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/>`;
    }).join('');

    const zero = (yMin < 0 && yMax > 0)
      ? `<line x1="${ml}" y1="${py(0).toFixed(1)}" x2="${W - mr}" y2="${py(0).toFixed(1)}" stroke="#3a4757" stroke-width="1"/>` : '';

    // Feste Bezugsentfernungen (25 m Kurzwaffe / DSB, 100 m Büchse). Damit lässt
    // sich auf einen Blick ablesen, ob der Haltepunkt auf beiden Distanzen passt.
    const xRef = (xMarken || []).filter(x => x > 0 && x < xMax).map(x => `
      <line x1="${px(x).toFixed(1)}" y1="${mt}" x2="${px(x).toFixed(1)}" y2="${H - mb}"
            stroke="#5aa6c4" stroke-width="0.8" stroke-dasharray="2 3" opacity=".55"/>
      <text x="${(px(x) + 2).toFixed(1)}" y="${mt + 7}" fill="#5aa6c4" font-size="7.5"
            opacity=".9" font-family="ui-monospace, monospace">${x} m</text>`).join('');

    const legende = serien.length > 1 ? serien.map((s, i) =>
      `<g transform="translate(${ml + 4 + i * 92}, ${mt + 10})">
         <rect width="13" height="2.5" y="-2" fill="${s.farbe}" rx="1.2"/>
         <text x="18" y="1.5" fill="#8b97a8" font-size="9" font-family="ui-monospace, monospace">${esc(s.name)}</text>
       </g>`).join('') : '';

    const yMitte = mt + (H - mt - mb) / 2;
    const yTitel = `<text transform="translate(10 ${yMitte.toFixed(1)}) rotate(-90)" x="0" y="0"
      fill="#8b97a8" font-size="8.5" text-anchor="middle" font-family="ui-monospace, monospace"
      >${esc(yLabel)}${yEinheit ? ' (' + esc(yEinheit) + ')' : ''}</text>`;
    const xTitel = `<text x="${(ml + (W - ml - mr) / 2).toFixed(1)}" y="${H - 3}" fill="#8b97a8"
      font-size="8.5" text-anchor="middle" font-family="ui-monospace, monospace">${esc(xLabel)}</text>`;

    return `<div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(yLabel)} über ${esc(xLabel)}">
      ${gridY.join('')}${gridX.join('')}${xRef}${zero}${markLines}${paths}${legende}${yTitel}${xTitel}
    </svg></div>`;
  }

  /* ---------- Startseite ---------- */

  function karte(k) {
    return `
      <a class="card" href="#/k/${k.id}">
        <div class="card-name">${esc(k.name)}</div>
        <div class="card-alias">${esc(k.aliase.slice(0, 4).join(' · '))}</div>
        <div class="card-kurz">${esc(k.kurz)}</div>
      </a>`;
  }

  function renderHome(q) {
    backEl.hidden = true;
    const term = (q || '').trim();

    if (!term) {
      const liste = filterGruppe
        ? INDEX.kaliber.filter(k => k.gruppen.includes(filterGruppe))
        : INDEX.kaliber;
      const chips = Object.entries(INDEX.gruppen).map(([id, label]) =>
        `<button class="chip" data-gruppe="${id}" aria-pressed="${filterGruppe === id}">${esc(label)}</button>`
      ).join('');
      view.innerHTML = `
        <div class="hero-title">${liste.length} Kaliber im Kompendium</div>
        <div class="chips">${chips}</div>
        <div class="cards">${liste.map(karte).join('')}</div>`;
      view.querySelectorAll('.chip').forEach(c => c.addEventListener('click', () => {
        filterGruppe = filterGruppe === c.dataset.gruppe ? null : c.dataset.gruppe;
        renderHome(searchEl.value);
      }));
      return;
    }

    const { treffer, vorschlaege } = suche(term);

    if (!treffer.length && !vorschlaege.length) {
      view.innerHTML = `
        <div class="hero-title">Nichts gefunden für „${esc(term)}“</div>
        <div class="empty">Kein Kaliber passt dazu.<br><br>
          Such nach der gängigen Bezeichnung („.308“, „9mm“, „300 BLK“),
          nach der metrischen Angabe („7,62x51“) oder nach dem Hersteller-Namen.<br>
          Tippfehler verzeiht die Suche.</div>`;
      return;
    }

    // Ohne sicheren Treffer nicht raten, sondern zur Auswahl stellen —
    // bei Kalibern ist eine falsche Annahme teurer als eine Rückfrage.
    if (!treffer.length) {
      view.innerHTML = `
        <div class="hero-title">Meintest du …?</div>
        <div class="note">Für „${esc(term)}“ gibt es keinen eindeutigen Treffer. Das kommt am nächsten:</div>
        <div class="cards">${vorschlaege.slice(0, 6).map(karte).join('')}</div>`;
      return;
    }

    view.innerHTML = `
      <div class="hero-title">${treffer.length} ${treffer.length === 1 ? 'Treffer' : 'Treffer'} für „${esc(term)}“</div>
      <div class="cards">${treffer.map(karte).join('')}</div>
      ${vorschlaege.length ? `
        <div class="hero-title" style="margin-top:26px">Vielleicht auch gemeint</div>
        <div class="cards">${vorschlaege.slice(0, 4).map(karte).join('')}</div>` : ''}`;
  }

  /* ---------- Detailansicht ---------- */

  async function renderDetail(id) {
    backEl.hidden = false;
    view.innerHTML = '<div class="empty">Lade …</div>';

    let k = CACHE.get(id);
    if (!k) {
      try {
        k = await getJSON(`data/kaliber/${id}.json`);
        CACHE.set(id, k);
      } catch (e) {
        view.innerHTML = `<div class="empty">Datensatz „${esc(id)}“ konnte nicht geladen werden.<br><span class="mono">${esc(e.message)}</span></div>`;
        return;
      }
    }

    const s = k.schnell || {};
    const preise = (PREISE && PREISE.kaliber && PREISE.kaliber[id]) || null;
    k.masse._name = k.name;

    const warnungen = (k.warnungen || []).map(w => `
      <div class="warn">
        <div class="warn-icon">⚠</div>
        <div><div class="warn-t">${esc(w.titel)}</div><div class="warn-x">${esc(w.text)}</div></div>
      </div>`).join('');

    const stats = [
      ['Geschoss', range(s.geschoss_gr, '', 0), 'grain'],
      ['v₀', range(s.v0_ms, '', 0), 'm/s'],
      ['E₀', range(s.e0_j, '', 0), 'Joule'],
      ['Preis', preise ? range(preise.range_eur_schuss, '', 2) : '–', '€/Schuss']
    ].map(([kk, vv, uu]) => `
      <div class="stat"><div class="stat-k">${kk}</div><div class="stat-v">${vv}</div><div class="stat-u">${uu}</div></div>`).join('');

    view.innerHTML = `
      <div class="det-head">
        <h1 class="det-name">${esc(k.name)}</h1>
        <div class="det-alias">${esc(k.aliase.join('  ·  '))}</div>
        <div class="det-kurz">${esc(k.kurz)}</div>
      </div>
      ${warnungen}
      <div class="drawing">${zeichnePatrone(k.masse)}<div class="drawing-cap">Maßstäbliche Zeichnung aus den C.I.P.-Maßen — nicht in Originalgröße</div></div>
      <div class="stats">${stats}</div>
      <div class="chapters" id="chapters"></div>`;

    const ch = $('#chapters');
    let n = 0;
    const kapitel = (titel, sub, html, offen) => {
      n++;
      const d = document.createElement('details');
      d.className = 'ch';
      if (offen) d.open = true;
      d.innerHTML = `
        <summary class="ch-h">
          <span class="ch-n mono">${String(n).padStart(2, '0')}</span>
          <span class="ch-t">${esc(titel)}</span>
          ${sub ? `<span class="ch-sub">${esc(sub)}</span>` : ''}
          <span class="ch-arrow"></span>
        </summary>
        <div class="ch-body">${html}</div>`;
      ch.appendChild(d);
      return d;
    };

    /* 01 Basisdaten */
    const b = k.basis;
    kapitel('Basisdaten', `${b.jahr}`, `
      <div class="dl">
        <dt>Entwickler</dt><dd>${esc(b.entwickler)}</dd>
        <dt>Eingeführt</dt><dd>${b.jahr}</dd>
        <dt>Herkunft</dt><dd>${esc(b.herkunft)}</dd>
      </div>
      <h4>Geschichte</h4>
      ${b.geschichte.map(p => `<p>${esc(p)}</p>`).join('')}
      <h4>Einsatzzweck</h4>
      <ul class="pc-list pc-pro">${b.einsatz.map(e => `<li>${esc(e)}</li>`).join('')}</ul>`);

    /* 02 Maße & Normung */
    const m = k.masse;
    kapitel('Maße & Normung', m.norm.split(' /')[0], `
      <div class="dl">
        <dt>${gl('cip', 'Norm')}</dt><dd>${esc(m.norm)}</dd>
        <dt>${gl('randlos', 'Hülsenform')}</dt><dd>${esc(m.huelsenform)}</dd>
        <dt>Geschossdurchmesser</dt><dd>${nf(m.geschoss_mm, 2)} mm</dd>
        <dt>Halsdurchmesser</dt><dd>${nf(m.hals_mm, 2)} mm</dd>
        ${m.schulter_mm ? `<dt>Schulterdurchmesser</dt><dd>${nf(m.schulter_mm, 2)} mm</dd>` : ''}
        <dt>Bodendurchmesser</dt><dd>${nf(m.boden_mm, 2)} mm</dd>
        <dt>${gl('huelsenlaenge', 'Hülsenlänge')}</dt><dd>${nf(m.huelsenlaenge_mm, 2)} mm</dd>
        <dt>${gl('col', 'Patronenlänge (COL)')}</dt><dd>${nf(m.col_mm, 2)} mm</dd>
        <dt>${gl('pmax', 'Gasdruck p_max')}</dt><dd>${nf(m.gasdruck_bar)} bar</dd>
        <dt>${gl('boxer', 'Zündhütchen')}</dt><dd>${esc(m.zuender)}</dd>
        <dt>${gl('drall', 'Drall')}</dt><dd>${esc(m.drall)}</dd>
      </div>
      ${m.gasdruck_hinweis ? `<div class="note">${esc(m.gasdruck_hinweis)}</div>` : ''}
      ${m.drall_hinweis ? `<h4>Zum Drall</h4><p>${esc(m.drall_hinweis)}</p>` : ''}`);

    /* 03 Werte & Laborierungen */
    const labs = k.werte.laborierungen;
    kapitel('Werte & Laborierungen', `${labs.length} Sorten`, `
      <div class="note">${esc(k.werte.hinweis)}</div>
      <div class="tw"><table class="t">
        <thead><tr>
          <th>Hersteller / Typ</th><th>${gl('gr', 'Gewicht')}</th><th>${gl('v0', 'v₀')}</th>
          <th>${gl('e0', 'E₀')}</th><th>${gl('bc', 'BC')}</th><th>Zweck</th>
        </tr></thead>
        <tbody>${labs.map(l => `
          <tr>
            <td class="name">${esc(l.hersteller)}<br><span style="color:var(--muted);font-weight:400">${esc(l.typ)}</span></td>
            <td class="num">${l.gr} gr<br><span style="color:var(--dim)">${nf(l.g, 1)} g</span></td>
            <td class="num">${l.v0} m/s</td>
            <td class="num">${nf(Ballistik.e0(l.gr, l.v0))} J</td>
            <td class="num">${nf(l.bc, 3)}<br><span style="color:var(--dim)">${gl('g1g7', l.bc_modell)}</span></td>
            <td>${esc(l.zweck)}${l.anmerkung ? `<br><span style="color:var(--dim);font-size:12px">${esc(l.anmerkung)}</span>` : ''}</td>
          </tr>`).join('')}</tbody>
      </table></div>`);

    /* 04 Ballistik-Rechner */
    const balDetails = kapitel('Ballistik-Rechner', 'interaktiv', `
      <p>Flugbahn, Energie und Windabdrift, gerechnet aus dem ballistischen Koeffizienten. Wähl eine Laborierung und passe an, was bei dir gilt.</p>
      <div class="calc-row">
        <div class="field"><label for="bl-lab">${gl('laborierung', 'Laborierung')}</label>
          <select id="bl-lab">${labs.map((l, i) => `<option value="${i}">${esc(l.hersteller)} ${l.gr} gr ${esc(l.typ)}</option>`).join('')}</select>
        </div>
        <div class="field"><label for="bl-v0">${gl('v0', 'v₀ (m/s)')}</label><input id="bl-v0" type="number" inputmode="numeric" step="1"></div>
        <div class="field"><label for="bl-zero">${gl('fleck', 'Fleck (m)')}</label><input id="bl-zero" type="number" inputmode="numeric" step="5" value="100"></div>
        <div class="field"><label for="bl-wind">${gl('windabdrift', 'Wind quer (m/s)')}</label><input id="bl-wind" type="number" inputmode="decimal" step="0.5" value="0"></div>
      </div>
      <div id="bl-out"></div>`);

    const labSel = $('#bl-lab', balDetails), v0In = $('#bl-v0', balDetails);
    const zeroIn = $('#bl-zero', balDetails), windIn = $('#bl-wind', balDetails);

    function rechneUndZeichne() {
      const l = labs[+labSel.value];
      const v0 = +v0In.value || l.v0;
      const zero = Math.max(10, +zeroIn.value || 100);
      const wind = +windIn.value || 0;
      const weit = v0 > 500 ? 300 : 150;

      const r = Ballistik.rechne({
        v0, bc: l.bc, modell: l.bc_modell, masseGr: l.gr,
        zeroM: zero, visierMm: 40, maxM: weit, schrittM: weit / 30, windMs: wind
      });

      const zeigeSchritt = weit / 6;
      const tabelle = r.punkte.filter(p => p.m % zeigeSchritt < 0.5 || p.m === 0);

      // Die gesetzlichen E100-Grenzen nur einblenden, wenn die Patrone überhaupt
      // in ihre Nähe kommt. Sonst streckt die 1.000-J-Linie den Maßstab einer
      // 9 mm mit 490 J so weit, dass deren eigene Kurve platt am Boden liegt.
      const eMax = Math.max(...r.punkte.map(p => p.e));
      const marken = [];
      if (eMax >= 600) marken.push({ y: 1000, farbe: '#5cbf8a', text: '1.000 J — Rehwild' });
      if (eMax >= 1200) marken.push({ y: 2000, farbe: '#e0574a', text: '2.000 J — Schalenwild' });

      // 25 m ist die gängige DSB-Kurzwaffendistanz, 100 m der Büchsen-Standard.
      const xMarken = [25, 100].filter(x => x < weit);

      $('#bl-out', balDetails).innerHTML =
        `<h4>Kugelfall über der Entfernung</h4>
         <p style="font-size:13px;color:var(--muted);margin-bottom:2px">Wie weit das Geschoss über (+) oder unter (−) dem Haltepunkt liegt. Auf dem Fleck von ${zero} m ist der Wert null.</p>` +
        linienChart({
          serien: [{ name: 'Kugelfall', farbe: '#d4a24c', punkte: r.punkte.map(p => ({ x: p.m, y: p.drop_cm })) }],
          xLabel: 'Entfernung (m)', yLabel: 'Kugelfall', yEinheit: 'cm', xMarken
        }) +
        `<h4>Energie über der Entfernung</h4>` +
        linienChart({
          serien: [{ name: 'Energie', farbe: '#5aa6c4', punkte: r.punkte.map(p => ({ x: p.m, y: p.e })) }],
          xLabel: 'Entfernung (m)', yLabel: 'Energie', yEinheit: 'J', marken, xMarken
        }) +
        `<div class="tw"><table class="t"><thead><tr>
          <th>Distanz</th><th>v</th><th>Energie</th><th>${gl('kugelfall', 'Kugelfall')}</th>${wind ? `<th>${gl('windabdrift', 'Wind')}</th>` : ''}<th>Flugzeit</th>
        </tr></thead><tbody>${tabelle.map(p => {
          // Beträge unter 0,5 mm auf null ziehen — sonst steht auf dem Fleck "-0,0 cm"
          const dr = Math.abs(p.drop_cm) < 0.05 ? 0 : p.drop_cm;
          return `
          <tr>
            <td class="num name">${p.m} m</td>
            <td class="num">${nf(p.v)} m/s${p.mach < 1 && p.m === 0 ? ' <span class="tag">unterschall</span>' : ''}</td>
            <td class="num">${nf(p.e)} J</td>
            <td class="num">${dr > 0 ? '+' : ''}${nf(dr, 1)} cm</td>
            ${wind ? `<td class="num">${nf(p.drift_cm, 1)} cm</td>` : ''}
            <td class="num">${nf(p.t, 2)} s</td>
          </tr>`; }).join('')}</tbody></table></div>
        <div class="src">Gerechnet mit ${l.bc_modell}-Widerstandsmodell, BC ${nf(l.bc, 3)}, Visierhöhe 40 mm, Normatmosphäre 15 °C / 1013 hPa / 50 % rF. Luftdichte ${nf(r.rho, 3)} kg/m³. Abgangswinkel ${nf(r.winkelMrad, 2)} mrad. Reale Werte weichen ab — die eigene v₀ zu messen bringt mehr als jede Nachkommastelle hier.</div>`;
    }
    labSel.addEventListener('change', () => { v0In.value = labs[+labSel.value].v0; rechneUndZeichne(); });
    [v0In, zeroIn, windIn].forEach(el => el.addEventListener('input', rechneUndZeichne));
    v0In.value = labs[0].v0;
    balDetails.addEventListener('toggle', function once() {
      if (balDetails.open) { rechneUndZeichne(); balDetails.removeEventListener('toggle', once); }
    });

    /* 05 Marktüberblick & Preise */
    if (preise) {
      const klasse = { guenstig: 'günstig', mittel: 'Mittelklasse', premium: 'Premium' };
      kapitel('Marktüberblick & Preise', `${preise.produkte.length} Angebote`, `
        <div class="price-bar">
          <div class="pb-track"></div>
          <div class="pb-labels"><span>${eur(preise.range_eur_schuss[0])} / Schuss</span><span>${eur(preise.range_eur_schuss[1])} / Schuss</span></div>
        </div>
        <p>${esc(preise.kommentar)}</p>
        <div class="tw"><table class="t">
          <thead><tr><th>Hersteller / Typ</th><th>Klasse</th><th>Packung</th><th>€/Schuss</th><th>Händler</th></tr></thead>
          <tbody>${preise.produkte.map(p => `
            <tr>
              <td class="name">${esc(p.hersteller)}<br><span style="color:var(--muted);font-weight:400">${esc(p.typ)}</span></td>
              <td>${klasse[p.klasse] || p.klasse}</td>
              <td class="num">${p.packung} Stk<br><span style="color:var(--dim)">${eur(p.eur_packung)}</span></td>
              <td class="num" style="color:var(--brass);font-weight:600">${eur(p.eur_schuss)}</td>
              <td><a class="ext" href="${esc(p.url)}" target="_blank" rel="noopener noreferrer">${esc(p.haendler)} ↗</a></td>
            </tr>`).join('')}</tbody>
        </table></div>
        <div class="src">Preisstand ${esc(PREISE.stand)} · Quelle: ${esc(PREISE.quelle)}. Richtwerte inkl. MwSt., ohne Versand — bewusst keine Tagespreise. Der Link führt zum Händler, dort steht der aktuelle Preis.</div>`);
    }

    /* 06 Präzision / Beschussbilder */
    const praez = kapitel('Beschussbilder & Präzision', 'dein Schießbuch', `<div id="shots"></div>`);
    renderShots(id, k, $('#shots', praez));

    /* 07 Recht in Deutschland */
    const r = k.recht_de;
    kapitel('Recht in Deutschland', 'WaffG / BJagdG', `
      <h4>Sport & Erwerb</h4><p>${esc(r.sport)}</p>
      <h4>Jagd</h4><p>${esc(r.jagd)}</p>
      <h4>Zu beachten</h4>
      <ul class="pc-list pc-con">${r.hinweise.map(h => `<li>${esc(h)}</li>`).join('')}</ul>
      <div class="note">Das ist eine Zusammenfassung nach bestem Wissen, keine Rechtsberatung. Jagdrecht ist Landesrecht und ändert sich — im Zweifel gilt dein Landesjagdgesetz und die untere Jagdbehörde.</div>`);

    /* 08 Vor- & Nachteile */
    kapitel('Vor- & Nachteile', '', `
      <div class="pro-con">
        <div><h4 style="margin-top:0">Spricht dafür</h4><ul class="pc-list pc-pro">${k.vorteile.map(v => `<li>${esc(v)}</li>`).join('')}</ul></div>
        <div><h4 style="margin-top:0">Spricht dagegen</h4><ul class="pc-list pc-con">${k.nachteile.map(v => `<li>${esc(v)}</li>`).join('')}</ul></div>
      </div>`);

    /* 09 Varianten & Nachbarkaliber */
    kapitel('Varianten & Nachbarkaliber', `${k.varianten.length} Varianten`, `
      <h4>Varianten</h4>
      <div class="dl" style="grid-template-columns:1fr">
        ${k.varianten.map(v => `<dt style="color:var(--text);font-weight:600;border:none;padding-bottom:2px">${esc(v.name)}</dt>
          <dd style="text-align:left;font-family:var(--sans);color:#cfd8e3;padding-top:0">${esc(v.text)}</dd>`).join('')}
      </div>
      <h4>Im Vergleich zu</h4>
      <div class="dl" style="grid-template-columns:1fr">
        ${k.nachbarn.map(v => `<dt style="color:var(--steel);font-weight:600;border:none;padding-bottom:2px">${esc(v.name)}</dt>
          <dd style="text-align:left;font-family:var(--sans);color:#cfd8e3;padding-top:0">${esc(v.text)}</dd>`).join('')}
      </div>`);

    /* 10 Schalldämpfer */
    if (k.subsonic) {
      kapitel('Unterschall & Schalldämpfer', k.subsonic.tauglich ? 'geeignet' : 'ungeeignet',
        `<p>${esc(k.subsonic.text)}</p>`);
    }

    /* 11 Wiederladen */
    kapitel('Wiederladen', `${k.pulver.length} Pulver`, `
      <h4>Bewährte Pulversorten</h4>
      <div class="dl" style="grid-template-columns:1fr">
        ${k.pulver.map(p => `<dt style="color:var(--text);font-weight:600;border:none;padding-bottom:2px">${esc(p.name)}</dt>
          <dd style="text-align:left;font-family:var(--sans);color:#cfd8e3;padding-top:0">${esc(p.eignung)}</dd>`).join('')}
      </div>
      <h4>Ladedaten</h4>
      <p>Konkrete Ladungsgewichte stehen bewusst nicht in dieser App. Abgeschriebene Ladedaten ohne Bezug auf deine Charge, dein Pulverlos und deine Waffe sind ein echtes Sicherheitsrisiko. Nimm die Originaldaten des Pulverherstellers — die sind kostenlos, aktuell und gelten für die Charge, die du in der Hand hast.</p>
      <ul class="pc-list" style="list-style:none">
        ${k.ladedaten_links.map(l => `<li style="padding-left:0"><a class="ext" href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">${esc(l.titel)} ↗</a></li>`).join('')}
      </ul>`);

    /* Quellen */
    const q = document.createElement('div');
    q.className = 'src';
    q.innerHTML = 'Quellen: ' + k.quellen.map(s =>
      `<a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.titel)}</a>`).join(' · ');
    view.appendChild(q);

    window.scrollTo(0, 0);
  }

  /* ---------- Eigene Beschussdaten (lokal auf dem Gerät) ---------- */

  const shotsKey = id => 'kk.shots.' + id;
  const ladeShots = id => { try { return JSON.parse(localStorage.getItem(shotsKey(id))) || []; } catch { return []; } };
  const speicherShots = (id, arr) => localStorage.setItem(shotsKey(id), JSON.stringify(arr));

  function renderShots(id, k, host) {
    const shots = ladeShots(id);

    const chart = shots.length >= 2 ? linienChart({
      serien: [{
        name: 'Streukreis', farbe: '#5cbf8a',
        punkte: shots.map((s, i) => ({ x: i + 1, y: +s.streukreis }))
      }],
      xLabel: 'Eintrag Nr.', yLabel: 'Streukreis (mm)'
    }) : '';

    host.innerHTML = `
      ${k.praezision_hinweis ? `<div class="note">${esc(k.praezision_hinweis)}</div>` : ''}
      ${shots.length ? `
        <div class="tw"><table class="t">
          <thead><tr><th>Datum</th><th>Munition</th><th>${gl('v0', 'v₀')} / ${gl('v0diff', 'Diff.')}</th><th>Distanz</th><th>${gl('streukreis', 'Streukreis')}</th><th>${gl('testumgebung', 'Auflage')}</th><th></th></tr></thead>
          <tbody>${shots.map((s, i) => `
            <tr>
              <td class="num">${esc(s.datum)}</td>
              <td class="name">${esc(s.hersteller)} ${esc(s.gr)} gr<br><span style="color:var(--muted);font-weight:400">${esc(s.typ)}</span>${s.laborierung ? `<br><span style="color:var(--dim);font-size:11.5px">${esc(s.laborierung)}</span>` : ''}</td>
              <td class="num">${esc(s.v0)} m/s${s.v0diff ? `<br><span style="color:var(--dim)">± ${esc(s.v0diff)}</span>` : ''}</td>
              <td class="num">${esc(s.dist)} m</td>
              <td class="num" style="color:var(--brass);font-weight:600">${esc(s.streukreis)} mm</td>
              <td>${esc(s.umgebung)}${s.bemerkung ? `<br><span style="color:var(--dim);font-size:11.5px">${esc(s.bemerkung)}</span>` : ''}</td>
              <td><button class="del" data-i="${i}" aria-label="Eintrag löschen">✕</button></td>
            </tr>`).join('')}</tbody>
        </table></div>${chart}`
        : `<div class="own-empty">Noch keine eigenen Beschussdaten für ${esc(k.name)}.<br>Trag deine Messungen ein — das ist die einzige Präzisionsangabe, die für <em>deine</em> Waffe gilt.</div>`}
      <div class="btn-row">
        <button class="btn" id="add-shot">+ Beschussbild eintragen</button>
        ${shots.length ? '<button class="btn-ghost" id="exp-shot">Exportieren (JSON)</button>' : ''}
      </div>
      <div id="shot-form"></div>`;

    host.querySelectorAll('.del').forEach(b => b.addEventListener('click', () => {
      const arr = ladeShots(id); arr.splice(+b.dataset.i, 1); speicherShots(id, arr); renderShots(id, k, host);
    }));

    const expBtn = $('#exp-shot', host);
    if (expBtn) expBtn.addEventListener('click', () => {
      const blob = new Blob([JSON.stringify({ kaliber: id, eintraege: ladeShots(id) }, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `beschussdaten-${id}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
    });

    $('#add-shot', host).addEventListener('click', () => {
      const f = $('#shot-form', host);
      if (f.innerHTML) { f.innerHTML = ''; return; }
      const heute = new Date().toISOString().slice(0, 10);
      f.innerHTML = `
        <div style="margin-top:14px;padding:14px;background:var(--surface-2);border-radius:10px;border:1px solid var(--line)">
          <div class="calc-row">
            <div class="field"><label>Datum</label><input id="f-datum" type="date" value="${heute}"></div>
            <div class="field"><label>Hersteller</label><input id="f-hersteller" placeholder="Hornady"></div>
            <div class="field"><label>Typ</label><input id="f-typ" placeholder="V-MAX"></div>
            <div class="field"><label>Gewicht (gr)</label><input id="f-gr" type="number" inputmode="numeric" placeholder="110"></div>
            <div class="field"><label>${gl('laborierung', 'Laborierung')}</label><input id="f-lab" placeholder="Fabrik / 18,5 gr N110"></div>
            <div class="field"><label>${gl('v0', 'v₀ (m/s)')}</label><input id="f-v0" type="number" inputmode="numeric" placeholder="730"></div>
            <div class="field"><label>${gl('v0diff', 'v₀-Diff. (m/s)')}</label><input id="f-v0diff" type="number" inputmode="numeric" placeholder="8"></div>
            <div class="field"><label>Distanz (m)</label><input id="f-dist" type="number" inputmode="numeric" value="100"></div>
            <div class="field"><label>${gl('streukreis', 'Streukreis (mm)')}</label><input id="f-sk" type="number" inputmode="decimal" placeholder="28"></div>
            <div class="field"><label>${gl('testumgebung', 'Testumgebung')}</label>
              <select id="f-umg">
                <option>eingespannt</option><option>Auflage / Sandsack</option>
                <option>Zweibein</option><option>freihändig</option><option>sitzend aufgelegt</option>
              </select></div>
          </div>
          <div class="field" style="margin-bottom:12px"><label>Bemerkung</label><input id="f-bem" placeholder="5 Schuss, 12 °C, leichter Wind von rechts"></div>
          <button class="btn" id="f-save">Speichern</button>
        </div>`;
      $('#f-save', f).addEventListener('click', () => {
        const g = sel => ($(sel, f).value || '').trim();
        if (!g('#f-sk')) { $('#f-sk', f).focus(); return; }
        const arr = ladeShots(id);
        arr.push({
          datum: g('#f-datum'), hersteller: g('#f-hersteller') || '—', typ: g('#f-typ'),
          gr: g('#f-gr'), laborierung: g('#f-lab'), v0: g('#f-v0'), v0diff: g('#f-v0diff'),
          dist: g('#f-dist') || '100', streukreis: g('#f-sk'), umgebung: g('#f-umg'), bemerkung: g('#f-bem')
        });
        speicherShots(id, arr);
        renderShots(id, k, host);
      });
    });
  }

  /* ---------- Router ---------- */

  function route() {
    const h = location.hash || '#/';
    const mm = h.match(/^#\/k\/([\w-]+)$/);
    if (mm) { renderDetail(mm[1]); }
    else { renderHome(searchEl.value); }
  }

  /* ---------- Datenaktualisierung ---------- */

  async function ladeDaten(bust) {
    [INDEX, PREISE, GLOSSAR] = await Promise.all([
      getJSON('data/index.json', bust),
      getJSON('data/preise.json', bust),
      getJSON('data/glossar.json', bust)
    ]);
    stampEl.textContent = `${INDEX.kaliber.length} Kaliber · Preise ${PREISE.stand}`;
  }

  refreshEl.addEventListener('click', async () => {
    refreshEl.textContent = 'Lade …';
    refreshEl.dataset.busy = '1';
    try {
      CACHE.clear();
      if ('serviceWorker' in navigator) {
        const reg = await navigator.serviceWorker.getRegistration();
        if (reg) {
          if (reg.active) reg.active.postMessage({ typ: 'daten-neu' });
          // Auch nach einer neuen App-Version sehen, nicht nur nach neuen Daten
          reg.update().catch(() => {});
        }
      }
      await ladeDaten(true);
      route();
      refreshEl.textContent = '✓ Aktuell';
    } catch (e) {
      refreshEl.textContent = 'Offline — nichts geändert';
    }
    setTimeout(() => { refreshEl.textContent = 'Daten aktualisieren'; delete refreshEl.dataset.busy; }, 2500);
  });

  /* ---------- Installation & Weitergabe ---------- */

  // Gedacht für Leute, die nichts einstellen wollen: ein Tipp auf "Installieren"
  // und die App liegt auf dem Startbildschirm. Wo der Browser das nicht selbst
  // anbietet (vor allem iPhone), muss eine konkrete Anleitung stehen statt einer
  // Sackgasse.
  const installEl = document.getElementById('install');
  const shareEl = document.getElementById('share');
  let installPrompt = null;

  const laeuftAlsApp = () =>
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: fullscreen)').matches ||
    window.navigator.standalone === true;

  const istIOS = () =>
    /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  function zeigeInstall(modus) {
    if (laeuftAlsApp() || localStorage.getItem('kk.install.weg') === '1') return;
    if (modus === 'ios') {
      $('#install-t').textContent = 'KALIBER auf den Startbildschirm';
      $('#install-x').innerHTML = 'Unten auf <strong>Teilen</strong> tippen, dann auf ' +
        '<strong>„Zum Home-Bildschirm“</strong>. Danach liegt die App wie jede andere auf dem Gerät.';
      $('#install-go').hidden = true;
    }
    installEl.hidden = false;
  }

  window.addEventListener('beforeinstallprompt', e => {
    // Den eigenen Hinweis statt der unscheinbaren Browserleiste zeigen
    e.preventDefault();
    installPrompt = e;
    zeigeInstall('auto');
  });

  window.addEventListener('appinstalled', () => {
    installPrompt = null;
    installEl.hidden = true;
    localStorage.setItem('kk.install.weg', '1');
  });

  $('#install-go').addEventListener('click', async () => {
    if (!installPrompt) return;
    installEl.hidden = true;
    installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;
    installPrompt = null;
    // Abgelehnt? Dann nicht drängeln — der Browser bietet es später erneut an.
    if (outcome !== 'accepted') localStorage.setItem('kk.install.weg', '1');
  });

  $('#install-no').addEventListener('click', () => {
    installEl.hidden = true;
    localStorage.setItem('kk.install.weg', '1');
  });

  // iPhone/iPad feuern kein beforeinstallprompt — dort hilft nur die Anleitung.
  if (istIOS() && !laeuftAlsApp()) setTimeout(() => zeigeInstall('ios'), 2500);

  // Weitergeben: öffnet das native Teilen-Menü (WhatsApp, SMS, Mail …).
  if (navigator.share) {
    shareEl.hidden = false;
    shareEl.addEventListener('click', async () => {
      try {
        await navigator.share({
          title: 'KALIBER — Munitions-Kompendium',
          text: 'Nachschlagewerk für Munition: Kaliber, ballistische Werte, Preise. Link öffnen, dann auf „Installieren“ tippen.',
          url: location.origin + location.pathname
        });
      } catch { /* abgebrochen — kein Fehler */ }
    });
  }

  /* ---------- Start ---------- */

  let sT;
  searchEl.addEventListener('input', () => {
    clearTimeout(sT);
    sT = setTimeout(() => {
      if (location.hash !== '#/' && location.hash !== '') { location.hash = '#/'; }
      else renderHome(searchEl.value);
    }, 130);
  });
  backEl.addEventListener('click', () => { location.hash = '#/'; });
  window.addEventListener('hashchange', route);

  ladeDaten(false).then(route).catch(e => {
    view.innerHTML = `<div class="empty">Daten konnten nicht geladen werden.<br><span class="mono">${esc(e.message)}</span>
      <p style="margin-top:14px;font-size:13px">Bei lokalem Öffnen per Doppelklick blockiert der Browser das Laden der JSON-Dateien.
      Nutze einen lokalen Server (<span class="mono">python -m http.server</span>) oder die gehostete Version.</p></div>`;
  });

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    // Übernimmt ein neuer Service Worker, läuft im Fenster noch der alte Code
    // weiter — einmal neu laden holt ihn ab. Der Reload nur, wenn vorher schon
    // ein Worker aktiv war: bei der Erstinstallation feuert controllerchange
    // ebenfalls, und dort wäre ein Reload überflüssig.
    const hatteController = !!navigator.serviceWorker.controller;
    let neugeladen = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hatteController || neugeladen) return;
      neugeladen = true;
      location.reload();
    });
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }
})();
