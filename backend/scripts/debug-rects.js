'use strict';
/** Vypíše všechny nalezené barevné buňky s přesnými souřadnicemi */
async function main() {
  // Zkopírujeme logiku extractColoredRects z extract-svoz-v2.js
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const { getDocument, OPS } = pdfjs;
  const path = require('path');
  const pdfPath = path.join(process.env.USERPROFILE || '', 'Downloads',
    'svozovy-kalendar-komunalni-odpad-a-bio-2026 (1).pdf');

  const doc  = await getDocument(pdfPath).promise;
  const page = await doc.getPage(1);
  const vp   = page.getViewport({ scale: 1 });
  const { fnArray, argsArray } = await page.getOperatorList();

  console.log(`Stránka: ${vp.width.toFixed(1)} x ${vp.height.toFixed(1)} PDF bodů`);

  const SVOZ_COLORS = new Set(['#963634','#fabf8f','#974706','#00b050','#ff0000']);

  const rects = [];
  let lastColor = null;

  for (let i = 0; i < fnArray.length; i++) {
    if (fnArray[i] === OPS.setFillRGBColor) lastColor = argsArray[i][0];
    if (fnArray[i] === OPS.constructPath && SVOZ_COLORS.has(lastColor)) {
      const coordsWrapper = argsArray[i][1];
      const raw = Array.isArray(coordsWrapper) && coordsWrapper.length === 1
        ? coordsWrapper[0] : coordsWrapper;
      if (!raw) continue;

      const xs = [], ys = [];
      let ci = 0;
      while (ci < raw.length) {
        const op = raw[ci];
        if (op === 0 || op === 1) {
          xs.push(raw[ci+1]); ys.push(raw[ci+2]); ci += 3;
        } else { ci++; }
      }
      if (xs.length < 2) continue;
      const xMin = Math.min(...xs), xMax = Math.max(...xs);
      const yMin = Math.min(...ys), yMax = Math.max(...ys);
      rects.push({
        color: lastColor,
        x: xMin, y: yMin, w: xMax-xMin, h: yMax-yMin,
        // Přepočet na screen souřadnice (Y od vrchu)
        screenY: vp.height - yMax,
        cx: (xMin+xMax)/2, cy: (yMin+yMax)/2,
        screenCY: vp.height - (yMin+yMax)/2,
      });
    }
  }

  rects.sort((a,b) => a.screenY - b.screenY || a.x - b.x);
  console.log('\n── Barevné buňky (seřazeno shora dolů, zleva doprava) ──');
  console.log('color        x       y(PDF)  w       h       screenY');
  for (const r of rects) {
    console.log(`${r.color.padEnd(8)} x=${r.x.toFixed(1).padStart(6)} yPDF=${r.y.toFixed(1).padStart(7)} w=${r.w.toFixed(1).padStart(5)} h=${r.h.toFixed(1).padStart(5)} screenY=${r.screenY.toFixed(1).padStart(7)}`);
  }
}
main().catch(e => { console.error(e); process.exit(1); });
