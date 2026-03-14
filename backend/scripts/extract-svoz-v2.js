'use strict';
/**
 * extract-svoz-v2.js
 *
 * Čte PDF svozového kalendáře VEKTOROVĚ – ne jako obrázek.
 * Hledá obdélníky s výplňovou barvou přímo z PDF drawing operátorů.
 *
 * Použití:
 *   node scripts/extract-svoz-v2.js                         (výstup na stdout)
 *   node scripts/extract-svoz-v2.js --debug                 (výpis barev + pozic)
 *   node scripts/extract-svoz-v2.js "cesta.pdf" "out.json"  (zápis do souboru)
 */

const fs   = require('fs');
const path = require('path');

const YEAR          = 2026;
const MUNICIPALITY  = 'Velky Tynec';
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const MONTH_NAMES   = ['Leden','Únor','Březen','Duben','Květen','Červen',
                       'Červenec','Srpen','Září','Říjen','Listopad','Prosinec'];

function getFirstWeekday(monthIdx) {
  // 0 = pondělí, 6 = neděle
  return (new Date(YEAR, monthIdx, 1).getDay() + 6) % 7;
}

function cmykToRgb(c, m, y, k) {
  return {
    r: Math.round((1 - c) * (1 - k) * 255),
    g: Math.round((1 - m) * (1 - k) * 255),
    b: Math.round((1 - y) * (1 - k) * 255),
  };
}

/**
 * Klasifikuje hex barvu '#rrggbb' jako 'bio', 'komunal' nebo null.
 * Pracuje přímo s přesnými barvami z PDF vektorů.
 *
 * Z inspekce PDF:
 *   #963634 = tmavě červenohnědá  → BIO  (21×)
 *   #fabf8f = světle oranžová     → BIO světlý stín (2×)
 *   #974706 = tmavě oranžová      → BIO tmavý stín (1×)
 *   #00b050 = sytá zelená         → komunál zelená samolepka (16×)
 *   #ff0000 = červená             → komunál zelená+červená samolepka (11×)
 *   #0ba18c = teal                → střídavé pozadí řádku (65×) – NE svoz
 *   #ccf1f8 = světle cyan         → střídavé pozadí (64×) – NE svoz
 *   #c7e0f7 = světle modrá        → střídavé pozadí (64×) – NE svoz
 *   #eeece1 = béžová              → hlavička (22×) – NE svoz
 */
function classifyHex(hex) {
  if (!hex) return null;
  const h = hex.toLowerCase();
  // BIO = hnědá / červenohnědá
  if (h === '#963634' || h === '#fabf8f' || h === '#974706') return 'bio';
  // Komunál zelená samolepka
  if (h === '#00b050') return 'komunal';
  // Komunál zelená + červená samolepka
  if (h === '#ff0000') return 'komunal';
  return null;
}

function classifyColor(r, g, b) {
  const hex = '#' + [r, g, b].map(v => v.toString(16).padStart(2,'0')).join('');
  return classifyHex(hex);
}

/**
 * Extrahuje barevné obdélníky z PDF přes operator list.
 * Vrací pole { x, y, w, h, r, g, b, type } v PDF souřadnicích (Y od spodu).
 */
