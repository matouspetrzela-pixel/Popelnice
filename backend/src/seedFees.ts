import { db } from "./db";

const FEE_TYPES = [
  {
    id: "fee-komunalni-odpad",
    key: "komunalni_odpad",
    name: "Poplatek za svoz komunálního odpadu",
    rate: 1,
    unit: "Kc/litr",
    description:
      "Sazba 1 Kč za litr nádoby, účtováno dle objemu a frekvence svozu.",
  },
  {
    id: "fee-vodne-stocne",
    key: "vodne_stocne",
    name: "Vodné a stočné",
    rate: null,
    unit: "Kc/m3",
    description:
      "Poplatky za vodné a stočné se platí 2× ročně vždy zpětně za uplynulé pololetí.",
  },
  {
    id: "fee-pausalni-stocne",
    key: "pausalni_stocne",
    name: "Paušální stočné",
    rate: 1584,
    unit: "Kc/rok",
    description: "Paušální stočné pro domácnosti bez obecní vody.",
  },
  {
    id: "fee-pes",
    key: "pes",
    name: "Poplatek za psa",
    rate: 150,
    unit: "Kc/pes",
    description: "1. pes 150 Kč, každý další 250 Kč.",
  },
  {
    id: "fee-najem-pozemku",
    key: "najem_pozemku",
    name: "Pronájem pozemku",
    rate: null,
    unit: null,
    description: "Poplatky za pronájem pozemků dle smlouvy.",
  },
];

const FEE_PERIODS = [
  {
    id: "period-komunalni-odpad-2026",
    fee_type_id: "fee-komunalni-odpad",
    date_from: "2026-02-02",
    date_to: "2026-03-31",
    deadline_type: "platba",
    note: "Poplatek za svoz komunálního odpadu za rok 2025 + samolepka na rok 2026.",
  },
  {
    id: "period-vodne-stocne-2025-2p",
    fee_type_id: "fee-vodne-stocne",
    date_from: "2026-02-02",
    date_to: "2026-03-31",
    deadline_type: "platba",
    note: "Stav vodoměru je nutné nahlásit nejpozději do 18. 12. 2025.",
  },
  {
    id: "period-vodne-stocne-2026-1p",
    fee_type_id: "fee-vodne-stocne",
    date_from: "2026-07-27",
    date_to: "2026-08-14",
    deadline_type: "platba",
    note: "Stav vodoměru je nutné nahlásit nejpozději do 19. 6. 2026.",
  },
  {
    id: "period-vodne-stocne-vodomer-2026-12",
    fee_type_id: "fee-vodne-stocne",
    date_from: "2026-12-11",
    date_to: "2026-12-18",
    deadline_type: "nahlaseni_stavu",
    note:
      "NEZAPOMENTE!<br/>Pro výpočet výše vodného a stočného v roce 2026 je nutné<br/>nahlásit stav vodoměru nejpozději do 18. 12. 2026.",
  },
  {
    id: "period-pausalni-stocne-2026",
    fee_type_id: "fee-pausalni-stocne",
    date_from: "2026-02-02",
    date_to: "2026-05-29",
    deadline_type: "platba",
    note: "Paušální stočné (občan nemá obecní vodu).",
  },
  {
    id: "period-pes-2026",
    fee_type_id: "fee-pes",
    date_from: "2026-02-02",
    date_to: "2026-05-29",
    deadline_type: "platba",
    note: "Poplatky za psa.",
  },
  {
    id: "period-najem-pozemku-2026",
    fee_type_id: "fee-najem-pozemku",
    date_from: "2026-02-02",
    date_to: "2026-05-29",
    deadline_type: "platba",
    note: "Poplatky za pronájem pozemku.",
  },
];

/**
 * Pokud jsou tabulky fee_types a fee_periods prázdné, naplní je výchozími daty
 * (stejná data jako seed-fees-2026). Volá se při startu serveru, aby na Renderu
 * a jinde zobrazovala sekce „Nadcházející poplatky“ bez ručního spuštění seedu.
 */
export function seedFeesIfEmpty(): void {
  const countTypes = db
    .prepare("SELECT COUNT(*) as c FROM fee_types")
    .get() as { c: number };
  const countPeriods = db
    .prepare("SELECT COUNT(*) as c FROM fee_periods")
    .get() as { c: number };

  if (countTypes.c > 0 && countPeriods.c > 0) {
    return;
  }

  const insertFeeType = db.prepare(`
    INSERT OR IGNORE INTO fee_types (id, key, name, rate, unit, description)
    VALUES (@id, @key, @name, @rate, @unit, @description)
  `);
  const insertFeePeriod = db.prepare(`
    INSERT OR IGNORE INTO fee_periods (
      id, fee_type_id, date_from, date_to, deadline_type, note
    )
    VALUES (
      @id, @fee_type_id, @date_from, @date_to, @deadline_type, @note
    )
  `);

  const tx = db.transaction(() => {
    for (const ft of FEE_TYPES) {
      insertFeeType.run(ft);
    }
    for (const fp of FEE_PERIODS) {
      insertFeePeriod.run(fp);
    }
  });

  tx();
  console.log(
    `[seedFees] Inicializováno ${FEE_TYPES.length} typů poplatků a ${FEE_PERIODS.length} období (prázdná DB).`,
  );
}
