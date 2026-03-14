/**
 * Skript načte PDF kalendář svozů, vykreslí ho do obrázku a podle barvy pixelů
 * v buňkách (hnědá = BIO, zelená = komunál) vygeneruje data pro svoz-2026.json.
 *
 * Použití: node scripts/extract-svoz-from-pdf.js "cesta/k/svozovy-kalendar.pdf"
 *         node scripts/extract-svoz-from-pdf.js "cesta.pdf" --debug   … uloží stránku jako PNG a vypíše RGB pro březen
 * Výstup: JSON do stdout.
 */

const fs = require("fs");
const path = require("path");

// První den v měsíci 2026 (0 = pondělí) – pro mapování buněk na dny
const DAYS_IN_MONTH_2026 = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
function firstWeekday2026(monthIndex) {
  const d = new Date(2026, monthIndex, 1).getDay(); // 0=ne 1=po ... 6=so
  return (d + 6) % 7; // 0=pondělí
}

function classifyColor(r, g, b) {
  const sum = r + g + b;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const saturation = max - min;
  if (sum < 40) return "empty";
  if (sum > 620 || max > 245) return "empty";
  if (saturation < 20) return "empty";
  // Světle modrá / cyan pozadí (ne barva svozu)
  if (b > 180 && b > r && g > 180) return "empty";
  // Hnědá / červenohnědá: R dominantní (BIO)
  if (r > 85 && r > g + 18 && r > b + 18 && g < 210) return "bio";
  // Zelená sytá (0,122,56 typ)
  if (g > 80 && g > r + 25 && g > b + 25) return "komunal";
  // Tyčová zelená / teal (G a B vysoké, R nízký)
  if (g > 100 && g > r && r < 130 && saturation > 35) return "komunal";
  if (r > 100 && g > 80 && r > b && g > b && saturation > 55) return "komunal";
  return "empty";
}

function samplePixel(data, width, height, channels, px, py) {
  if (px < 0 || px >= width || py < 0 || py >= height) return null;
  const i = (py * width + px) * channels;
  return { r: data[i], g: data[i + 1], b: data[i + 2] };
}

function sampleCellColor(data, width, height, channels, x, y, cellW, cellH) {
  const cy = Math.floor(y + cellH / 2);
  const radius = Math.min(Math.floor(cellW / 4), Math.floor(cellH / 4), 5);
  const samples = [];
  for (const offset of [0, Math.floor(cellW / 4), Math.floor(cellW / 2)]) {
    const cx = Math.floor(x + offset);
    for (let dy = -radius; dy <= radius; dy += Math.max(1, Math.floor(radius / 2))) {
      const py = cy + dy;
      const p = samplePixel(data, width, height, channels, cx, py);
      if (p) samples.push(p);
    }
  }
  if (samples.length === 0) return { type: "empty", r: 0, g: 0, b: 0 };
  const avg = {
    r: Math.round(samples.reduce((a, s) => a + s.r, 0) / samples.length),
    g: Math.round(samples.reduce((a, s) => a + s.g, 0) / samples.length),
    b: Math.round(samples.reduce((a, s) => a + s.b, 0) / samples.length),
  };
  let type = classifyColor(avg.r, avg.g, avg.b);
  if (type === "empty") {
    for (const s of samples) {
      const t = classifyColor(s.r, s.g, s.b);
      if (t === "bio" || t === "komunal") {
        type = t;
        avg.r = s.r;
        avg.g = s.g;
        avg.b = s.b;
        break;
      }
    }
  }
  return { type, r: avg.r, g: avg.g, b: avg.b };
}

async function main() {
  const pdfPath = process.argv[2] || path.join(
    process.env.USERPROFILE || "",
    "Downloads",
    "svozovy-kalendar-komunalni-odpad-a-bio-2026 (1).pdf"
  );
  if (!fs.existsSync(pdfPath)) {
    console.error("PDF nenalezeno:", pdfPath);
    process.exit(1);
  }

  const { pdf } = await import("pdf-to-img");
  const sharp = (await import("sharp")).default;

  const doc = await pdf(pdfPath, { scale: 3 });
  const pageBuffer = await doc.getPage(1);
  const debugMode = process.argv.includes("--debug");
  if (debugMode) {
    const outPath = path.join(__dirname, "..", "svoz-calendar-page1-debug.png");
    await sharp(pageBuffer).toFile(outPath);
    console.error("Debug: uloženo " + outPath);
    console.error("Březen (monthIndex=2), jednotlivé dny – RGB a klasifikace:\n");
  }
  const img = sharp(pageBuffer);
  const meta = await img.metadata();
  const width = meta.width;
  const height = meta.height;
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  const W = info.width;
  const H = info.height;
  const channels = info.channels;
  // Rozložení: 2 sloupce měsíců, 6 řádů. Levá polovina = leden–červen, pravá = červenec–prosinec.
  const colWidth = Math.floor(W / 2);
  const monthHeight = Math.floor(H / 6);
  const marginX = Math.floor(colWidth * 0.06);
  const marginY = Math.floor(monthHeight * 0.12);
  // PDF má často sloupec „Čís.“ (číslo týdne) jako první, pak 7 dní
  const gridCols = 8;
  const gridRows = 6;
  const cellW = Math.floor((colWidth - 2 * marginX) / gridCols);
  const cellH = Math.floor((monthHeight - 2 * marginY) / gridRows);
  const dayColOffset = 1; // 0 = první sloupec je týden, 1 = první sloupec je Po

  const results = [];
  const municipality = "Velky Tynec";

  for (let col = 0; col < 2; col++) {
    for (let row = 0; row < 6; row++) {
      const monthIndex = col * 6 + row;
      const month = monthIndex + 1;
      const year = 2026;
      const baseX = col * colWidth + marginX;
      const baseY = row * monthHeight + marginY;
      const firstWd = firstWeekday2026(monthIndex);
      const daysInMonth = DAYS_IN_MONTH_2026[monthIndex];
      const dayCols = 7; // Po–Ne
      for (let gr = 1; gr < gridRows; gr++) {
        for (let gc = 0; gc < dayCols; gc++) {
          const linearIndex = (gr - 1) * dayCols + gc;
          if (linearIndex < firstWd) continue;
          const day = linearIndex - firstWd + 1;
          if (day > daysInMonth) continue;
          const px = baseX + (gc + dayColOffset) * cellW;
          const py = baseY + gr * cellH;
          const sampled = sampleCellColor(
            data,
            W,
            H,
            channels,
            px,
            py,
            cellW,
            cellH
          );
          const colorType = sampled.type;
          if (monthIndex === 2 && process.argv.includes("--debug")) {
            const dateStr = `${day}.${month}`;
            console.error(`  ${dateStr}  R=${sampled.r} G=${sampled.g} B=${sampled.b}  => ${colorType}`);
          }
          if (colorType === "bio" || colorType === "komunal") {
            const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
            const id = `vt-${dateStr}-${colorType === "bio" ? "bio" : "komunal"}`;
            results.push({
              id,
              municipality,
              date: dateStr,
              type: colorType === "bio" ? "bio" : "komunal",
              note: colorType === "bio" ? "Svoz BIO odpadu" : "Svoz komunálního odpadu",
            });
          }
        }
      }
    }
  }

  results.sort((a, b) => a.date.localeCompare(b.date));
  const json = JSON.stringify(results, null, 2);
  const outPath = process.argv[3];
  if (outPath) {
    fs.writeFileSync(outPath, json, "utf8");
    console.error("Zapsáno " + results.length + " záznamů do " + outPath);
  } else {
    console.log(json);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
