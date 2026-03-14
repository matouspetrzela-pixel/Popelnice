'use strict';
async function main() {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const { getDocument, OPS } = pdfjs;
  const path = require('path');
  const pdfPath = path.join(process.env.USERPROFILE || '', 'Downloads',
    'svozovy-kalendar-komunalni-odpad-a-bio-2026 (1).pdf');

  const doc  = await getDocument(pdfPath).promise;
  const page = await doc.getPage(1);
  const { fnArray, argsArray } = await page.getOperatorList();

  let lastColor = null;
  let shown = 0;
  for (let i = 0; i < fnArray.length; i++) {
    if (fnArray[i] === OPS.setFillRGBColor) {
      lastColor = argsArray[i][0];
    }
    if (fnArray[i] === OPS.constructPath && shown < 6 &&
        (lastColor === '#963634' || lastColor === '#00b050' || lastColor === '#ff0000')) {
      const args = argsArray[i];
      console.log(`\n=== constructPath (color=${lastColor}) ===`);
      console.log('args.length =', args.length);
      console.log('args[0] type:', typeof args[0], 'value:', JSON.stringify(args[0]).slice(0,80));
      if (args[1]) {
        const coords = args[1];
        console.log('args[1] type:', typeof coords, 'constructor:', coords?.constructor?.name);
        console.log('args[1] keys:', Object.keys(coords).slice(0,20));
        console.log('args[1] length:', coords.length);
        // Ukázka prvních 12 hodnot
        const sample = [];
        for (let k = 0; k < Math.min(16, coords.length !== undefined ? coords.length : 16); k++) {
          sample.push(coords[k]);
        }
        console.log('args[1] values[0..15]:', sample);
      }
      shown++;
    }
  }
}
main().catch(e => { console.error(e); process.exit(1); });
