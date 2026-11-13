# StockRatio – Aktien-Screener

Webseite zum Sortieren und Filtern von rund **1.300 Aktien** (S&P 500, MSCI World und eigene Watchlist)
nach **KGV, Forward-KGV, PEG** und weiteren Kennzahlen – mit Analysten-Konsens, Kursziel-Potenzial,
Performance gegenüber dem S&P 500 und einem eigenen **StockRatio-Score** (0–100) samt Signal
(*Kaufkandidat · Positiv · Neutral · Negativ · Meiden*).

Die Daten kommen kostenlos von Yahoo Finance und werden **werktags automatisch** per GitHub Actions
aktualisiert und auf **GitHub Pages** veröffentlicht. Es gibt keinen Server und keine Kosten.

## Funktionen

| Bereich | Inhalt |
|---|---|
| **Bewertung** | KGV, Forward-KGV, PEG, KBV, KUV, EV/EBITDA, Free-Cashflow-Rendite, Dividendenrendite – farbig markiert im Vergleich zum Branchen-Median |
| **Qualität & Wachstum** | Eigenkapitalrendite, operative & Netto-Marge, Verschuldung, Umsatz- und Gewinnwachstum, erwartetes EPS-Wachstum |
| **Analysten** | Konsens (Starker Kauf … Verkaufen), Anteil Kaufempfehlungen, Verteilung, Kursziel und Potenzial, Gewinnrevisionen der letzten 90 Tage |
| **Momentum** | 52-Wochen-Performance, **Performance vs. S&P 500**, Abstand zur 200-Tage-Linie und zum 52-W-Hoch, Beta |
| **Score** | Gewichtete Kombination aus Bewertung (30 %), Analysten (25 %), Qualität (20 %), Wachstum (15 %), Momentum (10 %) |
| **Bedienung** | Suche, Schnellfilter („Günstig & stark“, „Wachstum zum fairen Preis“, „Value“, „Analysten-Lieblinge“, „Dividenden“, „Zu teuer – Vorsicht“), Detailfilter (Index, Land/Region, Sektor, KGV-/PEG-Grenzen …), sortierbare Spalten, vier Ansichten, Detailansicht mit Begründung, Favoriten ★, CSV-Export, teilbare Links (Filter stehen in der URL), Handy-tauglich, Dark Mode |

### So funktioniert der Score

1. Jede Kennzahl wird in ein **Perzentil** umgerechnet (100 = bester Wert aller Aktien).
2. Bewertungskennzahlen und Verschuldung werden zu 70 % **innerhalb der eigenen Branche** verglichen
   (ein KGV von 25 ist für Software günstig, für eine Bank teuer) und zu 30 % gegen alle Aktien.
3. Negative Gewinne (KGV „neg.“) zählen als teuerst mögliche Bewertung.
4. Der Analysten-Konsens wird bei wenigen Analysten Richtung „neutral“ gedämpft.
5. Die fünf Säulen werden gewichtet und das Ergebnis erneut in ein Perzentil umgerechnet:
   **Score 80 = attraktiver als 80 % aller Aktien im Screener.**
   Signal: ≥ 90 Kaufkandidat · ≥ 70 Positiv · ≥ 30 Neutral · ≥ 10 Negativ · darunter Meiden. ETFs erhalten keinen Score.

Der Score ist eine **relative, rein quantitative Einordnung** – keine Kursprognose und keine Anlageberatung.

## Einrichtung (einmalig)

1. **GitHub Pages aktivieren:** Repository → *Settings* → *Pages* → *Build and deployment* → Source: **GitHub Actions**.
2. **Workflow starten:** *Actions* → „Daten aktualisieren & Seite veröffentlichen“ → *Run workflow*.
   Nach ca. 3–5 Minuten ist die Seite erreichbar unter
   `https://<dein-github-name>.github.io/<repo-name>/` (der Link steht auch im Workflow-Lauf).
3. Danach läuft die Aktualisierung automatisch **Mo–Fr um 22:17 UTC** (nach US-Börsenschluss).

