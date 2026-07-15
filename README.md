# KALIBER — Munitions-Kompendium

Nachschlagewerk für Munition als installierbare Web-App (PWA). Läuft auf jedem
Samsung-Handy, ohne Store, ohne Sideloading, offline.

**Stand:** 24 Kaliber, vollständig. 385 KB gesamt.

---

## 1. Ausprobieren

```
python kaliber-kompendium/tools/devserver.py
```

Dann `http://localhost:8731` öffnen.

> **Nicht per Doppelklick auf `index.html` öffnen.** Der Browser blockiert dann
> aus Sicherheitsgründen das Laden der JSON-Dateien (CORS bei `file://`), und die
> App bleibt leer. Es braucht immer einen Server.

Warum nicht `python -m http.server`? Der sendet keine Cache-Header, woraufhin der
Browser nach eigenem Gutdünken cacht — man ändert `app.js`, lädt neu und bekommt
trotzdem die alte Version. Das hat hier schon eine Fehlersuche an der falschen
Stelle ausgelöst. `tools/devserver.py` ist derselbe Server mit
`Cache-Control: no-store`.

> **Beim Entwickeln den Service Worker abmelden.** Auch mit `no-store` liefert ein
> installierter Service Worker die App-Hülle aus seinem eigenen Cache. In den
> DevTools unter Application → Service Workers abmelden, oder in der Konsole:
> ```js
> for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
> for (const k of await caches.keys()) await caches.delete(k);
> location.reload();
> ```

## 2. Auf dem Handy installieren

Sobald die App unter einer `https://`-Adresse liegt (siehe Abschnitt 5):

1. Adresse in Chrome oder Samsung Internet öffnen
2. Menü (⋮) → **„App installieren"** bzw. **„Zum Startbildschirm hinzufügen"**
3. Fertig — eigenes Icon, Vollbild, kein Browser-Rahmen

Ab dann funktioniert alles offline. Weitergeben = Link schicken.

> HTTPS ist Pflicht. Über `http://` (außer `localhost`) verweigert der Browser den
> Service Worker — dann gibt es weder Installation noch Offline-Betrieb. Über die
> LAN-Adresse (`http://192.168.x.x:8731`) lässt sich die App ansehen, aber nicht
> installieren.

## 3. Aufbau

```
index.html              Grundgerüst + Glossar-Dialog
app.css                 Gestaltung (dunkel, Messing-Akzent)
app.js                  Router, Suche, Kapitel, Patronenzeichnung, Schießbuch
ballistik.js            Flugbahnrechner (G1/G7, RK4-Integration)
sw.js                   Service Worker — Offline-Betrieb
manifest.webmanifest    App-Metadaten für die Installation
icons/icon.svg          App-Icon
data/
  index.json            Suchindex (beim Start geladen, 11 KB)
  glossar.json          Begriffserklärungen (beim Start geladen, 13 KB)
  preise.json           Preise — getrennt gepflegt (beim Start geladen, 57 KB)
  kaliber/<id>.json     Ein Datensatz je Kaliber (erst beim Öffnen geladen, ~10 KB)
tools/
  devserver.py          Testserver ohne Cache
  preise.py             Preispflege über CSV
  pruefe.py             Datenbank-Validierung
```

Bewusst **kein** Build-System, kein npm, keine Abhängigkeiten. Reines HTML, CSS und
JavaScript. Das läuft in fünf Jahren noch, und jede Datei lässt sich direkt lesen
und ändern.

Die Kaliberdaten werden erst geladen, wenn man das Kaliber öffnet. Der Start bleibt
dadurch bei rund 81 KB, egal wie viele Kaliber dazukommen.

## 4. Vor jedem Ausliefern

```
python tools/pruefe.py
```

