import cors from "cors";
import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import fs from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import { ADMIN_CONFIG, APP_CONFIG, EMAIL_CONFIG } from "./config";
import { DATA_META } from "./dataMeta";
import { db, initDb } from "./db";
import { seedFeesIfEmpty } from "./seedFees";
import { sendEmail } from "./emailSender";
import {
  planNotificationsFromData,
  processDueNotifications,
  getRecipientEmails,
} from "./scheduler";
import {
  isValidEmail,
  isValidUuidV4,
  normalizeLabel,
  MAX_RECIPIENTS,
  EMAIL_MAX_LENGTH,
} from "./recipientsValidation";

process.on("uncaughtException", (err) => {
  console.error("UNCAUGHT EXCEPTION:", err);
});
process.on("unhandledRejection", (err) => {
  console.error("UNHANDLED REJECTION:", err);
});

const app = express();

if (!ADMIN_CONFIG.token) {
  console.warn(
    "ADMIN_TOKEN není nastaven – mutační API endpointy nejsou chráněny přístupovým tokenem. Nastav ADMIN_TOKEN v prostředí pro produkci.",
  );
}

// Bezpečnostní hlavičky – vyžadované Chrome/Play Protect pro WebAPK instalaci PWA
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
        manifestSrc: ["'self'"],
        workerSrc: ["'self'"],
      },
    },
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },
    frameguard: { action: "deny" },
  })
);

// Jednoduché rate limiting – ochrana proti zneužití e-mailových endpointů a změn nastavení
const sensitiveLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
});

// Middleware pro ověření administrátorského tokenu na mutačních routách
function requireAdminToken(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
) {
  if (!ADMIN_CONFIG.token) {
    return next();
  }
  const headerToken = (req.headers["x-admin-token"] as string | undefined)?.trim();
  if (!headerToken || headerToken !== ADMIN_CONFIG.token) {
    return res.status(401).json({ message: "Neautorizovaný přístup. Chybí nebo nesedí X-Admin-Token." });
  }
  return next();
}

// CORS pro frontend na Vercelu (env FRONTEND_ORIGIN např. https://popelnice.vercel.app)
const frontendOrigin = process.env.FRONTEND_ORIGIN;
if (frontendOrigin) {
  app.use(cors({ origin: frontendOrigin }));
} else {
  app.use(cors());
}

app.use(express.json());

// Základní health-check
app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

// Metadata pro UI: obec, rok dat, naposledy aktualizováno, odkazy v patičce
app.get("/api/meta", (_req, res) => {
  res.json({
    municipality: DATA_META.municipality,
    dataYear: DATA_META.dataYear,
    lastUpdated: DATA_META.lastUpdated,
    footerLinks: DATA_META.footerLinks,
  });
});

// Diagnostika e-mailové konfigurace
app.get("/api/email-check", (_req, res) => {
  res.json({
    gmailUser: EMAIL_CONFIG.gmailUser ? "nastaven" : "CHYBÍ",
    gmailAppPassword: EMAIL_CONFIG.gmailAppPassword ? `nastaven (${EMAIL_CONFIG.gmailAppPassword.replace(/\S/g, "*")})` : "CHYBÍ",
  });
});

// Jednoduchý model: jedna domácnost v systému, identifikátor 'singleton-user'
const SINGLETON_USER_ID = "singleton-user";

// Načtení uživatele/domácnosti
app.get("/api/user", (_req, res) => {
  const row = db
    .prepare(
      `
      SELECT id, email, name, address, created_at
      FROM users
      WHERE id = @id
    `,
    )
    .get({ id: SINGLETON_USER_ID }) as
    | { id: string; email: string; name?: string; address?: string; created_at: string }
    | undefined;

  if (!row) {
    return res.status(404).json({ message: "Uživatel/domácnost zatím neexistuje." });
  }

  res.json({
    id: row.id,
    email: row.email,
    name: row.name ?? null,
    address: row.address ?? null,
    createdAt: row.created_at,
  });
});

interface UpsertUserBody {
  email: string;
  name?: string;
  address?: string;
}