> Der Workflow veröffentlicht nur vom **Standard-Branch** des Repositories.

## Favoriten, Portfolio & Watchlist

- **Favoriten (★):** Mit dem Stern an jeder Aktie an- und abwählen; „★ Favoriten“ zeigt nur diese.
  Beim allerersten Besuch sind die Werte aus [`watchlist.txt`](watchlist.txt) vorausgewählt.
- **Mein Portfolio:** Eigene Positionen mit Wert (in € oder $) oder Stückzahl erfassen. Die Seite rechnet den
  Wert täglich mit den aktuellen Kursen hoch und zeigt Tagesänderung, Gewichtung, Ø Score und Performance
  vs. S&P 500. Anzeige umschaltbar zwischen **€ und $**.
- Favoriten und Portfolio werden **nur im Browser** gespeichert (nicht im Repository). Mit
  „Auf anderes Gerät übertragen“ entsteht ein Link, der beides auf ein anderes Gerät kopiert.
- **watchlist.txt** legt fest, welche Werte *zusätzlich* zu S&P 500 und MSCI World geladen werden
  (z. B. ETFs oder Nebenwerte). Nur geladene Werte können ins Portfolio aufgenommen werden.
  ETFs werden angezeigt (Kurs, Performance), erhalten aber keinen Score.

Ticker-Endungen: `.DE` Xetra · `.L` London · `.PA` Paris · `.AS` Amsterdam · `.SW` Schweiz ·
`.MI` Mailand · `.MC` Madrid · `.CO` Kopenhagen · `.ST` Stockholm · `.T` Tokio · `.HK` Hongkong ·
`.TO` Toronto · US-Aktien ohne Endung.

### Take Profit & Stop Loss im Portfolio

Im Portfolio erzeugt **„🎯 TP & SL generieren“** für jede Position ein Kursziel und eine Verlustgrenze (gleiche Methode
wie im Kaufplan, ausgehend vom aktuellen Kurs). Die Werte werden **festgehalten**, bis du sie neu generierst
(alle oder einzeln mit ↻), und zeigen den möglichen Gewinn/Verlust in €/$, Summen fürs ganze Portfolio und einen
Hinweis, sobald ein Ziel erreicht ist. „Liste kopieren“ liefert alle Werte als Text, z. B. zum Eintragen beim Broker.
Käufe aus dem Kaufplan übernehmen automatisch dessen TP/SL. Gespeichert getrennt vom Portfolio.

**Broker-Grenze:** Standard ist **Revolut** – Take Profits liegen dann höchstens **+45 %** über dem Kurs
(Revolut lehnt Verkaufs-Limits über 150 % des aktuellen Kurses ab; 5 % Puffer für Kursbewegungen bis zur Order).
Ältere, zu hohe Werte werden markiert und auf den erlaubten Wert angepasst. Umschaltbar auf „Ohne Broker-Grenze“.

## Kaufplan (+)

- Mit **+** an jeder Aktie (Tabelle, Karte, Detailansicht) landet sie im **Kaufplan** (Knopf oben rechts).
- Betrag in € eingeben → automatische Aufteilung: **Intelligent** (Gewicht ∝ Score², hohe Schwankung −max. 10 %,
  max. 40 % / min. 5 % je Position) oder **gleichmäßig**.
- Je Position **Take Profit** (Analysten-Kursziel, sonst Chance/Risiko 2,5 : 1), **Stop Loss** (8 % × Beta, 6–20 %)
  und Chance/Risiko-Verhältnis.
- **Gekauft / Auslassen** markieren. Beim ersten Markieren wird die Aufteilung **eingefroren** (❄) – ausgelassenes
  Geld bleibt uninvestiert, die übrigen Beträge verschieben sich nicht. „Auftauen“ verteilt den Rest neu.
- **OK** überträgt die gekauften Positionen ins Portfolio (bestehende Positionen werden ergänzt, nie überschrieben).

## Benachrichtigungen (🔔 oben rechts)

