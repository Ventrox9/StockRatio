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
   Signal: ≥ 90 Kaufkandidat · ≥ 70 Positiv · ≥ 30 Neutral · ≥ 10 Negativ · darunter Meiden.

Der Score ist eine **relative, rein quantitative Einordnung** – keine Kursprognose und keine Anlageberatung.

## Einrichtung (einmalig)

1. **GitHub Pages aktivieren:** Repository → *Settings* → *Pages* → *Build and deployment* → Source: **GitHub Actions**.
2. **Workflow starten:** *Actions* → „Daten aktualisieren & Seite veröffentlichen“ → *Run workflow*.
   Nach ca. 3–5 Minuten ist die Seite erreichbar unter
   `https://<dein-github-name>.github.io/<repo-name>/` (der Link steht auch im Workflow-Lauf).
3. Danach läuft die Aktualisierung automatisch **Mo–Fr um 22:17 UTC** (nach US-Börsenschluss).

> Der Workflow veröffentlicht nur vom **Standard-Branch** des Repositories.

## Eigene Watchlist

Trage in [`watchlist.txt`](watchlist.txt) beliebige Yahoo-Finance-Ticker ein (ein Ticker pro Zeile,
z. B. `RHM.DE`, `NOVO-B.CO`, `TSM`). Nach dem Commit läuft der Workflow automatisch und die Aktien
erscheinen auf der Seite unter „★ Watchlist“. Zusätzlich kannst du direkt auf der Webseite Aktien mit ★
als Favorit markieren (wird nur in deinem Browser gespeichert).

Ticker-Endungen: `.DE` Xetra · `.L` London · `.PA` Paris · `.AS` Amsterdam · `.SW` Schweiz ·
`.MI` Mailand · `.MC` Madrid · `.CO` Kopenhagen · `.ST` Stockholm · `.T` Tokio · `.HK` Hongkong ·
`.TO` Toronto · US-Aktien ohne Endung.

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