async function extractColoredRects(pdfPath) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const { getDocument, OPS } = pdfjs;

  const doc  = await getDocument(pdfPath).promise;
  const page = await doc.getPage(1);
  const vp   = page.getViewport({ scale: 1 });
  const opList = await page.getOperatorList();
  const { fnArray, argsArray } = opList;

  const rects      = [];
  const colorStack = [{ rgb: { r: 255, g: 255, b: 255 }, hex: null }];
  let fillRgb      = { r: 255, g: 255, b: 255 };
  let currentHex   = null;

  /**
   * Převede hex string '#rrggbb' nebo hex pole na { r, g, b }.
   * pdfjs-dist v5 vrací barvu jako hex string v setFillRGBColor.
   */
  function parseColor(arg) {
    if (typeof arg === 'string' && arg.startsWith('#')) {
      const hex = arg.slice(1);
      return {
        r: parseInt(hex.slice(0, 2), 16),
        g: parseInt(hex.slice(2, 4), 16),
        b: parseInt(hex.slice(4, 6), 16),
      };
    }
    if (typeof arg === 'number') {
      return { r: Math.round(arg * 255), g: Math.round(arg * 255), b: Math.round(arg * 255) };
    }
    return null;
  }

  /**
   * Extrahuje obdélníky z constructPath args.
   * constructPath args: [opCodes, coords]
   * opCodes je Array kde:
   *   0 = moveTo, 1 = lineTo, 2 = curveTo, 3 = curveTo2, 4 = curveTo3, 5 = closePath, 6 = rectangle
   * coords je flat Array souřadnic.
   * Pro rectangle (6): x, y, w, h
   */
  function extractRectsFromPath(pathArgs) {
    const results = [];
    if (!Array.isArray(pathArgs) || pathArgs.length < 2) return results;
    const ops    = pathArgs[0];
    const coords = pathArgs[1];
    if (!Array.isArray(ops) || !coords) return results;

    // coords může být TypedArray nebo plain Array
    const c = Array.from ? Array.from(coords) : coords;
    let ci = 0;

    for (const op of ops) {
      if (op === 0) { ci += 2; }       // moveTo: x,y
      else if (op === 1) { ci += 2; }  // lineTo: x,y
      else if (op === 2) { ci += 6; }  // curveTo: 3× (x,y)
      else if (op === 3) { ci += 4; }  // curveTo2: 2× (x,y)
      else if (op === 4) { ci += 4; }  // curveTo3: 2× (x,y)
      else if (op === 5) { /* closePath – žádné coords */ }
      else if (op === 6) {             // rectangle: x,y,w,h
        const x = c[ci], y = c[ci+1], w = c[ci+2], h = c[ci+3];
        ci += 4;
        if (w > 0 && h > 0) results.push({ x, y, w: Math.abs(w), h: Math.abs(h) });
      } else { break; } // neznámý operátor
    }
    return results;
  }

  for (let i = 0; i < fnArray.length; i++) {
    const fn   = fnArray[i];
    const args = argsArray[i];

    // ── Barva výplně ──
    if (fn === OPS.setFillRGBColor) {
      // pdfjs v5 vrací hex string '#rrggbb'
      const hex = args[0];
      if (typeof hex === 'string' && hex.startsWith('#')) {
        currentHex = hex.toLowerCase();
        fillRgb = {
          r: parseInt(hex.slice(1,3), 16),
          g: parseInt(hex.slice(3,5), 16),
          b: parseInt(hex.slice(5,7), 16),
        };
      }
    } else if (fn === OPS.setFillCMYKColor) {
      fillRgb = cmykToRgb(args[0], args[1], args[2], args[3]);
      currentHex = null;
    } else if (fn === OPS.setFillGray) {
      const v = Math.round(args[0] * 255);
      fillRgb = { r: v, g: v, b: v };
      currentHex = null;

    // ── Save / Restore ──
    } else if (fn === OPS.save) {
      colorStack.push({ rgb: { ...fillRgb }, hex: currentHex });
    } else if (fn === OPS.restore) {
      if (colorStack.length > 1) {
        const s = colorStack.pop();
        fillRgb = s.rgb;
        currentHex = s.hex;
      }

    // ── constructPath: pdfjs v5 ──
    // args[0] = op kód (číslo, 22 = closed polygon)
    // args[1] = Array s jedním prvkem: Float32Array coords
    // coords formát: opCode, x, y, opCode, x, y, ... closePath
    //   kde opCode 0=moveTo, 1=lineTo, 4=closePath
    } else if (fn === OPS.constructPath) {
      const type = currentHex ? classifyHex(currentHex) : classifyColor(fillRgb.r, fillRgb.g, fillRgb.b);
      if (type && Array.isArray(args) && args.length >= 2) {
        const coordsWrapper = args[1];
        // coords je Array o délce 1 obsahující Float32Array
        const rawCoords = Array.isArray(coordsWrapper) && coordsWrapper.length === 1
          ? coordsWrapper[0]
          : coordsWrapper;

        if (rawCoords && rawCoords.length >= 7) {
          // Iteruj přes flat array ve formátu: op,x,y, op,x,y, ..., closePath(4)
          const xs = [], ys = [];
          let ci = 0;
          while (ci < rawCoords.length) {
            const op = rawCoords[ci];
            if (op === 0 || op === 1) {           // moveTo nebo lineTo: x,y
              if (ci + 2 < rawCoords.length) {
                xs.push(rawCoords[ci + 1]);
                ys.push(rawCoords[ci + 2]);
              }
              ci += 3;
            } else if (op === 2) { ci += 7; }     // curveTo: 3× x,y
            else if (op === 3 || op === 4 && rawCoords[ci] !== 4) { ci += 5; } // curveTo2/3
            else { ci++; }                         // closePath(4) nebo jiný
          }
          if (xs.length >= 2 && ys.length >= 2) {
            const xMin = Math.min(...xs), xMax = Math.max(...xs);
            const yMin = Math.min(...ys), yMax = Math.max(...ys);
            const w = xMax - xMin, h = yMax - yMin;
            if (w > 1 && h > 1) {
              rects.push({ x: xMin, y: yMin, w, h, ...fillRgb, hex: currentHex, type });
            }
          }
        }
      }

    // ── appendRectangle (starší PDF formát) ──
    } else if (fn === OPS.appendRectangle) {
      const type = currentHex ? classifyHex(currentHex) : classifyColor(fillRgb.r, fillRgb.g, fillRgb.b);
      if (type && args[2] > 0 && args[3] > 0) {
        rects.push({ x: args[0], y: args[1], w: Math.abs(args[2]), h: Math.abs(args[3]), ...fillRgb, hex: currentHex, type });
      }
    }
  }

  return { rects, pageW: vp.width, pageH: vp.height };
}