Prüft die Datenbank auf Vollständigkeit und **innere Widersprüche**: fehlende
Felder, Kaliber ohne Datei, Aliase die zwischen Kalibern kollidieren, unmögliche
Geometrie (Hals dicker als Boden, Hülse länger als die Patrone), Grain-Gramm-
Umrechnung, BC außerhalb des Plausiblen, kaputte Preisverweise.

Vor allem: **Die Mündungsenergie wird aus Geschossgewicht und v₀ nachgerechnet und
gegen die angegebene Spanne geprüft.** Genau diese Art Fehler sieht man beim Tippen
nicht — der Prüfer hat beim Aufbau der Datenbank zwei davon gefunden (bei `.223 Rem`
und `6 mm ARC` deckten die Energiespannen die leichten Geschosse nicht ab).

## 5. Hosting (GitHub Pages)

```
git init && git add . && git commit -m "Kaliber-Kompendium"
gh repo create kaliber-kompendium --public --source=. --push
```

Dann auf GitHub: **Settings → Pages → Source: Deploy from branch → main / (root)**.
Nach ein bis zwei Minuten liegt die App unter
`https://<benutzername>.github.io/kaliber-kompendium/`.

> Für GitHub Pages aus einem **privaten** Repo braucht es GitHub Pro. Mit einem
> kostenlosen Konto muss das Repo öffentlich sein — die Adresse ist dann zwar nicht
> verlinkt und praktisch nicht auffindbar, aber technisch erreichbar. Wer das nicht
> will: Cloudflare Pages kann dasselbe kostenlos aus einem privaten Repo.

### Beim Ausliefern einer neuen App-Version: VERSION hochzählen

In `sw.js`:

```js
const VERSION = 'v2';   // -> 'v3' bei der nächsten Änderung an der App-Hülle
```

**Das ist nicht optional.** Der Service Worker liefert die App-Hülle cache-first
aus. Bleibt VERSION gleich, installiert er sich nie neu, und die Nutzer bekommen
dauerhaft die alte Version serviert — auch wenn auf dem Server längst neue Dateien
liegen. Genau das ist hier während der Entwicklung passiert.

Nur Daten geändert (`data/*.json`)? Dann reicht der **„Daten aktualisieren"**-Knopf
in der App, VERSION muss nicht hoch. Die Daten laufen network-first.

## 6. Preise aktualisieren

Die Preise sind bewusst von den Kaliberdaten getrennt. Sie altern schnell, alles
andere praktisch nie.

```
python tools/preise.py export      # -> preise_bearbeiten.csv
```

CSV in Excel öffnen, Spalte `eur_packung` anpassen, als CSV speichern (Semikolon als
Trennzeichen beibehalten).

```
python tools/preise.py import      # -> zurück nach data/preise.json
```

Der Import rechnet €/Schuss und die Von-bis-Spanne je Kaliber automatisch neu,
sortiert nach Preis und setzt das Standdatum. Danach hochladen:

```
git add data/preise.json && git commit -m "Preise Juli" && git push
```

In der App unten auf **„Daten aktualisieren"** tippen. Einmal im Monat reicht.

**Warum kein automatischer Scraper?** Shop-Preise automatisch abzugreifen ist
rechtlich heikel, technisch fragil (Botschutz, ständig wechselndes HTML) und müsste
je Händler einzeln gebaut und dauernd repariert werden. Für ein Feld, das auch zwei
Wochen alt sein darf, lohnt das nicht.

## 7. Ein Kaliber hinzufügen

1. `data/kaliber/<id>.json` anlegen — `300blk.json` kopieren und überschreiben
2. Eintrag in `data/index.json` ergänzen (`id`, `name`, `aliase`, `gruppen`, `kurz`)
3. Preisblock in `data/preise.json` ergänzen
4. `python tools/pruefe.py` laufen lassen

Index und Datei müssen bei `id`, `name`, `gruppen` übereinstimmen — der Prüfer
besteht darauf.

## 8. Die Suche

