/**
 * Jednotné údaje o obci, roce dat a „naposledy aktualizováno“.
 * Po nahrání nových svozů nebo poplatků změň lastUpdated (nebo nastav env DATA_LAST_UPDATED=YYYY-MM-DD).
 * Volitelné odkazy v patičce (prázdné = žádné). Projekt není oficiální web obce.
 */
const envUpdated = (process.env.DATA_LAST_UPDATED || "").trim();

export const DATA_META = {
  municipality: "Velký Týnec",
  dataYear: 2026,
  /** ISO datum YYYY-MM-DD – zobrazí se jako „naposledy aktualizováno“ */
  lastUpdated: envUpdated || "2026-03-19",
  footerLinks: [] as { label: string; href: string }[],
};