/**
 * Ze seznamu barevných obdélníků odvodí kalendářní termíny.
 *
 * Souřadnice jsou v PDF prostoru: Y roste ODSPODU.
 * Stránka je 595.3 × 841.9 bodů.
 * Kalendář má 2 sloupce (leden–červen vlevo, červenec–prosinec vpravo)
 * a 6 řádků měsíců — leden nahoře (vysoké Y), prosinec dole (nízké Y).
 */
function rectsToEvents(rects, pageW, pageH, debug) {
  if (rects.length === 0) {
    console.error('VAROVÁNÍ: žádné barevné obdélníky nenalezeny.');
    return [];
  }

  // ── 1. Typická buňka ──
  function mode(arr) {
    const freq = {};
    for (const v of arr) {
      const k = Math.round(v * 10) / 10;
      freq[k] = (freq[k] || 0) + 1;
    }
    return +Object.keys(freq).sort((a, b) => freq[b] - freq[a])[0];
  }
  const cellW = mode(rects.map(r => r.w));
  const cellH = mode(rects.map(r => r.h));

  // ── 2. Filtruj na buňky správné velikosti (±35 %) ──
  const cells = rects.filter(r =>
    Math.abs(r.w - cellW) <= cellW * 0.35 &&
    Math.abs(r.h - cellH) <= cellH * 0.35
  );

  if (debug) {
    console.error(`\nTypická buňka: ${cellW.toFixed(1)} × ${cellH.toFixed(1)}`);
    console.error(`Buněk po filtraci: ${cells.length} z ${rects.length}`);
    const cm = {};
    for (const c of cells) { const k=`${c.hex||'?'}=${c.type}`; cm[k]=(cm[k]||0)+1; }
    console.error('Barvy buněk:', Object.entries(cm).map(([k,n])=>`${k}×${n}`).join('  '));
  }

  if (cells.length === 0) return [];

  // ── 3. Odfiltruji legendu (záporné screenY = mimo stránku) ──
  const pageCells = cells.filter(c => (pageH - c.y - c.h) >= 0);

  if (pageCells.length === 0) { console.error('VAROVÁNÍ: všechny buňky jsou v legendě.'); return []; }

  // ── 4. Detekce 2 skupin X pozic (levý a pravý sloupec stránky) ──
  // Každá skupina odpovídá jednomu sloupci měsíců.
  // Z dat: buňky mají x ≈ 69–240 (vlevo) nebo x ≈ 481–584 (vpravo).
  const xCenters = pageCells.map(c => c.x + c.w / 2).sort((a,b) => a-b);
  const xMedian  = xCenters[Math.floor(xCenters.length / 2)];
  const leftX    = xCenters.filter(x => x < xMedian);
  const rightX   = xCenters.filter(x => x >= xMedian);

  // Průměr X pozic v každém sloupci = referenční X
  const leftXavg  = leftX.length  ? leftX.reduce((a,b)=>a+b,0)  / leftX.length  : 0;
  const rightXavg = rightX.length ? rightX.reduce((a,b)=>a+b,0) / rightX.length : pageW;

  // Levý okraj mřížky a šířka jedné buňky (Pro výpočet gc)
  // Z dat: buňky levé skupiny mají x ≈ 69.3 nebo 137.4 nebo 206.2 nebo 240.6
  // Rozdíl mezi sousedy = cellW ≈ 34.6
  // Nejmenší x = začátek dne 0 (Po)
  const xMin = Math.min(...pageCells.map(c => c.x));
  const xMax = Math.max(...pageCells.map(c => c.x + c.w));

  // Y rozsah stránkových buněk (PDF Y, od spodu)
  const yCenters = pageCells.map(c => c.y + c.h / 2);
  const yMin = Math.min(...yCenters); // prosinec / spodní (nejnižší Y v PDF)
  const yMax = Math.max(...yCenters); // leden    / horní  (nejvyšší Y v PDF)

  // 6 měsíců na výšku → výška jednoho měsíce
  const monthH = (yMax - yMin) / 5.0; // 5 mezer mezi 6 řádky

  if (debug) {
    console.error(`\nStránkové buňky: ${pageCells.length}`);
    console.error(`X rozsah: [${xMin.toFixed(1)}, ${xMax.toFixed(1)}]  xMedian=${xMedian.toFixed(1)}`);
    console.error(`Y rozsah PDF: [${yMin.toFixed(1)}, ${yMax.toFixed(1)}]  monthH=${monthH.toFixed(1)}`);
    console.error(`cellW=${cellW.toFixed(1)} cellH=${cellH.toFixed(1)}`);
  }

  // ── 5. Odvození měsíce a dne pro každou buňku ──
  const events = [];
  const seen   = new Set();

  for (const cell of pageCells) {
    const cx = cell.x + cell.w / 2;
    const cy = cell.y + cell.h / 2;

    // Sloupec stránky: 0=leden–červen (vlevo), 1=červenec–prosinec (vpravo)
    const monthCol = cx < xMedian ? 0 : 1;

    // Řádek měsíce: leden = nejvyšší Y v PDF → relRow=0; prosinec = nejnižší Y → relRow=5
    const relRow = Math.round((yMax - cy) / monthH);
    if (relRow < 0 || relRow > 5) continue;

    const monthIdx = monthCol * 6 + relRow;

    // Levý okraj mřížky pro tento sloupec stránky
    const monthXleft = monthCol === 0
      ? xMin                         // nejlevější buňka levého sloupce
      : pageCells.filter(c => c.x + c.w/2 >= xMedian).reduce((m, c) => Math.min(m, c.x), Infinity);

    // Sloupec dne v týdnu (0=Po … 6=Ne)
    const gc = Math.round((cx - monthXleft) / cellW);
    if (gc < 0 || gc > 6) continue;

    // Horní Y (PDF) prvního řádku dat tohoto měsíce
    const monthYtop = yMax - relRow * monthH;

    // Řádek dat (0 = první datový řádek)
    const gr = Math.round((monthYtop - cy) / cellH);
    if (gr < 0 || gr > 5) continue;

    const firstWd = getFirstWeekday(monthIdx);
    const linIdx  = gr * 7 + gc;
    if (linIdx < firstWd) continue;
    const dayNum = linIdx - firstWd + 1;
    if (dayNum < 1 || dayNum > DAYS_IN_MONTH[monthIdx]) continue;

    const month   = monthIdx + 1;
    const dateStr = `${YEAR}-${String(month).padStart(2,'0')}-${String(dayNum).padStart(2,'0')}`;
    const key     = dateStr + cell.type;
    if (seen.has(key)) continue;
    seen.add(key);

    if (debug) {
      console.error(`  ${dateStr} ${cell.type.padEnd(7)}  monthCol=${monthCol} relRow=${relRow} gc=${gc} gr=${gr}  cx=${cx.toFixed(1)} cy=${cy.toFixed(1)}`);
    }

    events.push({
      id:           `vt-${dateStr}-${cell.type}`,
      municipality: MUNICIPALITY,
      date:         dateStr,
      type:         cell.type,
      note:         cell.type === 'bio' ? 'Svoz BIO odpadu' : 'Svoz komunálního odpadu',
    });
  }

  events.sort((a, b) => a.date.localeCompare(b.date));
  return events;
}

