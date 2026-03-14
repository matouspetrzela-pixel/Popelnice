'use strict';
/** Vypíše všechny unikátní barvy výplně a ukázky constructPath argů. */
async function main() {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const { getDocument, OPS } = pdfjs;
  const path = require('path');

  const pdfPath = process.argv[2] ||
    path.join(process.env.USERPROFILE || '', 'Downloads',
      'svozovy-kalendar-komunalni-odpad-a-bio-2026 (1).pdf');

  const doc  = await getDocument(pdfPath).promise;
  const page = await doc.getPage(1);
  const { fnArray, argsArray } = await page.getOperatorList();

  // 1. Všechny unikátní barvy výplně
  const colors = {};
  for (let i = 0; i < fnArray.length; i++) {
    if (fnArray[i] === OPS.setFillRGBColor) {
      const c = JSON.stringify(argsArray[i]);
      colors[c] = (colors[c] || 0) + 1;
    }
  }
  console.log('── Unikátní barvy setFillRGBColor ──');
  for (const [c, n] of Object.entries(colors).sort((a,b)=>b[1]-a[1])) {
    console.log(`  ${c.padEnd(25)} × ${n}`);
  }

  // 2. Ukázka constructPath argů (op kódy a souřadnice)
  let cpCount = 0;
  console.log('\n── Prvních 8 constructPath argů ──');
  for (let i = 0; i < fnArray.length; i++) {
    if (fnArray[i] === OPS.constructPath) {
      const [ops, coords] = argsArray[i];
      const c = Array.from(coords || []).slice(0, 12);
      console.log(`  ops=${JSON.stringify(ops)}`);
      console.log(`  coords(first 12)=${JSON.stringify(c)}`);
      console.log('');
      if (++cpCount >= 8) break;
    }
  }

  // 3. Kontextové sekvence: setFillRGBColor → constructPath
  console.log('── Sekvence barva→cesta (prvních 15) ──');
  let seq = 0;
  for (let i = 0; i < fnArray.length - 1; i++) {
    if (fnArray[i] === OPS.setFillRGBColor && fnArray[i+1] === OPS.constructPath) {
      const color = argsArray[i][0];
      const [ops, coords] = argsArray[i+1];
      const c = Array.from(coords || []).slice(0, 8);
      console.log(`  color=${color}  ops=${JSON.stringify(ops).slice(0,40)}  coords=${JSON.stringify(c).slice(0,60)}`);
      if (++seq >= 15) break;
    }
  }
}
main().catch(e => { console.error(e); process.exit(1); });
