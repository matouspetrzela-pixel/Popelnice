# Skript extract-svoz-from-pdf.js

Načte PDF kalendáře svozů (např. od obce), vykreslí první stránku do obrázku a podle **barvy pixelů** v buňkách přiřadí termíny:

- **hnědá** → BIO odpad  
- **zelená / zeleno-červená** → komunální odpad  

## Použití

```bash
# Z backend složky:
npm run extract-svoz-pdf -- "C:\Cesta\k\svozovy-kalendar-2026.pdf"

# S výstupem do souboru (přepíše data):
npm run extract-svoz-pdf -- "C:\Cesta\k\kalendar.pdf" "../../data/svoz-2026.json"

# Debug: uloží stránku jako PNG a vypíše RGB pro březen
node scripts/extract-svoz-from-pdf.js "C:\Cesta\k\kalendar.pdf" --debug
```

## Omezení

- Z PDF se bere jen **text a vykreslená grafika**; barvy jsou odhad z RGB pixelů.
- Rozložení kalendáře (mřížka, sloupec s číslem týdne) může být v jiném PDF jiné – pak je potřeba v souboru `extract-svoz-from-pdf.js` upravit `marginX`, `marginY`, `dayColOffset` nebo `gridCols`.
- Některé termíny můžou zůstat prázdné (bílá/šedá buňka) nebo naopak přebývat – po vygenerování JSON je vhodné zkontrolovat např. březen a případně doplnit/opravit ručně v `data/svoz-2026.json`.

Po úpravě dat spusť znovu import:

```bash
npm run import:waste-2026
```

A restartuj backend, aby se znovu naplánovaly notifikace.
