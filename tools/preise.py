#!/usr/bin/env python3
"""Preispflege für das Kaliber-Kompendium.

Die Preise liegen in data/preise.json und werden getrennt von den Kaliberdaten
gepflegt. Dieses Skript macht daraus eine CSV, die sich in Excel oder LibreOffice
bequem bearbeiten lässt, und schreibt sie hinterher wieder zurück.

    python tools/preise.py export      -> preise_bearbeiten.csv anlegen
    (CSV in Excel öffnen, Preise anpassen, als CSV speichern)
    python tools/preise.py import      -> zurück nach data/preise.json

Beim Import werden €/Schuss und die Von-bis-Spanne je Kaliber automatisch neu
gerechnet und das Standdatum gesetzt. Danach die geänderte preise.json hochladen
(git push oder per Weboberfläche) — die App zieht sie beim nächsten "Daten
aktualisieren".

Warum kein Scraper: Shop-Preise automatisch abzugreifen ist rechtlich heikel,
technisch fragil (Botschutz, wechselndes HTML) und müsste je Händler einzeln
gebaut und dauernd nachgezogen werden. Für ein Feld, das laut Anforderung auch
zwei Wochen alt sein darf, steht das in keinem Verhältnis. Der CSV-Weg dauert
einmal im Monat ein paar Minuten und geht nie kaputt.
"""

import csv
import json
import sys
from datetime import date
from pathlib import Path

WURZEL = Path(__file__).resolve().parent.parent
PREISE = WURZEL / "data" / "preise.json"
CSV_DATEI = WURZEL / "preise_bearbeiten.csv"

SPALTEN = [
    "kaliber", "hersteller", "typ", "packung",
    "eur_packung", "klasse", "haendler", "url",
]


def lade() -> dict:
    with PREISE.open(encoding="utf-8") as f:
        return json.load(f)


def export() -> None:
    daten = lade()
    zeilen = []
    for kal_id, kal in daten["kaliber"].items():
        for p in kal["produkte"]:
            zeilen.append({
                "kaliber": kal_id,
                "hersteller": p["hersteller"],
                "typ": p["typ"],
                "packung": p["packung"],
                "eur_packung": f'{p["eur_packung"]:.2f}'.replace(".", ","),
                "klasse": p["klasse"],
                "haendler": p["haendler"],
                "url": p["url"],
            })

    # utf-8-sig, damit Excel die Umlaute erkennt; Semikolon als deutsches Trennzeichen
    with CSV_DATEI.open("w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=SPALTEN, delimiter=";")
        w.writeheader()
        w.writerows(zeilen)

    print(f"{len(zeilen)} Produkte exportiert nach:\n  {CSV_DATEI}")
    print("\nJetzt in Excel öffnen, Spalte 'eur_packung' anpassen, als CSV speichern.")
    print("Danach:  python tools/preise.py import")


def _zahl(s: str) -> float:
    return float(str(s).strip().replace("€", "").replace(",", ".").strip())


def importieren() -> None:
    if not CSV_DATEI.exists():
        sys.exit(f"Keine CSV gefunden: {CSV_DATEI}\nErst 'python tools/preise.py export' laufen lassen.")

    daten = lade()
    neu: dict[str, list] = {}

    with CSV_DATEI.open(encoding="utf-8-sig", newline="") as f:
        for i, r in enumerate(csv.DictReader(f, delimiter=";"), start=2):
            kal = (r.get("kaliber") or "").strip()
            if not kal:
                continue
            if kal not in daten["kaliber"]:
                sys.exit(f"Zeile {i}: Kaliber '{kal}' steht nicht in preise.json.")
            try:
                packung = int(_zahl(r["packung"]))
                eur_packung = _zahl(r["eur_packung"])
            except (ValueError, KeyError) as e:
                sys.exit(f"Zeile {i}: Zahl nicht lesbar ({e}). Erwartet z. B. 14,50")
            if packung <= 0:
                sys.exit(f"Zeile {i}: Packungsgröße muss größer als 0 sein.")

            neu.setdefault(kal, []).append({
                "hersteller": r["hersteller"].strip(),
                "typ": r["typ"].strip(),
                "packung": packung,
                "eur_packung": round(eur_packung, 2),
                "eur_schuss": round(eur_packung / packung, 3),
                "klasse": (r.get("klasse") or "mittel").strip(),
                "haendler": (r.get("haendler") or "").strip(),
                "url": (r.get("url") or "").strip(),
            })

    for kal_id, produkte in neu.items():
        produkte.sort(key=lambda p: p["eur_schuss"])
        preise = [p["eur_schuss"] for p in produkte]
        eintrag = daten["kaliber"][kal_id]
        eintrag["produkte"] = produkte
        # Spanne bewusst leicht gerundet — es sind Richtwerte, keine Tagespreise
        eintrag["range_eur_schuss"] = [
            round(min(preise), 2) if min(preise) < 1 else round(min(preise), 2),
            round(max(preise), 2),
        ]

    daten["stand"] = date.today().isoformat()
    daten["quelle"] = "Manuell gepflegt via tools/preise.py"

    with PREISE.open("w", encoding="utf-8", newline="\n") as f:
        json.dump(daten, f, ensure_ascii=False, indent=2)
        f.write("\n")

    gesamt = sum(len(p) for p in neu.values())
    print(f"{gesamt} Produkte in {len(neu)} Kalibern zurückgeschrieben.")
    print(f"Standdatum gesetzt auf {daten['stand']}.")
    for kal_id, produkte in neu.items():
        r = daten["kaliber"][kal_id]["range_eur_schuss"]
        print(f"  {kal_id:10s} {len(produkte):2d} Produkte   {r[0]:.2f}–{r[1]:.2f} €/Schuss")
    print("\nJetzt hochladen, damit die App die neuen Preise sieht.")


if __name__ == "__main__":
    befehl = sys.argv[1] if len(sys.argv) > 1 else ""
    if befehl == "export":
        export()
    elif befehl in ("import", "importieren"):
        importieren()
    else:
        print(__doc__)
        sys.exit(1)