async function main() {
  const debug = process.argv.includes('--debug');

  // Výchozí cesta k PDF
  const defaultPdf = path.join(
    process.env.USERPROFILE || process.env.HOME || '',
    'Downloads',
    'svozovy-kalendar-komunalni-odpad-a-bio-2026 (1).pdf'
  );
  const pdfPath  = process.argv.find(a => a.endsWith('.pdf')) || defaultPdf;
  const outPath  = process.argv.find(a => a.endsWith('.json'));

  if (!fs.existsSync(pdfPath)) {
    console.error('PDF nenalezeno:', pdfPath);
    process.exit(1);
  }

  console.error('Načítám PDF vektorová data:', path.basename(pdfPath));
  const { rects, pageW, pageH } = await extractColoredRects(pdfPath);

  console.error(`Nalezeno barevných obdélníků: BIO=${rects.filter(r=>r.type==='bio').length}, komunal=${rects.filter(r=>r.type==='komunal').length}`);

  const events = rectsToEvents(rects, pageW, pageH, debug);

  // ── Přehled po měsících ──
  console.error('\n── Přehled po měsících ──');
  for (let m = 0; m < 12; m++) {
    const mm = String(m + 1).padStart(2, '0');
    const ev = events.filter(e => e.date.startsWith(`${YEAR}-${mm}`));
    const bio = ev.filter(e => e.type === 'bio').map(e => +e.date.slice(8));
    const kom = ev.filter(e => e.type === 'komunal').map(e => +e.date.slice(8));
    console.error(`  ${MONTH_NAMES[m].padEnd(11)}: BIO=[${bio.join(', ')}]  komunal=[${kom.join(', ')}]`);
  }
  console.error(`\nCelkem: ${events.length} termínů`);

  const json = JSON.stringify(events, null, 2);
  if (outPath) {
    fs.writeFileSync(outPath, json, 'utf8');
    console.error(`\nZapsáno ${events.length} termínů do: ${outPath}`);
  } else {
    console.log(json);
  }
}

main().catch(err => {
  console.error('Chyba:', err.message);
  process.exit(1);
});
