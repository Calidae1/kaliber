/* ballistik.js — Punktmassen-Flugbahnrechner mit G1/G7-Widerstandsmodell.
 *
 * Rechnet die Flugbahn numerisch (RK4) statt aus Tabellen zu interpolieren.
 * Grundgleichung der Verzögerung, hergeleitet aus F = ½·ρ·v²·Cd·A und BC = SD/i:
 *
 *     a = (π/8) · ρ · v² · Cd_std(Mach) / BC_si
 *
 * BC wird wie üblich in lb/in² angegeben; Umrechnung in kg/m²: × 703,0696.
 */

(function (global) {
  'use strict';

  // Standard-Widerstandstabellen (Mach -> Cd) nach dem jeweiligen Referenzgeschoss.
  const G1 = [
    [0.00,0.2629],[0.05,0.2558],[0.10,0.2487],[0.15,0.2413],[0.20,0.2344],[0.25,0.2278],
    [0.30,0.2214],[0.35,0.2155],[0.40,0.2104],[0.45,0.2061],[0.50,0.2032],[0.55,0.2020],
    [0.60,0.2034],[0.70,0.2165],[0.725,0.2230],[0.75,0.2313],[0.775,0.2417],[0.80,0.2546],
    [0.825,0.2706],[0.85,0.2901],[0.875,0.3136],[0.90,0.3415],[0.925,0.3734],[0.95,0.4084],
    [0.975,0.4448],[1.0,0.4805],[1.025,0.5136],[1.05,0.5427],[1.075,0.5677],[1.10,0.5883],
    [1.125,0.6053],[1.15,0.6191],[1.20,0.6393],[1.25,0.6503],[1.30,0.6572],[1.35,0.6607],
    [1.40,0.6614],[1.45,0.6603],[1.50,0.6580],[1.55,0.6549],[1.60,0.6513],[1.65,0.6474],
    [1.70,0.6432],[1.75,0.6390],[1.80,0.6347],[1.85,0.6304],[1.90,0.6261],[1.95,0.6217],
    [2.00,0.6173],[2.05,0.6130],[2.10,0.6087],[2.15,0.6045],[2.20,0.6003],[2.25,0.5962],
    [2.30,0.5922],[2.35,0.5882],[2.40,0.5842],[2.45,0.5803],[2.50,0.5764],[2.60,0.5688],
    [2.70,0.5615],[2.80,0.5544],[2.90,0.5477],[3.00,0.5412],[3.10,0.5349],[3.20,0.5289],
    [3.30,0.5231],[3.40,0.5175],[3.50,0.5122],[3.60,0.5070],[3.70,0.5021],[3.80,0.4973],
    [3.90,0.4927],[4.00,0.4882],[4.20,0.4787],[4.40,0.4707],[4.60,0.4642],[4.80,0.4588],
    [5.00,0.4545]
  ];

  const G7 = [
    [0.00,0.1198],[0.05,0.1197],[0.10,0.1196],[0.15,0.1194],[0.20,0.1193],[0.25,0.1194],
    [0.30,0.1194],[0.35,0.1194],[0.40,0.1193],[0.45,0.1193],[0.50,0.1194],[0.55,0.1193],
    [0.60,0.1194],[0.65,0.1197],[0.70,0.1202],[0.75,0.1215],[0.775,0.1226],[0.80,0.1242],
    [0.825,0.1266],[0.85,0.1306],[0.875,0.1368],[0.90,0.1464],[0.925,0.1660],[0.95,0.2054],
    [0.975,0.2993],[1.0,0.3803],[1.025,0.4015],[1.05,0.4043],[1.075,0.4034],[1.10,0.4014],
    [1.125,0.3987],[1.15,0.3955],[1.20,0.3884],[1.25,0.3810],[1.30,0.3732],[1.35,0.3657],
    [1.40,0.3580],[1.50,0.3440],[1.55,0.3376],[1.60,0.3315],[1.65,0.3260],[1.70,0.3209],
    [1.75,0.3160],[1.80,0.3117],[1.85,0.3078],[1.90,0.3042],[1.95,0.3010],[2.00,0.2980],
    [2.05,0.2951],[2.10,0.2922],[2.15,0.2892],[2.20,0.2864],[2.25,0.2835],[2.30,0.2807],
    [2.35,0.2779],[2.40,0.2752],[2.45,0.2725],[2.50,0.2697],[2.55,0.2670],[2.60,0.2643],
    [2.65,0.2615],[2.70,0.2588],[2.75,0.2561],[2.80,0.2533],[2.85,0.2506],[2.90,0.2479],
    [2.95,0.2451],[3.00,0.2424],[3.10,0.2368],[3.20,0.2313],[3.30,0.2258],[3.40,0.2205],
    [3.50,0.2154],[3.60,0.2106],[3.70,0.2060],[3.80,0.2017],[3.90,0.1975],[4.00,0.1935],
    [4.20,0.1861],[4.40,0.1793],[4.60,0.1730],[4.80,0.1672],[5.00,0.1618]
  ];

  const LB_IN2_TO_KG_M2 = 703.0696;
  const GRAIN_TO_KG = 0.00006479891;
  const G = 9.80665;

  function cdLookup(table, mach) {
    if (mach <= table[0][0]) return table[0][1];
    const last = table[table.length - 1];
    if (mach >= last[0]) return last[1];
    let lo = 0, hi = table.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (table[mid][0] <= mach) lo = mid; else hi = mid;
    }
    const [m0, c0] = table[lo], [m1, c1] = table[hi];
    return c0 + (c1 - c0) * (mach - m0) / (m1 - m0);
  }

  /** Luftdichte (kg/m³) und Schallgeschwindigkeit (m/s) für die Atmosphäre. */
  function atmosphere(tempC, pressureHpa, humidity) {
    const T = tempC + 273.15;
    // Sättigungsdampfdruck nach Magnus, für feuchte Luft
    const psat = 6.1078 * Math.pow(10, (7.5 * tempC) / (237.3 + tempC));
    const pv = (humidity != null ? humidity : 0.5) * psat;
    const pd = pressureHpa - pv;
    const rho = (pd * 100) / (287.058 * T) + (pv * 100) / (461.495 * T);
    const mach = 331.3 * Math.sqrt(1 + tempC / 273.15);
    return { rho, mach };
  }

  /**
   * Flugbahn rechnen.
   * @param {object} o
   * @param {number} o.v0            Mündungsgeschwindigkeit [m/s]
   * @param {number} o.bc            Ballistischer Koeffizient [lb/in²]
   * @param {string} [o.modell]      "G1" (Standard) oder "G7"
   * @param {number} o.masseGr       Geschossmasse [grain]
   * @param {number} [o.zeroM=100]   Einschussentfernung [m]
   * @param {number} [o.visierMm=40] Visierhöhe über Seelenachse [mm]
   * @param {number} [o.maxM=300]    Rechenweite [m]
   * @param {number} [o.schrittM=10] Ausgabeschritt [m]
   * @param {number} [o.windMs=0]    Seitenwind, 90° [m/s]
   * @param {number} [o.tempC=15]
   * @param {number} [o.druckHpa=1013.25]
   * @param {number} [o.feuchte=0.5]
   * @returns {{punkte: Array, winkelMrad: number, rho: number}}
   */
  function rechne(o) {
    const table = (o.modell === 'G7') ? G7 : G1;
    const bcSi = o.bc * LB_IN2_TO_KG_M2;
    const masseKg = o.masseGr * GRAIN_TO_KG;
    const zeroM = o.zeroM != null ? o.zeroM : 100;
    const sightM = (o.visierMm != null ? o.visierMm : 40) / 1000;
    const maxM = o.maxM != null ? o.maxM : 300;
    const stepM = o.schrittM != null ? o.schrittM : 10;
    const windMs = o.windMs || 0;
    const { rho, mach: cSound } = atmosphere(
      o.tempC != null ? o.tempC : 15,
      o.druckHpa != null ? o.druckHpa : 1013.25,
      o.feuchte != null ? o.feuchte : 0.5
    );

    const k = (Math.PI / 8) * rho / bcSi;

    // Ableitung des Zustands [x, y, vx, vy]
    function deriv(s) {
      const vx = s[2], vy = s[3];
      const v = Math.hypot(vx, vy);
      if (v < 1e-6) return [vx, vy, 0, -G];
      const cd = cdLookup(table, v / cSound);
      const a = k * v * cd; // = (π/8)·ρ·Cd·v/BC  → mit vx bzw. vy multipliziert ergibt v²-Abhängigkeit
      return [vx, vy, -a * vx, -a * vy - G];
    }

    function step(s, dt) {
      const k1 = deriv(s);
      const s2 = s.map((val, i) => val + k1[i] * dt / 2);
      const k2 = deriv(s2);
      const s3 = s.map((val, i) => val + k2[i] * dt / 2);
      const k3 = deriv(s3);
      const s4 = s.map((val, i) => val + k3[i] * dt);
      const k4 = deriv(s4);
      return s.map((val, i) => val + (dt / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]));
    }

    // Flugbahn bis maxM verfolgen, y relativ zur Seelenachse
    function fliege(angleRad, bisM) {
      const out = [];
      let s = [0, 0, o.v0 * Math.cos(angleRad), o.v0 * Math.sin(angleRad)];
      let t = 0;
      let nextOut = 0;
      const dt = 0.0005;
      const eps = 1e-9;
      let guard = 0;
      // Wichtig: erst ausgeben, dann integrieren. Andernfalls überspringt der
      // Integrationsschritt die letzte Marke und der Endpunkt fehlt in der Tabelle.
      while (nextOut <= bisM + eps && guard++ < 2000000) {
        while (s[0] >= nextOut - eps && nextOut <= bisM + eps) {
          out.push({ x: nextOut, y: s[1], vx: s[2], vy: s[3], t });
          nextOut += stepM;
        }
        if (nextOut > bisM + eps) break;
        s = step(s, dt);
        t += dt;
        if (s[2] <= 0) break; // Geschoss steht — Abbruch
      }
      return out;
    }

    // Höhe der Bahn (ab Seelenachse) exakt bei Entfernung D, linear interpoliert.
    // Bewusst unabhängig vom Ausgaberaster: die Einschussentfernung muss kein
    // Vielfaches der Schrittweite sein.
    function yBei(angleRad, D) {
      let s = [0, 0, o.v0 * Math.cos(angleRad), o.v0 * Math.sin(angleRad)];
      const dt = 0.0005;
      let guard = 0;
      while (s[0] < D && guard++ < 2000000) {
        const vor = s;
        s = step(s, dt);
        if (s[2] <= 0) return -999;
        if (s[0] >= D) {
          const f = (D - vor[0]) / (s[0] - vor[0]);
          return vor[1] + (s[1] - vor[1]) * f;
        }
      }
      return s[1];
    }

    // Abgangswinkel so bestimmen, dass die Bahn die Visierlinie auf zeroM schneidet.
    // Die Visierlinie liegt an der Mündung sightM über der Seelenachse und trifft
    // die Bahn auf zeroM; gemessen ab Seelenachse ist die Zielbedingung y(zeroM) = 0.
    // Gelöst per Sekantenverfahren.
    const fehler = a => yBei(a, zeroM);

    let a0 = 0, a1 = 0.02;
    let f0 = fehler(a0);
    let f1 = fehler(a1);
    for (let i = 0; i < 40 && Math.abs(f1) > 1e-5; i++) {
      const d = (f1 - f0) / (a1 - a0);
      if (!isFinite(d) || Math.abs(d) < 1e-12) break;
      const a2 = a1 - f1 / d;
      a0 = a1; f0 = f1;
      a1 = Math.max(-0.05, Math.min(0.5, a2));
      f1 = fehler(a1);
    }
    const winkel = a1;

    const bahn = fliege(winkel, maxM);
    const punkte = bahn.map(p => {
      const v = Math.hypot(p.vx, p.vy);
      // Visierlinie: startet sightM über der Seelenachse an der Mündung,
      // verläuft geradlinig und schneidet die Bahn auf zeroM.
      const yVisier = sightM * (1 - p.x / zeroM);
      const dropM = p.y - yVisier;
      // Windabdrift nach dem Verzögerungszeit-Ansatz: Drift = w · (t − x/v0)
      const drift = windMs * (p.t - p.x / o.v0);
      return {
        m: Math.round(p.x),
        v: v,
        e: 0.5 * masseKg * v * v,
        drop_cm: dropM * 100,
        drift_cm: drift * 100,
        t: p.t,
        mach: v / cSound
      };
    });

    return { punkte, winkelMrad: winkel * 1000, rho, cSound };
  }

  /** Mündungsenergie [J] aus Masse [grain] und v0 [m/s]. */
  function e0(masseGr, v0) {
    return 0.5 * masseGr * GRAIN_TO_KG * v0 * v0;
  }

  global.Ballistik = { rechne, e0, atmosphere, GRAIN_TO_KG };

})(typeof window !== 'undefined' ? window : this);
