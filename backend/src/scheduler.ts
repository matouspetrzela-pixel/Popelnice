import { subDays, parseISO, format, addDays } from "date-fns";
import { fromZonedTime, toZonedTime } from "date-fns-tz";
import { APP_CONFIG } from "./config";
import { NotificationStatus } from "./models";
import { sendEmail } from "./emailSender";
import { db, DbNotificationRow } from "./db";
import { v4 as uuidv4 } from "uuid";

const TEST_RECIPIENT_EMAIL =
  process.env.TEST_RECIPIENT_EMAIL || process.env.EMAIL_FROM_ADDRESS || "";
const SINGLETON_USER_ID = "singleton-user";

/**
 * Vrátí seznam e-mailových adres pro odeslání: hlavní e-mail uživatele + všichni další příjemci.
 * Bez duplicit a prázdných řetězců (lowercase pro deduplikaci).
 */
export function getRecipientEmails(userId: string): string[] {
  const main = db
    .prepare("SELECT email FROM users WHERE id = @id")
    .get({ id: userId }) as { email: string } | undefined;
  const mainEmail = main?.email?.trim() || TEST_RECIPIENT_EMAIL || "";

  const extra = db
    .prepare("SELECT email FROM notification_recipients")
    .all() as { email: string }[];
  const extraEmails = extra.map((r) => r.email?.trim()).filter(Boolean);

  const seen = new Set<string>();
  const out: string[] = [];
  for (const e of [mainEmail, ...extraEmails]) {
    if (!e) continue;
    const key = e.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out;
}

// Naplánuje notifikace pro všechny svozy a období poplatků,
// pokud pro danou kombinaci ještě neexistují.
export function planNotificationsFromData() {
  if (!TEST_RECIPIENT_EMAIL) {
    console.warn(
      "Nenastaven TEST_RECIPIENT_EMAIL ani EMAIL_FROM_ADDRESS – plánování notifikací se přeskočí.",
    );
    return;
  }

  const hasUser = db
    .prepare(
      `
      SELECT 1 FROM users WHERE id = @id
    `,
    )
    .get({ id: SINGLETON_USER_ID }) as { 1: number } | undefined;

  if (!hasUser) {
    console.warn(
      "Uživatel/domácnost zatím není založená – nejdřív ulož e-mail přes /api/user.",
    );
    return;
  }

  const wasteEvents = db
    .prepare(
      `
      SELECT id, date
      FROM waste_pickup_events
    `,
    )
    .all() as { id: string; date: string }[];

  const feePeriods = db
    .prepare(
      `
      SELECT id, date_from
      FROM fee_periods
    `,
    )
    .all() as { id: string; date_from: string }[];

  const insertNotif = db.prepare(
    `
    INSERT OR IGNORE INTO notifications (
      id, user_id, channel, type, waste_pickup_id, fee_period_id,
      send_at, sent_at, status, error_message
    ) VALUES (
      @id, @user_id, @channel, @type, @waste_pickup_id, @fee_period_id,
      @send_at, NULL, @status, NULL
    )
  `,
  );

  const tx = db.transaction(() => {
    for (const w of wasteEvents) {
      const dayBeforeStr = format(subDays(parseISO(w.date), 1), "yyyy-MM-dd");
      const sendAtUtc = fromZonedTime(
        `${dayBeforeStr}T18:00:00`,
        APP_CONFIG.timezone,
      );

      insertNotif.run({
        id: `notif-waste-${w.id}`,
        user_id: SINGLETON_USER_ID,
        channel: "email",
        type: "svoz",
        waste_pickup_id: w.id,
        fee_period_id: null,
        send_at: sendAtUtc.toISOString(),
        status: "naplanovano" as NotificationStatus,
      });
    }

    for (const fp of feePeriods) {
      const dayBeforeStr = format(subDays(parseISO(fp.date_from), 1), "yyyy-MM-dd");
      const sendAtUtc = fromZonedTime(
        `${dayBeforeStr}T18:00:00`,
        APP_CONFIG.timezone,
      );

      insertNotif.run({
        id: `notif-fee-${fp.id}`,
        user_id: SINGLETON_USER_ID,
        channel: "email",
        type: "poplatek",
        waste_pickup_id: null,
        fee_period_id: fp.id,
        send_at: sendAtUtc.toISOString(),
        status: "naplanovano" as NotificationStatus,
      });
    }
  });

  tx();
}

// Zpracování splatných notifikací – odesílání e‑mailů
// Striktně: pouze v čase 18:00–18:59 (app timezone) a pouze pokud zítra je skutečně den svozu / date_from poplatku.
export async function processDueNotifications(nowUtc: Date): Promise<void> {
  const tz = APP_CONFIG.timezone;
  const nowLocal = toZonedTime(nowUtc, tz);
  const hour = nowLocal.getHours();
  if (hour !== 18) {
    return;
  }

  const tomorrowStr = format(addDays(nowLocal, 1), "yyyy-MM-dd");

  const rows = db
    .prepare<{ now: string }, DbNotificationRow>(
      `SELECT * FROM notifications
       WHERE status = 'naplanovano' AND send_at <= @now`,
    )
    .all({ now: nowUtc.toISOString() });

  const getWasteDate = db.prepare<{ id: string }, { date: string }>(
    `SELECT date FROM waste_pickup_events WHERE id = @id`,
  );
  const getFeeDateFrom = db.prepare<{ id: string }, { date_from: string }>(
    `SELECT date_from FROM fee_periods WHERE id = @id`,
  );

  for (const row of rows) {
    if (row.type === "svoz") {
      if (!row.waste_pickup_id) continue;
      const w = getWasteDate.get({ id: row.waste_pickup_id });
      if (!w || w.date !== tomorrowStr) continue;
    } else if (row.type === "poplatek") {
      if (!row.fee_period_id) continue;
      const fp = getFeeDateFrom.get({ id: row.fee_period_id });
      if (!fp || fp.date_from !== tomorrowStr) continue;
    }

    try {
      const addresses = getRecipientEmails(row.user_id);

      if (addresses.length === 0) {
        throw new Error(
          "Pro uživatele není nastaven e‑mail. Nastavte e‑mail v nastavení domácnosti nebo v .env (TEST_RECIPIENT_EMAIL).",
        );
      }

      const subject =
        row.type === "svoz"
          ? "Připomínka: zítra svoz odpadu"
          : "Připomínka: zítra začíná období pro poplatky";
      const text =
        row.type === "svoz"
          ? "Zítra proběhne svoz odpadu podle kalendáře obce."
          : "Zítra začíná období pro úhradu některého z obecních poplatků.";

      for (const toEmail of addresses) {
        await sendEmail({ to: toEmail, subject, text });
      }

      db.prepare(
        `UPDATE notifications
         SET status = 'odeslano', sent_at = @sent_at, error_message = NULL
         WHERE id = @id`,
      ).run({ id: row.id, sent_at: nowUtc.toISOString() });
    } catch (err: any) {
      db.prepare(
        `UPDATE notifications
         SET status = 'selhalo', error_message = @error_message
         WHERE id = @id`,
      ).run({
        id: row.id,
        error_message: String(err?.message ?? err),
      });
    }
  }
}



