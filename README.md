# Bomba

`Bomba` je jednoduchá offline PWA pro dětskou táborovou hru s časovanou bombou. Po spuštění si aplikace vylosuje náhodnou délku tikání mezi nastaveným minimem a maximem, přehrává lokální zvuk tikání a po uplynutí intervalu pustí výbuch. Vše běží čistě na straně prohlížeče bez backendu, databáze a externích knihoven.

## Základ hry

1. Vedoucí nastaví minimální a maximální délku tikání.
2. Volitelně zapne zobrazení zbývajícího času a ruční tlačítko `VÝBUCH`.
3. Po stisku `START` začne bomba tikat.
4. Po náhodném intervalu nastane výbuch, nebo lze kolo ukončit ručně.
5. Tlačítko `ZASTAVIT` kolo bezpečně ukončí bez výbuchu.

## Hlavní funkce

- Mobilní rozhraní pro Android, iPhone i desktop.
- Offline provoz po prvním načtení díky service workeru.
- PWA instalovatelná na plochu.
- Lokální WAV zvuky bez závislosti na internetu.
- Náhodná délka kola s desetinnou přesností.
- Volitelné zobrazení odpočtu.
- Volitelné tlačítko ručního výbuchu.
- Ukládání nastavení do `localStorage`.
- Pokus o Screen Wake Lock během běžícího kola.
- Ošetření návratu aplikace z pozadí přes `visibilitychange`.

## Struktura projektu

```text
.
|-- app.js
|-- generate_audio.py
|-- index.html
|-- manifest.webmanifest
|-- README.md
|-- service-worker.js
|-- styles.css
`-- assets
    |-- explosion.wav
    |-- icon-192.png
    |-- icon-512.png
    |-- icon.svg
    `-- tick.wav
```

## Technické řešení

- `index.html` obsahuje kompletní sémantické rozhraní v češtině.
- `styles.css` řeší responzivní mobilní layout, velké dotykové plochy, kontrast a animace respektující `prefers-reduced-motion`.
- `app.js` drží herní logiku v uzavřeném modulu. Kolo je řízené stavem `isRunning`, `hasExploded` a `roundId`, aby se nemohly překrývat časovače ani zvuky.
- Přesnost času je založená na `performance.now()` a pevném `endTimeMs`, ne na prostém odčítání `setInterval`.
- `service-worker.js` používá cache-first strategii a při aktivaci maže staré cache.
- `manifest.webmanifest` používá relativní cesty, takže funguje i v podadresáři GitHub Pages.

## Jak byly vytvořeny zvuky

Zvuky jsou generované lokálně skriptem `generate_audio.py` pouze pomocí Python standard library:

- `tick.wav` je složený z krátkého vysokého úderu, středového těla, nízké rezonance a jemného filtrovaného šumu.
- `explosion.wav` kombinuje nízkofrekvenční boom, střední vrstvu, krátký praskavý transient a filtrovaný šum s dozníváním.
- Skript používá `wave`, `math`, `random`, `struct` a `zlib`.
- U obou WAV souborů jsou přidané krátké náběhy a doběhy, aby při přehrávání nelupaly.

Zvuky znovu vygeneruješ příkazem:

```bash
python generate_audio.py
```

## Požadavky na Python

- Python 3.10+ je doporučený.
- Nejsou potřeba žádné externí balíčky ani internet.

## Lokální spuštění

Aplikaci neotevírej jen dvojklikem přes `file://`, protože:

- service worker se typicky neregistruje,
- PWA funkce se nebudou chovat správně,
- offline cache nepůjde spolehlivě otestovat.

Spusť jednoduchý HTTP server:

```bash
python -m http.server 8000
```

Pak otevři:

```text
http://localhost:8000
```

## Nasazení na GitHub Pages

1. Vytvoř nový GitHub repozitář.
2. Nahraj všechny soubory z tohoto projektu.
3. Otevři `Settings` repozitáře.
4. V sekci `Pages` zapni GitHub Pages.
5. Vyber větev, typicky `main`, a kořenový adresář.
6. Počkej na publikaci a otevři výslednou URL.
7. Aplikaci načti alespoň jednou online.
8. Přidej ji na plochu a otestuj režim letadlo.

## Přidání na plochu

### Android

1. Otevři aplikaci v Chrome.
2. V menu zvol `Přidat na plochu` nebo `Instalovat aplikaci`.
3. Potvrď instalaci a spusť aplikaci z ikony.

### iPhone

1. Otevři aplikaci v Safari.
2. Klepni na sdílení.
3. Zvol `Přidat na plochu`.
4. Potvrď název a aplikaci spusť z nové ikony.

## Offline test

1. Načti aplikaci online.
2. Ověř, že se service worker zaregistroval.
3. Přepni telefon nebo počítač do režimu letadlo.
4. Zavři a znovu otevři aplikaci.
5. Ověř načtení rozhraní i přehrání obou zvuků.

## Test zvuku přes Bluetooth reproduktor

1. Připoj telefon k Bluetooth reproduktoru ještě před začátkem hry.
2. Otestuj tlačítko `Otestovat tikání`.
3. Otestuj tlačítko `Otestovat výbuch`.
4. Spusť krátké kolo a ověř hlasitost i stabilitu přehrávání.
5. Pokud telefon používá úsporný režim, vypni jej.

## Známá omezení mobilních prohlížečů

- Některé prohlížeče dovolí přehrát zvuk až po první interakci uživatele.
- Při přechodu aplikace na pozadí může systém omezit časovače i zvuk.
- Wake Lock nemusí být na všech zařízeních dostupný.
- Nejvyšší spolehlivost je při ponechání aplikace otevřené v popředí.

Pro nejspolehlivější použití:

- nech aplikaci otevřenou v popředí,
- nevypínej displej,
- vypni úsporný režim telefonu,
- před hrou otestuj spojení s Bluetooth reproduktorem.