// Založení nebo úprava uživatele/domácnosti
app.post("/api/user", requireAdminToken, sensitiveLimiter, (req, res) => {
  const body = req.body as UpsertUserBody;

  if (!body.email || typeof body.email !== "string") {
    return res.status(400).json({ message: "Pole 'email' je povinné." });
  }

  const existing = db
    .prepare(
      `
      SELECT id FROM users WHERE id = @id
    `,
    )
    .get({ id: SINGLETON_USER_ID }) as { id: string } | undefined;

  const nowIso = new Date().toISOString();

  if (existing) {
    db.prepare(
      `
      UPDATE users
      SET email = @email,
          name = @name,
          address = @address
      WHERE id = @id
    `,
    ).run({
      id: SINGLETON_USER_ID,
      email: body.email,
      name: body.name ?? null,
      address: body.address ?? null,
    });
  } else {
    db.prepare(
      `
      INSERT INTO users (id, email, name, address, created_at)
      VALUES (@id, @email, @name, @address, @created_at)
    `,
    ).run({
      id: SINGLETON_USER_ID,
      email: body.email,
      name: body.name ?? null,
      address: body.address ?? null,
      created_at: nowIso,
    });

    // Při prvním založení nastavíme i základní household_settings pro variantu 120 l / 1×14 dní
    db.prepare(
      `
      INSERT OR IGNORE INTO household_settings (
        id, user_id, bin_volume_liters, pickup_frequency_days,
        has_private_well, has_municipal_water, dogs_count,
        active_flat_sewage_fee, active_dog_fee
      )
      VALUES (
        @id, @user_id, 120, 14,
        0, 1, 0,
        0, 0
      )
    `,
    ).run({
      id: uuidv4(),
      user_id: SINGLETON_USER_ID,
    });
  }

  return res.status(200).json({ message: "Uživatel/domácnost uložena.", email: body.email });
});

// --- Další příjemci (sousedé) ---

// GET /api/recipients – seznam všech dalších příjemců
app.get("/api/recipients", (_req, res) => {
  const rows = db
    .prepare(
      `SELECT id, email, label, created_at
       FROM notification_recipients
       ORDER BY created_at ASC`,
    )
    .all() as { id: string; email: string; label: string | null; created_at: string }[];

  res.json({
    recipients: rows.map((r) => ({
      id: r.id,
      email: r.email,
      label: r.label ?? null,
      createdAt: r.created_at,
    })),
  });
});

interface PostRecipientBody {
  email?: string;
  label?: string;
}

// POST /api/recipients – přidat dalšího příjemce
app.post("/api/recipients", requireAdminToken, sensitiveLimiter, (req, res) => {
  const body = req.body as PostRecipientBody;

  const rawEmail = body.email;
  if (!rawEmail || typeof rawEmail !== "string") {
    return res.status(400).json({ message: "Pole 'email' je povinné." });
  }

  const email = rawEmail.trim();
  if (email.length === 0) {
    return res.status(400).json({ message: "E‑mail nesmí být prázdný." });
  }
  if (email.length > EMAIL_MAX_LENGTH) {
    return res.status(400).json({
      message: `E‑mail může mít nejvýše ${EMAIL_MAX_LENGTH} znaků.`,
    });
  }
  if (!isValidEmail(email)) {
    return res.status(400).json({ message: "Neplatný formát e‑mailu." });
  }

  const countRow = db
    .prepare(`SELECT COUNT(*) as c FROM notification_recipients`)
    .get() as { c: number };
  if (countRow.c >= MAX_RECIPIENTS) {
    return res.status(400).json({
      message: `Maximální počet dalších příjemců je ${MAX_RECIPIENTS}.`,
    });
  }

  const existing = db
    .prepare(`SELECT id FROM notification_recipients WHERE LOWER(TRIM(email)) = LOWER(@email)`)
    .get({ email }) as { id: string } | undefined;
  if (existing) {
    return res.status(409).json({ message: "Tento e‑mail už je v seznamu." });
  }

  const label = normalizeLabel(body.label);
  const id = uuidv4();
  const created_at = new Date().toISOString();

  db.prepare(
    `INSERT INTO notification_recipients (id, email, label, created_at)
     VALUES (@id, @email, @label, @created_at)`,
  ).run({ id, email, label, created_at });

  return res.status(201).json({
    id,
    email,
    label,
    createdAt: created_at,
  });
});

