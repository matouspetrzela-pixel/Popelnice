/**
 * Jednotné údaje o obci, roce dat a „naposledy aktualizováno“.
 * Po nahrání nových svozů nebo poplatků změň lastUpdated (nebo nastav env DATA_LAST_UPDATED=YYYY-MM-DD).
 * Odkazy v patičce doplň / uprav podle potřeby.
 */
const envUpdated = (process.env.DATA_LAST_UPDATED || "").trim();

export const DATA_META = {
  municipality: "Velký Týnec",
  dataYear: 2026,
  /** ISO datum YYYY-MM-DD – zobrazí se jako „naposledy aktualizováno“ */
  lastUpdated: envUpdated || "2026-03-19",
  footerLinks: [
    { label: "Web obce Velký Týnec", href: "https://www.velkytynec.cz/" },
  ] as { label: string; href: string }[],
};
