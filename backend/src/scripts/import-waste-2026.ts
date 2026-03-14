import fs from "fs";
import path from "path";
import { db, initDb } from "../db";

interface WasteImportItem {
  id: string;
  municipality: string;
  date: string;
  type: string;
  note?: string;
}

function main() {
  initDb();

  const dataPath = path.join(__dirname, "..", "..", "..", "data", "svoz-2026.json");
  const json = fs.readFileSync(dataPath, "utf-8");
  const items = JSON.parse(json) as WasteImportItem[];

  // Odstranit notifikace navázané na svoz 2026, pak samotné události 2026
  // (při dalším běhu scheduler znovu naplánuje notifikace pro nové události)
  db.exec(`DELETE FROM notifications WHERE waste_pickup_id IN (SELECT id FROM waste_pickup_events WHERE date LIKE '2026-%')`);
  db.exec(`DELETE FROM waste_pickup_events WHERE date LIKE '2026-%'`);

  const stmt = db.prepare(
    `
    INSERT OR REPLACE INTO waste_pickup_events (
      id, municipality, date, type, note
    )
    VALUES (
      @id, @municipality, @date, @type, @note
    )
  `,
  );

  const transaction = db.transaction((rows: WasteImportItem[]) => {
    for (const row of rows) {
      stmt.run({
        id: row.id,
        municipality: row.municipality,
        date: row.date,
        type: row.type,
        note: row.note ?? null,
      });
    }
  });

  transaction(items);

  console.log(`Importováno ${items.length} záznamů svozu do waste_pickup_events.`);
}

main();