// DELETE /api/recipients/:id – odebrat příjemce
app.delete("/api/recipients/:id", requireAdminToken, sensitiveLimiter, (req, res) => {
  const id = req.params.id;
  if (!isValidUuidV4(id)) {
    return res.status(400).json({ message: "Neplatné ID." });
  }

  const result = db
    .prepare(`DELETE FROM notification_recipients WHERE id = @id`)
    .run({ id });

  if (result.changes === 0) {
    return res.status(404).json({ message: "Příjemce nenalezen." });
  }

  return res.status(204).send();
});

function dedupeWasteEventRows(rows: { date: string; type: string }[]): { date: string; type: string }[] {
  const seen = new Set<string>();
  const out: { date: string; type: string }[] = [];
  for (const r of rows) {
    const d = typeof r.date === "string" ? r.date.slice(0, 10) : "";
    const t = String(r.type || "").toLowerCase();
    if (!d || !t) continue;
    const key = `${d}|${t}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ date: d, type: t });
  }
  out.sort((a, b) => (a.date === b.date ? a.type.localeCompare(b.type) : a.date.localeCompare(b.date)));
  return out;
}

// Termíny svozů pro kalendář (rok: query year, výchozí aktuální)
app.get("/api/waste-events", (req, res) => {
  const yearParam = req.query.year;
  const year =
    typeof yearParam === "string" && /^\d{4}$/.test(yearParam)
      ? yearParam
      : String(new Date().getFullYear());
  const prefix = `${year}-`;

  let rows = db
    .prepare(
      `SELECT DISTINCT date, type FROM waste_pickup_events WHERE date LIKE @prefix ORDER BY date, type`,
    )
    .all({ prefix }) as { date: string; type: string }[];

  if (rows.length === 0 && year === "2026") {
    const dataPath = path.join(__dirname, "..", "data", "svoz-2026.json");
    try {
      const json = fs.readFileSync(dataPath, "utf-8");
      const items = JSON.parse(json) as { date: string; type: string }[];
      rows = items
        .filter((e) => e.date.startsWith(prefix))
        .map((e) => ({ date: e.date, type: e.type }));
    } catch {
      // nechat rows = []
    }
  }

  const events = dedupeWasteEventRows(rows);

  res.json({
    events: events.map((r) => ({ date: r.date, type: r.type })),
  });
});

// Přehled nejbližších naplánovaných notifikací (pro UI)
// Poplatky: zobrazit od 18:00 dne před date_from až do konce date_to (včetně již odeslaných)
app.get("/api/next-notifications", (_req, res) => {
  const { toZonedTime, format: fmtTz } = require("date-fns-tz");
  const tz = APP_CONFIG.timezone;
  const todayStr = fmtTz(toZonedTime(new Date(), tz), "yyyy-MM-dd", { timeZone: tz });

  const rows = db
    .prepare(
      `
      SELECT n.type, n.send_at, n.status,
             w.date as waste_date, w.type as waste_type, w.note as waste_note,
             ft.name as fee_name, fp.date_from as fee_date_from, fp.date_to as fee_date_to, fp.note as fee_note
      FROM notifications n
      LEFT JOIN waste_pickup_events w ON n.waste_pickup_id = w.id
      LEFT JOIN fee_periods fp ON n.fee_period_id = fp.id
      LEFT JOIN fee_types ft ON fp.fee_type_id = ft.id
      WHERE n.status = 'naplanovano'
         OR (n.type = 'poplatek' AND n.status = 'odeslano' AND fp.date_to >= @todayStr)
      ORDER BY n.send_at ASC
      LIMIT 20
    `,
    )
    .all({ todayStr }) as {
      type: string; send_at: string; status: string;
      waste_date?: string; waste_type?: string; waste_note?: string;
      fee_name?: string; fee_date_from?: string; fee_date_to?: string; fee_note?: string;
    }[];

  if (!rows.length) {
    return res.status(200).json({ notifications: [] });
  }

  const notifications = rows.map((r) => {
    const utc = new Date(r.send_at);
    const local = toZonedTime(utc, tz);
    const localStr = fmtTz(local, "d. M. yyyy HH:mm", { timeZone: tz });
    return {
      type: r.type,
      sendAtLocal: localStr,
      wasteDate: r.waste_date ?? null,
      wasteType: r.waste_type ?? null,
      wasteNote: r.waste_note ?? null,
      feeName: r.fee_name ?? null,
      feeDateFrom: r.fee_date_from ?? null,
      feeDateTo: r.fee_date_to ?? null,
      feeNote: r.fee_note ?? null,
    };
  });

  res.json({ notifications });
});

// Aktuálně probíhající poplatky – jen období, ve kterém je dnešní den (date_from … date_to včetně)
app.get("/api/current-fees", (_req, res) => {
  const { toZonedTime, format: fmtTz } = require("date-fns-tz");
  const tz = APP_CONFIG.timezone;
  const todayStr = fmtTz(toZonedTime(new Date(), tz), "yyyy-MM-dd", { timeZone: tz });

  const rows = db
    .prepare(
      `
      SELECT fp.id, fp.date_from, fp.date_to, fp.deadline_type, fp.note,
             ft.name, ft.description, ft.rate, ft.unit
      FROM fee_periods fp
      JOIN fee_types ft ON fp.fee_type_id = ft.id
      WHERE fp.date_from <= @todayStr
        AND fp.date_to >= @todayStr
      ORDER BY fp.date_from ASC
    `,
    )
    .all({ todayStr }) as {
      id: string; date_from: string; date_to: string;
      deadline_type: string; note: string | null;
      name: string; description: string | null;
      rate: number | null; unit: string | null;
    }[];

  const seenIds = new Set<string>();
  const uniqueRows = rows.filter((r) => {
    if (seenIds.has(r.id)) return false;
    seenIds.add(r.id);
    return true;
  });

  const fees = uniqueRows.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description ?? null,
    rate: r.rate ?? null,
    unit: r.unit ?? null,
    dateFrom: r.date_from,
    dateTo: r.date_to,
    deadlineType: r.deadline_type,
    note: r.note ?? null,
    active: r.date_from <= todayStr && r.date_to >= todayStr,
  }));

  res.json({ fees });
});

// Odeslání testovacího e‑mailu (na hlavní e‑mail a všechny další příjemce)
app.post("/api/send-test-email", requireAdminToken, sensitiveLimiter, async (_req, res) => {
  const addresses = getRecipientEmails(SINGLETON_USER_ID);

  if (addresses.length === 0) {
    return res.status(400).json({
      message: "Nejdřív ulož e‑mail v nastavení domácnosti.",
    });
  }

  try {
    const subject = "Popelnice – testovací e‑mail";
    const text =
      "Toto je testovací e‑mail z aplikace Popelnice. Pokud ho vidíš, odesílání notifikací funguje.";

    for (const to of addresses) {
      await sendEmail({ to, subject, text });
    }

    const count = addresses.length;
    return res.status(200).json({
      message:
        count === 1
          ? "Testovací e‑mail byl odeslán na 1 adresu."
          : `Testovací e‑mail byl odeslán na ${count} adres.`,
    });
  } catch (err: any) {
    return res.status(500).json({
      message: "Odeslání se nepovedlo. Zkontrolujte nastavení e‑mailu.",
    });
  }
});

initDb();
seedFeesIfEmpty();

// Jednorázové naplánování notifikací z dat (svozy + poplatky)
planNotificationsFromData();

// Statický frontend (lokálně; na Railway/Render s Root=backend složka neexistuje)
const frontendPath = path.join(__dirname, "..", "..", "frontend");
if (fs.existsSync(frontendPath)) {
  // Manifest musí mít správný Content-Type a SW potřebuje Service-Worker-Allowed
  app.get("/manifest.json", (_req, res) => {
    res.setHeader("Content-Type", "application/manifest+json");
    res.sendFile(path.join(frontendPath, "manifest.json"));
  });
  app.get("/sw.js", (_req, res) => {
    res.setHeader("Content-Type", "application/javascript");
    res.setHeader("Service-Worker-Allowed", "/");
    res.sendFile(path.join(frontendPath, "sw.js"));
  });
  app.use(express.static(frontendPath));
}

const server = app.listen(APP_CONFIG.port, () => {
  console.log(`Popelnice backend běží na portu ${APP_CONFIG.port}`);
});

// Jednoduchý interval, který každou minutu zpracuje splatné notifikace.
const interval = setInterval(() => {
  void processDueNotifications(new Date());
}, 60 * 1000);


function shutdown() {
  clearInterval(interval);
  server.close(() => {
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