Bewertet jeden Kandidaten gegen Name, Aliase und optional `suchbegriffe`:

| Was | Punkte |
|---|---|
| Volltreffer | 100 |
| Wort-Volltreffer („luger“) | 92 |
| Wortanfang | 85 / 78 |
| Teilstring | 70 |
| Tippfehler (Levenshtein) | 35–52 |

Ab **75** ein Treffer, **35–74** ein Vorschlag („Meintest du …?“). Die Schwelle
liegt bewusst über der Teilstring-Bewertung: `9x29mmR` enthält die Zeichenfolge
`9mm` rein zufällig über die Zifferngrenze hinweg — das ist einen Vorschlag wert,
aber keinen Treffer.

Zwei Normalisierungen: einmal alles außer Buchstaben und Ziffern weg, einmal
zusätzlich ohne `mm`. Sonst findet `5,56mm` die Alias `5,56x45` nicht. Die
zweite Variante greift nur, wenn davon mindestens drei Zeichen übrig bleiben —
aus `9mm` würde sonst eine blanke `9`, und die steckt in fast jeder Bezeichnung.

Die `aliase` steuern die Suche. Dort gehört jede Schreibweise hinein, nach der
jemand suchen könnte.

## 9. Der Ballistikrechner

`ballistik.js` rechnet die Flugbahn numerisch (Runge-Kutta 4. Ordnung) mit den
Standard-Widerstandstabellen G1 und G7 — es wird nicht aus fertigen Tabellen
interpoliert. Grundgleichung:

```
a = (π/8) · ρ · v² · Cd_std(Mach) / BC_si
```

Der Abgangswinkel für die Einschussentfernung wird per Sekantenverfahren gelöst,
Windabdrift über den Verzögerungszeit-Ansatz `Drift = w · (t − x/v₀)`.

Gegengeprüft an Herstellerangaben (Abweichung jeweils unter 1 %):

| Laborierung | gerechnet | Katalog |
|---|---|---|
| .300 BLK 110 gr @ 730 m/s | 1899 J | 1908 J (Hornady, 1407 ft-lbs) |
| 9 mm 124 gr @ 350 m/s | 492 J | ~490 J (GECO) |
| .300 BLK 220 gr @ 305 m/s | 663 J | 662 J (Fiocchi, 488 ft-lbs) |

Rechenzeit für eine komplette Flugbahn auf 300 m: rund 4 ms.

Die Energiekurve blendet die Grenzwerte nach § 19 BJagdG ein — 1.000 J für Rehwild,
2.000 J für übriges Schalenwild —, aber nur, wenn die Patrone überhaupt in deren
Nähe kommt. Sonst streckt die 1.000-J-Linie den Maßstab einer 9 mm mit 490 J so
weit, dass deren eigene Kurve platt am Boden liegt.

Beide Diagramme markieren **25 m und 100 m** als Bezugslinien: die gängige
DSB-Kurzwaffendistanz und der Büchsen-Standard. Damit lässt sich auf einen Blick
sehen, ob der Haltepunkt auf beiden Distanzen passt.

## 10. Darstellung auf dem Handy

Zwei Fallstricke, die hier schon zugeschlagen haben:

- **`background-attachment: fixed`** erzwingt auf Mobilgeräten ein Neuzeichnen bei
  jedem Scrollpixel und wird von manchen Android-Browsern ignoriert. Der Raster-
  Hintergrund liegt deshalb in einer fixierten `body::before`-Ebene.
- **Zu breite SVG-viewBox.** Bei viewBox 700 schrumpft die Achsenbeschriftung auf
  einem 375-px-Handy auf 4,5 px — unlesbar. Die Diagramme nutzen 340×214
  (Skalierung ≈ 0,93), begrenzt durch `max-width: 520px` auf `.chart`.

Breite Tabellen scrollen in ihrem eigenen Container (`.tw`), die Seite selbst nie
seitlich. Geprüft: `scrollWidth - clientWidth === 0` auf allen 24 Kalibern.

