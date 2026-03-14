/**
 * Konstanty a validace pro další příjemce (notification_recipients).
 * Security: limity, formát e-mailu, UUID v4 pro DELETE.
 */

export const MAX_RECIPIENTS = 20;
export const EMAIL_MAX_LENGTH = 254;
export const LABEL_MAX_LENGTH = 120;

const UUID_V4_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SIMPLE_EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(s: string): boolean {
  const t = s.trim();
  return (
    t.length > 0 &&
    t.length <= EMAIL_MAX_LENGTH &&
    SIMPLE_EMAIL_REGEX.test(t)
  );
}

export function isValidUuidV4(id: string): boolean {
  return typeof id === "string" && UUID_V4_REGEX.test(id);
}

/**
 * Normalizuje label pro zápis: trim, ořez na max délku, null pokud prázdný.
 */
export function normalizeLabel(s: string | undefined | null): string | null {
  const t = (s ?? "").trim().slice(0, LABEL_MAX_LENGTH);
  return t === "" ? null : t;
}
