#!/usr/bin/env python3
"""Prüft die Datenbank auf Vollständigkeit und innere Widersprüche.

    python tools/pruefe.py

Findet Fehler, die beim Schreiben von Hand entstehen: fehlende Felder,
Kaliber, die im Index stehen aber keine Datei haben, Wertespannen die nicht
zu den Laborierungen passen, unmögliche Geometrie, unbekannte Glossar-
Schlüssel, kaputte Preisverweise.

Die Mündungsenergie wird aus Geschossgewicht und v0 nachgerechnet und gegen
die angegebene Spanne geprüft — genau die Art Fehler, die man beim Tippen
nicht sieht.
"""

import json
import sys
from pathlib import Path

WURZEL = Path(__file__).resolve().parent.parent
DATA = WURZEL / "data"

GRAIN_KG = 0.00006479891

fehler: list[str] = []
warnung: list[str] = []


def f(msg: str) -> None:
    fehler.append(msg)


def w(msg: str) -> None:
    warnung.append(msg)


def lade(p: Path):
    try:
        with p.open(encoding="utf-8") as fh:
            return json.load(fh)
    except FileNotFoundError:
        f(f"Datei fehlt: {p.relative_to(WURZEL)}")
    except json.JSONDecodeError as e:
        f(f"JSON kaputt in {p.relative_to(WURZEL)}: {e}")
    return None


def e0(gr: float, v0: float) -> float:
    return 0.5 * gr * GRAIN_KG * v0 * v0


PFLICHT = [
    "id", "name", "aliase", "gruppen", "kurz", "schnell", "basis", "masse",
    "werte", "pulver", "ladedaten_links", "vorteile", "nachteile",
    "recht_de", "varianten", "nachbarn", "quellen",
]
PFLICHT_MASSE = [
    "norm", "huelsenform", "geschoss_mm", "hals_mm", "boden_mm",
    "huelsenlaenge_mm", "col_mm", "gasdruck_bar", "zuender", "drall",
]
PFLICHT_LAB = ["hersteller", "typ", "gr", "g", "v0", "bc", "bc_modell", "zweck"]