## 11. Beschussbilder

Die Präzisionsdaten trägt der Nutzer selbst ein. Sie liegen ausschließlich lokal im
`localStorage` des Geräts — nichts wird hochgeladen, nichts synchronisiert.

Das ist Absicht: Veröffentlichte Testtabellen (etwa aus dem *Caliber*-Magazin) sind
fremdes Material und als Sammlung durch das Datenbankherstellerrecht geschützt.
Und praktisch sind eigene Werte ohnehin aussagekräftiger — Streukreise hängen an
Waffe, Lauf und Schütze, nicht nur an der Patrone.

Über **„Exportieren"** lassen sich die Einträge als JSON sichern.

> `localStorage` hängt am Browser. Wer die App deinstalliert oder die Browserdaten
> löscht, verliert die Einträge. Vor einem Handywechsel exportieren.

## 12. Bilder und Rechte

- **Patronenzeichnungen** werden aus den hinterlegten C.I.P.-Maßen live als SVG
  gezeichnet (`zeichnePatrone()` in `app.js`) — kein fremdes Material, maßstäblich,
  skaliert verlustfrei, wiegt nichts.
- **Ballistische Diagramme** werden aus den Daten gerechnet und gezeichnet.
- **Produktbilder der Hersteller** werden bewusst **nicht** eingebettet, sondern
  über einen Link zum Händler erreichbar gemacht. Rechtlich sauber und praktisch
  besser: Dort steht auch der tagesaktuelle Preis.
- Ergänzende Fotos sollen von **Wikimedia Commons** kommen (frei lizenziert, mit
  Quellen- und Autorenangabe im Feld `quellen`).

## 13. Was bewusst fehlt

- **Konkrete Ladedaten.** Abgeschriebene Ladungsgewichte ohne Bezug auf die eigene
  Charge und Waffe sind ein echtes Sicherheitsrisiko. Die App nennt bewährte
  Pulversorten und verlinkt die kostenlosen Originaldaten von Vihtavuori und
  Hodgdon — die gelten für das Los, das man in der Hand hält.
- **Waffenzuordnung.** Die Kandidatenlisten wären endlos und schnell veraltet.
  Stattdessen steht der Drall in den Basisdaten — das ist die Angabe, die
  tatsächlich entscheidet, welche Geschossgewichte funktionieren.

## 14. Ressourcen

| | |
|---|---|
| App-Hülle (HTML/CSS/JS/Icon) | 73 KB |
| Startdaten (Index + Glossar + Preise) | 81 KB |
| 24 Kaliberdatensätze | 232 KB |
| **Gesamt** | **386 KB** |
| Offline-Cache gemessen (alles geladen) | 489 KB |
| Beim Start geladen | ~154 KB |

Zum Vergleich: ein einzelnes Handyfoto ist meist größer als die gesamte App.

Offline-Betrieb ist geprüft — bei gestopptem Server laufen Kaliberseiten, Suche,
Ballistikrechner und Glossar vollständig aus dem Cache.

## 15. Rechtlicher Hinweis

Die Angaben zu Waffen- und Jagdrecht sind eine Zusammenfassung nach bestem Wissen
und **keine Rechtsberatung**. Jagdrecht ist in Deutschland Landesrecht und ändert
sich. Im Zweifel gilt das Landesjagdgesetz und die Auskunft der unteren
Jagdbehörde.

Besonders zu beachten: Das Mindestkaliber von 6,5 mm für übriges Schalenwild
schließt mehrere beliebte Kaliber aus, die energetisch reichen würden — `.243 Win`
(6,20 mm), `6 mm ARC` (6,17 mm), `.223 Rem` und `.224 Valkyrie` (5,70 mm). Das ist
der häufigste Irrtum in diesem Bereich und in den jeweiligen Datensätzen als
Warnung hinterlegt.
