'use strict';
/**
 * Inspekce PDF operátorů – vypíše všechny unique fn kódy a ukázky argů.
 * Pomůže zjistit jak přesně je kalendář v PDF nakreslený.
 */
async function main() {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const { getDocument, OPS } = pdfjs;

  const pdfPath = process.argv[2] ||
    require('path').join(process.env.USERPROFILE || '', 'Downloads',
      'svozovy-kalendar-komunalni-odpad-a-bio-2026 (1).pdf');

  const doc    = await getDocument(pdfPath).promise;
  const page   = await doc.getPage(1);
  const vp     = page.getViewport({ scale: 1 });
  console.log(`Stránka: ${vp.width.toFixed(1)} x ${vp.height.toFixed(1)} PDF jednotek`);

  const opList = await page.getOperatorList();
  const { fnArray, argsArray } = opList;
  console.log(`Celkem operátorů: ${fnArray.length}`);

  // Vytvoř zpětné mapování OPS kód → název
  const opsNames = {};
  for (const [name, code] of Object.entries(OPS)) {
    if (typeof code === 'number') opsNames[code] = name;
  }

  // Sečti výskyty operátorů
  const counts = {};
  for (const fn of fnArray) {
    counts[fn] = (counts[fn] || 0) + 1;
  }

  console.log('\n── Všechny operátory (seřazeno dle počtu) ──');
  for (const [fn, cnt] of Object.entries(counts).sort((a,b) => b[1]-a[1])) {
    const name = opsNames[fn] || '?';
    console.log(`  [${String(fn).padStart(3)}] ${name.padEnd(30)} × ${cnt}`);
  }

  // Ukázka prvních argů pro operátory s barvami a geometrií
  const colorOps = new Set([
    OPS.setFillRGBColor, OPS.setFillCMYKColor, OPS.setFillGray,
    OPS.setStrokeRGBColor, OPS.setStrokeCMYKColor,
    OPS.setFillColor, OPS.setFillColorN,
    OPS.setFillColorSpace,
    OPS.paintImageXObject, OPS.paintInlineImageXObject,
    OPS.appendRectangle, OPS.constructPath,
  ]);

  console.log('\n── Ukázky barevných/geometrických operátorů ──');
  const shown = {};
  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i];
    if (colorOps.has(fn) && !(shown[fn] >= 3)) {
      shown[fn] = (shown[fn] || 0) + 1;
      const name = opsNames[fn] || '?';
      const args = JSON.stringify(argsArray[i]).substring(0, 120);
      console.log(`  [${fn}] ${name}: ${args}`);
    }
  }

  // Hledáme paintImageXObject – pokud je, Calendar je obrázek v PDF
  const imgCount = fnArray.filter(fn =>
    fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject
  ).length;
  console.log(`\n── Počet vykreslených obrázků na stránce: ${imgCount} ──`);
  if (imgCount > 0) {
    console.log('  → Kalendář je pravděpodobně vložen jako rastrový obrázek, ne vektory!');
  }
}

main().catch(e => { console.error(e.message); process.exit(1); });