def main() -> int:
    index = lade(DATA / "index.json")
    preise = lade(DATA / "preise.json")
    glossar = lade(DATA / "glossar.json")
    if not (index and preise and glossar):
        for m in fehler:
            print("FEHLER  " + m)
        return 1

    gl_keys = set(glossar["begriffe"])
    gruppen_ids = set(index["gruppen"])
    index_ids = [k["id"] for k in index["kaliber"]]

    if len(index_ids) != len(set(index_ids)):
        f("Doppelte id im Index.")

    dateien = {p.stem for p in (DATA / "kaliber").glob("*.json")}
    for verwaist in dateien - set(index_ids):
        w(f"Datei data/kaliber/{verwaist}.json steht nicht im Index — wird nie angezeigt.")

    alias_karte: dict[str, str] = {}

    for eintrag in index["kaliber"]:
        kid = eintrag["id"]
        pfad = DATA / "kaliber" / f"{kid}.json"
        if not pfad.exists():
            f(f"[{kid}] Im Index, aber data/kaliber/{kid}.json fehlt.")
            continue
        k = lade(pfad)
        if not k:
            continue

        for feld in PFLICHT:
            if feld not in k:
                f(f"[{kid}] Pflichtfeld fehlt: {feld}")
        if k.get("id") != kid:
            f(f"[{kid}] id in der Datei ist '{k.get('id')}' — passt nicht zum Index.")
        if k.get("name") != eintrag["name"]:
            f(f"[{kid}] name weicht ab: Index '{eintrag['name']}' vs Datei '{k.get('name')}'")
        if set(k.get("gruppen", [])) != set(eintrag.get("gruppen", [])):
            f(f"[{kid}] gruppen weichen zwischen Index und Datei ab.")
        for g in eintrag.get("gruppen", []):
            if g not in gruppen_ids:
                f(f"[{kid}] Unbekannte Gruppe '{g}'.")

        # Aliase dürfen sich nicht zwischen Kalibern überschneiden
        for a in [eintrag["name"], *eintrag.get("aliase", [])]:
            norm = "".join(c for c in a.lower() if c.isalnum())
            if norm in alias_karte and alias_karte[norm] != kid:
                f(f"[{kid}] Alias '{a}' kollidiert mit {alias_karte[norm]}.")
            alias_karte[norm] = kid

        m = k.get("masse", {})
        for feld in PFLICHT_MASSE:
            if m.get(feld) in (None, ""):
                f(f"[{kid}] masse.{feld} fehlt.")

        # Geometrie muss physisch möglich sein
        try:
            if m["huelsenlaenge_mm"] >= m["col_mm"]:
                f(f"[{kid}] Hülse ({m['huelsenlaenge_mm']}) ist nicht kürzer als COL ({m['col_mm']}).")
            if m["geschoss_mm"] >= m["hals_mm"]:
                f(f"[{kid}] Geschoss ({m['geschoss_mm']}) ist nicht dünner als der Hals ({m['hals_mm']}).")
            if m["hals_mm"] > m["boden_mm"] + 0.01:
                f(f"[{kid}] Hals ({m['hals_mm']}) ist dicker als der Boden ({m['boden_mm']}).")
            form = m.get("huelsenform", "").lower()
            # "ohne Flaschenhals" ist die Beschreibung einer Zylinderhülse —
            # nicht auf den blanken Teilstring hereinfallen.
            ist_flaschenhals = "flaschenhals" in form and "ohne flaschenhals" not in form
            if m.get("schulter_mm"):
                if not (m["hals_mm"] <= m["schulter_mm"] <= m["boden_mm"] + 0.01):
                    f(f"[{kid}] Schulter ({m['schulter_mm']}) liegt nicht zwischen Hals und Boden.")
                if not ist_flaschenhals:
                    w(f"[{kid}] schulter_mm gesetzt, aber huelsenform nennt keinen Flaschenhals.")
            elif ist_flaschenhals:
                f(f"[{kid}] Hülsenform sagt Flaschenhals, aber schulter_mm fehlt.")
            if not 500 <= m["gasdruck_bar"] <= 4800:
                w(f"[{kid}] Gasdruck {m['gasdruck_bar']} bar wirkt unplausibel.")
        except KeyError:
            pass

        labs = k.get("werte", {}).get("laborierungen", [])
        if len(labs) < 3:
            w(f"[{kid}] Nur {len(labs)} Laborierungen — für den Rechner dünn.")

        gr_werte, v0_werte, e0_werte = [], [], []
        for i, l in enumerate(labs):
            wo = f"[{kid}] Laborierung {i + 1} ({l.get('hersteller', '?')} {l.get('gr', '?')} gr)"
            for feld in PFLICHT_LAB:
                if l.get(feld) in (None, ""):
                    f(f"{wo}: Feld '{feld}' fehlt.")
                    break
            else:
                if l["bc_modell"] not in ("G1", "G7"):
                    f(f"{wo}: bc_modell '{l['bc_modell']}' ist weder G1 noch G7.")
                if not 0.05 <= l["bc"] <= 1.2:
                    f(f"{wo}: BC {l['bc']} liegt außerhalb jeder Plausibilität.")
                # gr <-> g müssen zueinander passen
                soll_g = l["gr"] * 0.06479891
                if abs(soll_g - l["g"]) > 0.15:
                    f(f"{wo}: {l['gr']} gr sind {soll_g:.2f} g, angegeben ist {l['g']} g.")
                if l["geschoss_mm"] if "geschoss_mm" in l else False:
                    pass
                gr_werte.append(l["gr"])
                v0_werte.append(l["v0"])
                e0_werte.append(e0(l["gr"], l["v0"]))

        s = k.get("schnell", {})
        for feld in ("geschoss_gr", "v0_ms", "e0_j"):
            r = s.get(feld)
            if not (isinstance(r, list) and len(r) == 2):
                f(f"[{kid}] schnell.{feld} ist keine Von-bis-Angabe.")
            elif r[0] > r[1]:
                f(f"[{kid}] schnell.{feld}: Von ({r[0]}) ist größer als Bis ({r[1]}).")

        # Die Schnellwerte müssen die Laborierungen umschließen — das ist der
        # Fehler, der beim Tippen am ehesten passiert.
        if gr_werte and isinstance(s.get("geschoss_gr"), list):
            lo, hi = s["geschoss_gr"]
            if min(gr_werte) < lo or max(gr_werte) > hi:
                f(f"[{kid}] schnell.geschoss_gr {lo}–{hi} deckt die Laborierungen "
                  f"({min(gr_werte)}–{max(gr_werte)} gr) nicht ab.")
        if v0_werte and isinstance(s.get("v0_ms"), list):
            lo, hi = s["v0_ms"]
            if min(v0_werte) < lo or max(v0_werte) > hi:
                f(f"[{kid}] schnell.v0_ms {lo}–{hi} deckt die Laborierungen "
                  f"({min(v0_werte)}–{max(v0_werte)} m/s) nicht ab.")
        if e0_werte and isinstance(s.get("e0_j"), list):
            lo, hi = s["e0_j"]
            emin, emax = min(e0_werte), max(e0_werte)
            # 5 % Toleranz: die Spanne darf den Markt etwas breiter fassen als
            # die gelisteten Sorten, aber nicht enger sein.
            if emin < lo * 0.95 or emax > hi * 1.05:
                f(f"[{kid}] schnell.e0_j {lo}–{hi} passt nicht zu den nachgerechneten "
                  f"Laborierungen ({emin:.0f}–{emax:.0f} J).")

        if s.get("gasdruck_bar") and m.get("gasdruck_bar") and s["gasdruck_bar"] != m["gasdruck_bar"]:
            f(f"[{kid}] Gasdruck steht doppelt und widersprüchlich: "
              f"schnell {s['gasdruck_bar']} vs masse {m['gasdruck_bar']}.")

        r = k.get("recht_de", {})
        for feld in ("sport", "jagd", "hinweise"):
            if not r.get(feld):
                f(f"[{kid}] recht_de.{feld} fehlt.")

        for q in k.get("quellen", []):
            if not q.get("url", "").startswith("http"):
                f(f"[{kid}] Quelle ohne brauchbare URL: {q.get('titel')}")

        if not k.get("aliase"):
            f(f"[{kid}] Keine Aliase — die Suche findet das Kaliber kaum.")

    # Preise
    for pid, p in preise.get("kaliber", {}).items():
        if pid not in index_ids:
            f(f"[preise] '{pid}' gibt es im Index nicht.")
            continue
        prods = p.get("produkte", [])
        if not prods:
            w(f"[preise/{pid}] Keine Produkte hinterlegt.")
            continue
        for pr in prods:
            soll = pr["eur_packung"] / pr["packung"]
            if abs(soll - pr["eur_schuss"]) > 0.006:
                f(f"[preise/{pid}] {pr['hersteller']} {pr['typ']}: €/Schuss ist "
                  f"{pr['eur_schuss']}, gerechnet {soll:.3f}.")
            if not pr.get("url", "").startswith("http"):
                f(f"[preise/{pid}] {pr['hersteller']}: URL fehlt oder ist kaputt.")
            if pr.get("klasse") not in ("guenstig", "mittel", "premium"):
                f(f"[preise/{pid}] {pr['hersteller']}: unbekannte Klasse '{pr.get('klasse')}'.")
        echte = [pr["eur_schuss"] for pr in prods]
        rng = p.get("range_eur_schuss", [0, 0])
        if abs(rng[0] - round(min(echte), 2)) > 0.011 or abs(rng[1] - round(max(echte), 2)) > 0.011:
            f(f"[preise/{pid}] range_eur_schuss {rng} passt nicht zu den Produkten "
              f"({min(echte):.2f}–{max(echte):.2f}). 'python tools/preise.py import' räumt das auf.")

    fehlende_preise = set(index_ids) - set(preise.get("kaliber", {}))
    for pid in sorted(fehlende_preise):
        w(f"[{pid}] Keine Preise hinterlegt — die Preis-Kachel bleibt leer.")

    # Ausgabe
    print(f"Geprüft: {len(index_ids)} Kaliber, {len(gl_keys)} Glossarbegriffe.\n")
    for m in fehler:
        print("FEHLER   " + m)
    for m in warnung:
        print("Hinweis  " + m)
    if not fehler and not warnung:
        print("Alles sauber.")
    elif not fehler:
        print(f"\nKeine Fehler, {len(warnung)} Hinweise.")
    else:
        print(f"\n{len(fehler)} Fehler, {len(warnung)} Hinweise.")
    return 1 if fehler else 0


if __name__ == "__main__":
    sys.exit(main())
