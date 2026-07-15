#!/usr/bin/env python3
"""Trägt das Feld "form" in Laborierungen und Preisprodukte ein.

    python tools/formen.py --pruefen    zeigt nur, was passieren würde
    python tools/formen.py --schreiben  schreibt in data/

Die Geschossform steuert in der App drei Dinge: die Patronenzeichnung, den
Inhalt des "erhältlich in"-Menüs und die Filterung von Laborierungstabelle,
Ballistikrechner und Preisübersicht.

Abgeleitet wird sie aus dem vorhandenen typ-Text. Das ist bewusst nur ein
Einmal-Werkzeug für den Bestand: Neue Datensätze bekommen "form" direkt von Hand
mit, damit sich niemand auf die Rateregeln unten verlässt. Der Prüfer besteht
darauf (tools/pruefe.py).

Reihenfolge der Regeln ist entscheidend — spezifischer zuerst, sonst schluckt
"Wadcutter" den "Semi-Wadcutter" und "SP" den "TTSX".
"""

import argparse
import io
import json
import re
from pathlib import Path

WURZEL = Path(__file__).resolve().parent.parent
DATA = WURZEL / "data"

# form -> Anzeigename. Die Einteilung folgt den Regalkategorien im deutschen
# Fachhandel — so denkt der Nutzer — und liefert zugleich für jede Form eine
# eigene, erkennbar andere Zeichnung.
FORMEN = {
    "wadcutter":        "Wadcutter",
    "semiwadcutter":    "Semi-Wadcutter",
    "blei":             "Bleigeschoss",
    "vollmantel":       "Vollmantel",
    "teilmantel":       "Teilmantel",
    "kunststoffspitze": "Kunststoffspitze",
    "hohlspitz":        "Hohlspitz",
    "match":            "Match HPBT",
    "bleifrei":         "Bleifrei",
}

# Reihenfolge ist entscheidend: spezifischer zuerst.
REGELN = [
    ("semiwadcutter", r"semi.?wadcutter|\bSWC\b|\bLSWC\b|\bSJSP\b"),
    ("wadcutter",     r"wadcutter|\bWC\b"),
    # Vollkupfer zuerst — sonst greift bei "TAC-TX" die SP-Regel
    ("bleifrei",      r"bleifrei|TTSX|\bTSX\b|\bLRX\b|TAC-TX|\bHIT\b|VOR-TX|Monolith|Vollkupfer"),
    # Kunststoffspitze vor Match und Teilmantel: "ELD Match" und "ELD-X" tragen
    # beide eine Polymerspitze und sehen entsprechend gleich aus — anders als ein
    # klassisches HPBT-Matchgeschoss oder ein Teilmantel mit freiliegendem Blei.
    ("kunststoffspitze", r"V-MAX|ELD-X|ELD Match|ELD-VT|\bSST\b|Evolution|Ballistic Tip|"
                         r"A-MAX|SUB-X|Polymer|Kunststoffspitze|Tipped"),
    ("match",         r"match|MatchKing|Scenar|BTHP|HPBT|Golden Target|Gold Medal|\bSMK\b"),
    ("hohlspitz",     r"hohlspitz|\bJHP\b|\bXTP\b|\bHST\b|Hydra-Shok|V-Crown|\bHP\b"),
    ("teilmantel",    r"teilmantel|\bSP\b|Power-Point|Power-Shok|Oryx|Partition|"
                      r"\bMega\b|Doppelkern|\bKS\b|UNI Classic|Fusion|\bDK\b"),
    # "Rundkopf" allein reicht NICHT als Blei-Merkmal: "Vollmantel Rundkopf" und
    # "Teilmantel Rundkopf" beschreiben nur die Kopfform, nicht das Material.
    # Darauf hereinzufallen kostete .32 S&W long seine Vollmantel-Kategorie.
    ("blei",          r"bleigeschoss|\bblei\b|\bLRN\b|Hartblei|\bWFN\b|\bLSWC\b"),
    ("vollmantel",    r"vollmantel|\bFMJ\b|\bTMJ\b|Lawman|\bRange\b"),
]


def rate(text: str):
    for name, muster in REGELN:
        if re.search(muster, text, re.I):
            return name
    return None


def lade(p: Path):
    with io.open(p, encoding="utf-8") as f:
        return json.load(f)


def speichere(p: Path, d) -> None:
    with io.open(p, "w", encoding="utf-8", newline="\n") as f:
        json.dump(d, f, ensure_ascii=False, indent=2)
        f.write("\n")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--schreiben", action="store_true")
    ap.add_argument("--pruefen", action="store_true")
    a = ap.parse_args()
    if not (a.schreiben or a.pruefen):
        ap.error("--pruefen oder --schreiben angeben")

    idx = lade(DATA / "index.json")
    preise = lade(DATA / "preise.json")
    offen, geaendert = [], 0

    for k in idx["kaliber"]:
        p = DATA / "kaliber" / f"{k['id']}.json"
        kd = lade(p)
        for l in kd["werte"]["laborierungen"]:
            f = rate(l["typ"])
            if f is None:
                offen.append(f"[{k['id']}] Laborierung {l['hersteller']} \"{l['typ']}\"")
                continue
            l["form"] = f
            geaendert += 1
        if a.schreiben:
            # form direkt hinter typ einsortieren, damit die Datei lesbar bleibt
            for l in kd["werte"]["laborierungen"]:
                if "form" in l:
                    wert = l.pop("form")
                    neu = {}
                    for schluessel, v in l.items():
                        neu[schluessel] = v
                        if schluessel == "typ":
                            neu["form"] = wert
                    l.clear()
                    l.update(neu)
            speichere(p, kd)

        for pr in preise["kaliber"][k["id"]]["produkte"]:
            f = rate(pr["typ"])
            if f is None:
                offen.append(f"[{k['id']}] Preis {pr['hersteller']} \"{pr['typ']}\"")
                continue
            pr["form"] = f
            geaendert += 1

    if a.schreiben:
        for kid, block in preise["kaliber"].items():
            for pr in block["produkte"]:
                if "form" in pr:
                    wert = pr.pop("form")
                    neu = {}
                    for schluessel, v in pr.items():
                        neu[schluessel] = v
                        if schluessel == "typ":
                            neu["form"] = wert
                    pr.clear()
                    pr.update(neu)
        speichere(DATA / "preise.json", preise)

    print(f"{geaendert} Datensätze mit form versehen.")
    if offen:
        print(f"\nNICHT ZUORDENBAR ({len(offen)}) — von Hand nachtragen:")
        for o in offen:
            print("  " + o)
        return 1
    print("Alle Datensätze zugeordnet.")
    if a.pruefen:
        print("\n(nur geprüft, nichts geschrieben — mit --schreiben übernehmen)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
