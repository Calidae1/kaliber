#!/usr/bin/env python3
"""Erzeugt die PNG-App-Symbole aus icons/icon.svg.

    python tools/icons.py

Schreibt icons/icon-192.png, icons/icon-512.png und icons/icon-maskable.png.

Warum überhaupt PNG, wo doch ein SVG vorliegt? Weil sich nicht darauf verlassen
lässt: iOS Safari und mehrere Android-Launcher ignorieren SVG-Symbole im
Manifest, und Chromium scheitert an einem SVG mit sizes="any" sogar komplett
bei der Installation. Ohne PNG in 192 und 512 bietet der Browser also gar kein
"Installieren" an — und genau das ist der Kern dieser App.

Warum eigener Rasterer? Auf diesem Rechner ist keine Bildbibliothek vorhanden
(kein Pillow, kein cairosvg), und für drei Symbole lohnt keine Abhängigkeit.
Hier reicht die Standardbibliothek: zlib schreibt das PNG, der Rest ist Geometrie.
Deshalb wird die Zeichnung hier nachgebaut statt das SVG geparst — die Form ist
einfach genug, und so bleibt das Werkzeug ohne jede Installation lauffähig.

Bei Änderungen am Symbol: erst icons/icon.svg anpassen, dann hier nachziehen und
das Skript laufen lassen. Anschließend VERSION in sw.js hochzählen.
"""

import math
import struct
import sys
import zlib
from pathlib import Path

WURZEL = Path(__file__).resolve().parent.parent
ZIEL = WURZEL / "icons"

# --- Farben (identisch zu icons/icon.svg) ---
BG = (0x0B, 0x0E, 0x13)
GITTER = (0x14, 0x1A, 0x24)
MESSING = (0xD4, 0xA2, 0x4C)
GESCHOSS = (0xA0, 0x70, 0x4A)
KANTE = (0x2A, 0x1F, 0x0D)

# --- Geometrie im 512er-Raster, Patrone senkrecht, Spitze oben ---
CX = 256.0
HALB = 36.0          # halbe Hülsenbreite
SPITZE_Y = 96.0      # Geschossspitze
OGIVE_L = 104.0      # Länge der Ogive
MUND_Y = SPITZE_Y + OGIVE_L   # Hülsenmund = Ende der Ogive
BODEN_Y = 424.0
RILLE_O, RILLE_U = 384.0, 404.0   # Auszieherrille
RILLE_HALB = 30.0
ECKRADIUS = 112.0

# Tangentiale Ogive: R aus Basisradius und Länge
OG_R = (HALB * HALB + OGIVE_L * OGIVE_L) / (2.0 * HALB)


def ogive_halb(y: float) -> float:
    """Halbe Geschossbreite auf Höhe y. Außerhalb der Ogive: -1."""
    if y < SPITZE_Y or y > MUND_Y:
        return -1.0
    x = y - SPITZE_Y
    wurzel = OG_R * OG_R - (OGIVE_L - x) ** 2
    if wurzel <= 0:
        return 0.0
    return math.sqrt(wurzel) + HALB - OG_R


def zylinder_faktor(u: float) -> float:
    """Helligkeit über die Breite (u von -1 links bis +1 rechts).

    Bildet einen runden Metallkörper nach: Glanzlicht links der Mitte, zu beiden
    Rändern hin abfallend. Ohne das wirkt die Patrone wie ein flacher Aufkleber.
    """
    stuetzen = [(-1.0, 0.32), (-0.35, 1.30), (0.15, 1.02), (0.60, 0.72), (1.0, 0.28)]
    if u <= stuetzen[0][0]:
        return stuetzen[0][1]
    if u >= stuetzen[-1][0]:
        return stuetzen[-1][1]
    for i in range(len(stuetzen) - 1):
        u0, f0 = stuetzen[i]
        u1, f1 = stuetzen[i + 1]
        if u0 <= u <= u1:
            t = (u - u0) / (u1 - u0)
            return f0 + (f1 - f0) * t
    return 1.0


def toene(farbe, faktor):
    return tuple(max(0, min(255, int(k * faktor + 0.5))) for k in farbe)