Einstellbar (jeweils an/aus):
- **Portfolio: starke Verschlechterung** – z. B. Analysten von „Kaufen“ auf „Verkaufen“ oder Signal fällt um zwei Stufen
- **Portfolio: deutliche Verbesserung** · **Favoriten mit überwachen**
- **Take Profit / Stop Loss erreicht** (für im Portfolio generierte Werte)
- **Markt: neue starke Kaufsignale** – Aktien außerhalb des Portfolios, die neu auf Score ≥ 90, Analysten „Kaufen“ und faire Bewertung steigen
- **Handelstage Mittwoch & Freitag** – morgens Übersicht über Portfolio, Warnungen, Top-Kaufsignale und Kaufplan

**So funktioniert es:** Der Workflow „Benachrichtigungen senden“ schickt Mo–Fr um 05:31 UTC (≈ 6:30 / 7:30 Uhr)
einen Web-Push ohne persönliche Daten. Der Service Worker auf dem Handy lädt die neuen Daten, vergleicht sie mit
dem letzten Stand und deinem Portfolio (das das Gerät nie verlässt) und zeigt nur relevante Hinweise.
Ohne Push-Einrichtung werden die Hinweise beim Öffnen der Seite angezeigt (Verlauf in den Einstellungen).

**Einmalige Einrichtung** (in der App unter 🔔 → „Push auch bei geschlossener App“):
1. „Benachrichtigungen aktivieren“ und erlauben
2. „🔑 Schlüssel erzeugen“ – das Schlüsselpaar entsteht auf dem Gerät; den privaten Schlüssel (wird nur einmal
   angezeigt) als Repository-Secret `VAPID_PRIVATE_KEY` speichern (Settings → Secrets and variables → Actions)
3. „Abo-Code kopieren“ → Secret `PUSH_SUBSCRIPTIONS` (mehrere Geräte als JSON-Liste; weitere Geräte über den
   „Übertragen“-Link einrichten, damit sie denselben Schlüssel nutzen)
4. Actions → „Benachrichtigungen senden“ → Run workflow mit Typ `test`

## Lokal ausführen

```bash
pip install -r requirements.txt
python -m stockratio.universe     # Aktienliste aktualisieren (optional)
python -m stockratio.build        # Kennzahlen laden -> site/data/stocks.json (ca. 1 Minute)
python -m http.server -d site 8000
# Browser: http://localhost:8000
```

Tests: `pip install pytest && python -m pytest`

## Aufbau

```
stockratio/
  yahoo.py      Yahoo-Finance-Client (eine Anfrage pro Aktie, Retry/Backoff)
  universe.py   Aktienliste: S&P 500 (Wikipedia), MSCI World (SPDR-ETF-Bestand, ISIN -> Ticker), Watchlist
  metrics.py    Kennzahlen aus den Rohdaten (inkl. Währungsumrechnung, PEG-Berechnung)
  scoring.py    StockRatio-Score und Branchen-Mediane
  build.py      Lädt alles, berechnet Score, schreibt site/data/stocks.json
data/
  universe.csv  Aktuelle Aktienliste (Fallback, falls eine Quelle ausfällt)
  isin_map.json Cache ISIN -> Yahoo-Ticker
site/           Statische Webseite (HTML/CSS/JS ohne Build-Schritt)
watchlist.txt   Eigene Zusatz-Aktien
```

**Robustheit:** Fällt eine Indexquelle aus, bleibt die bisherige Liste erhalten. Aktien, die an einem Tag
nicht geladen werden können, werden aus dem letzten veröffentlichten Stand übernommen und mit ⚠ markiert.
Gelingt weniger als die Hälfte, bricht der Lauf ab und die alte Seite bleibt online.

**Hinweise zu den Daten:** Die MSCI-World-Liste stammt aus dem Bestand des SPDR MSCI World UCITS ETF und
kann vom offiziellen Index leicht abweichen. Performancewerte sind in Heimatwährung der Aktie.
Yahoo-Daten sind inoffiziell und können Lücken oder Fehler enthalten.
