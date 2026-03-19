import { subDays, parseISO, format, addDays } from "date-fns";
import { fromZonedTime, toZonedTime } from "date-fns-tz";
import { APP_CONFIG } from "./config";
import { NotificationStatus } from "./models";
import { sendEmail } from "./emailSender";
import { db } from "./db";

const TEST_RECIPIENT_EMAIL =
  process.env.TEST_RECIPIENT_EMAIL || process.env.EMAIL_FROM_ADDRESS || "";
const SINGLETON_USER_ID = "singleton-user";

/**
 * Jediné povolené předměty automatických připomínek z plánovače.
 * Nic jiného se přes tento modul neodesílá.
 */
export const REMINDER_SUBJECT_WASTE = "Připomínka: zítra svoz odpadu";
export const REMINDER_SUBJECT_POPLATKY = "Připomínka: zítra začíná období poplatků";
export const REMINDER_SUBJECT_VODOMER = "Připomínka: zítra začíná období hlášení stavu vodoměru";

const TEXT_WASTE = "Zítra proběhne svoz odpadu podle kalendáře obce.";
const TEXT_POPLATKY = "Zítra začíná období úhrady obecních poplatků.";
const TEXT_VODOMER = "Zítra začíná období pro hlášení stavu vodoměru (vodné a stočné).";

const ALLOWED_FEE_DEADLINES = new Set(["platba", "nahlaseni_stavu"]);

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

// Naplánuje notifikace jen pro: svozy, poplatky (platba), hlášení vodoměru (nahlaseni_stavu).
// Jiné deadline_type se do notifications vůbec nedostanou.
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
      SELECT id, date_from, deadline_type
      FROM fee_periods
      WHERE deadline_type IN ('platba', 'nahlaseni_stavu')
    `,
    )
    .all() as { id: string; date_from: string; deadline_type: string }[];

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
      if (!ALLOWED_FEE_DEADLINES.has(fp.deadline_type)) {
        continue;
      }
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

function markNotificationsSent(ids: string[], sentAt: string): void {
  const stmt = db.prepare(
    `UPDATE notifications SET status = 'odeslano', sent_at = @sent_at, error_message = NULL WHERE id = @id`,
  );
  for (const id of ids) {
    stmt.run({ id, sent_at: sentAt });
  }
}

function markNotificationsFailed(ids: string[], err: string): void {
  const stmt = db.prepare(
    `UPDATE notifications SET status = 'selhalo', error_message = @error_message WHERE id = @id`,
  );
  for (const id of ids) {
    stmt.run({ id, error_message: err });
  }
}

/**
 * Odeslání připomínek v 18:00 (APP_TIMEZONE).
 * Povolené jsou jen tři předměty (viz konstanty REMINDER_SUBJECT_*).
 * Svozy: nejvýše jeden e-mail na příjemce za den (i při více svozích zítra).
 * Poplatky: pokud zítra začíná období s deadline nahlaseni_stavu, odejde jen připomínka vodoměru,
 * nikoli připomínka „poplatky“, i když stejný den začíná i platba.
 */
export async function processDueNotifications(nowUtc: Date): Promise<void> {
  const tz = APP_CONFIG.timezone;
  const nowLocal = toZonedTime(nowUtc, tz);
  const hour = nowLocal.getHours();
  if (hour !== 18) {
    return;
  }

  const tomorrowStr = format(addDays(nowLocal, 1), "yyyy-MM-dd");
  const nowIso = nowUtc.toISOString();

  const addresses = getRecipientEmails(SINGLETON_USER_ID);

  // --- Svozy (jeden e-mail na příjemce za den) ---
  const dueWasteRows = db
    .prepare<{ now: string; tomorrow: string }, { id: string }>(
      `SELECT n.id FROM notifications n
       INNER JOIN waste_pickup_events w ON n.waste_pickup_id = w.id
       WHERE n.status = 'naplanovano' AND n.type = 'svoz' AND n.channel = 'email'
         AND n.send_at <= @now AND w.date = @tomorrow`,
    )
    .all({ now: nowIso, tomorrow: tomorrowStr });

  const wasteIds = dueWasteRows.map((r) => r.id);
  if (wasteIds.length > 0) {
    if (addresses.length === 0) {
      markNotificationsFailed(wasteIds, "Žádná e-mailová adresa příjemce.");
    } else {
      try {
        for (const toEmail of addresses) {
          await sendEmail({
            to: toEmail,
            subject: REMINDER_SUBJECT_WASTE,
            text: TEXT_WASTE,
          });
        }
        markNotificationsSent(wasteIds, nowIso);
      } catch (err: unknown) {
        markNotificationsFailed(wasteIds, String((err as Error)?.message ?? err));
      }
    }
  }

  // --- Poplatky / vodoměr: jeden typ za den, vodoměr má absolutní přednost ---
  const dueFeeRows = db
    .prepare<
      { now: string; tomorrow: string },
      { id: string; deadline_type: string }
    >(
      `SELECT n.id, fp.deadline_type
       FROM notifications n
       INNER JOIN fee_periods fp ON n.fee_period_id = fp.id
       WHERE n.status = 'naplanovano' AND n.type = 'poplatek' AND n.channel = 'email'
         AND n.send_at <= @now AND fp.date_from = @tomorrow`,
    )
    .all({ now: nowIso, tomorrow: tomorrowStr });

  const feeIds = dueFeeRows.map((r) => r.id);
  if (feeIds.length === 0) {
    return;
  }

  const hasVodomer = dueFeeRows.some((r) => r.deadline_type === "nahlaseni_stavu");
  const hasPlatba = dueFeeRows.some((r) => r.deadline_type === "platba");
  const unknown = dueFeeRows.filter(
    (r) => r.deadline_type !== "platba" && r.deadline_type !== "nahlaseni_stavu",
  );

  if (unknown.length > 0) {
    markNotificationsFailed(
      unknown.map((r) => r.id),
      "Nepodporovaný deadline_type – e-mail se neodesílá.",
    );
  }

  const knownIds = dueFeeRows
    .filter((r) => ALLOWED_FEE_DEADLINES.has(r.deadline_type))
    .map((r) => r.id);
  if (knownIds.length === 0) {
    return;
  }

  if (addresses.length === 0) {
    markNotificationsFailed(knownIds, "Žádná e-mailová adresa příjemce.");
    return;
  }

  try {
    if (hasVodomer) {
      for (const toEmail of addresses) {
        await sendEmail({
          to: toEmail,
          subject: REMINDER_SUBJECT_VODOMER,
          text: TEXT_VODOMER,
        });
      }
      markNotificationsSent(knownIds, nowIso);
    } else if (hasPlatba) {
      for (const toEmail of addresses) {
        await sendEmail({
          to: toEmail,
          subject: REMINDER_SUBJECT_POPLATKY,
          text: TEXT_POPLATKY,
        });
      }
      markNotificationsSent(knownIds, nowIso);
    }
  } catch (err: unknown) {
    markNotificationsFailed(knownIds, String((err as Error)?.message ?? err));
  }
}