def in_rundrect(x, y, w, h, r):
    if r <= 0:
        return True
    if r <= x <= w - r or r <= y <= h - r:
        return 0 <= x <= w and 0 <= y <= h
    ex = min(max(x, r), w - r)
    ey = min(max(y, r), h - r)
    return (x - ex) ** 2 + (y - ey) ** 2 <= r * r


def probe(x, y, skala, versatz, eckradius):
    """Farbe + Deckung eines Punktes im Zielbild. None = außerhalb (transparent)."""
    if not in_rundrect(x, y, 512.0, 512.0, eckradius):
        return None

    # Zurück in den Entwurfsraum rechnen (für die Maskable-Variante verkleinert)
    dx = (x - 256.0) / skala + 256.0
    dy = (y - 256.0) / skala + 256.0 - versatz

    farbe = BG
    # Technisches Raster
    if (abs(dx % 64.0) < 1.6 / skala) or (abs(dy % 64.0) < 1.6 / skala):
        farbe = GITTER

    breite = -1.0
    ist_geschoss = False
    if SPITZE_Y <= dy <= MUND_Y:
        breite = ogive_halb(dy)
        ist_geschoss = True
    elif MUND_Y < dy <= BODEN_Y:
        breite = RILLE_HALB if RILLE_O <= dy <= RILLE_U else HALB

    if breite > 0:
        adx = abs(dx - CX)
        if adx <= breite:
            u = (dx - CX) / breite
            basis = GESCHOSS if ist_geschoss else MESSING
            farbe = toene(basis, zylinder_faktor(u))
            # Umriss und Trennlinie am Hülsenmund andeuten
            if adx > breite - 2.2 / skala or abs(dy - MUND_Y) < 1.4 / skala:
                farbe = KANTE
    return farbe


def rendere(groesse: int, maskable: bool) -> bytes:
    ss = 3                      # 3x3 Unterabtastung — glatte Kanten ohne Bibliothek
    # Maskable: Android beschneidet bis auf einen Kreis von 80 % Durchmesser
    # (Radius 205 px). Die Patrone ist 340 px hoch, bei 0,8 also 136 px halbe Höhe
    # — bequem innerhalb. Kleiner als nötig lässt das Symbol nur verloren wirken.
    skala = 0.8 if maskable else 1.0
    versatz = 0.0
    eck = 0.0 if maskable else ECKRADIUS
    schritt = 512.0 / (groesse * ss)
    reihen = []
    for py in range(groesse):
        reihe = bytearray()
        for px in range(groesse):
            r = g = b = a = 0
            for sy in range(ss):
                for sx in range(ss):
                    x = (px * ss + sx + 0.5) * schritt
                    y = (py * ss + sy + 0.5) * schritt
                    f = probe(x, y, skala, versatz, eck)
                    if f is None:
                        continue
                    r += f[0]; g += f[1]; b += f[2]; a += 255
            n = ss * ss
            if a == 0:
                reihe += b"\x00\x00\x00\x00"
            else:
                treffer = a // 255
                reihe += bytes((r // treffer, g // treffer, b // treffer, a // n))
        reihen.append(reihe)
    return png(groesse, groesse, reihen)


def png(w: int, h: int, reihen) -> bytes:
    roh = b"".join(b"\x00" + bytes(r) for r in reihen)

    def block(typ, daten):
        return (struct.pack(">I", len(daten)) + typ + daten
                + struct.pack(">I", zlib.crc32(typ + daten) & 0xFFFFFFFF))

    return (b"\x89PNG\r\n\x1a\n"
            + block(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0))
            + block(b"IDAT", zlib.compress(roh, 9))
            + block(b"IEND", b""))


def main() -> None:
    auftrag = [("icon-192.png", 192, False), ("icon-512.png", 512, False),
               ("icon-maskable.png", 512, True)]
    for name, groesse, maskable in auftrag:
        sys.stdout.write(f"  {name} ({groesse}px{', maskable' if maskable else ''}) … ")
        sys.stdout.flush()
        daten = rendere(groesse, maskable)
        (ZIEL / name).write_bytes(daten)
        print(f"{len(daten) / 1024:.1f} KB")
    print("\nFertig. Danach VERSION in sw.js hochzählen.")


if __name__ == "__main__":
    main()
