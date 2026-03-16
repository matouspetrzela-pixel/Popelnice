import dotenv from "dotenv";
import path from "path";

// Načíst .env z pracovní složky (backend při npm run dev)
dotenv.config({ path: path.join(process.cwd(), ".env") });

const portRaw = (process.env.PORT || "4000").trim();

export const APP_CONFIG = {
  port: Number(portRaw) || 4000,
  timezone: (process.env.APP_TIMEZONE || "Europe/Prague").trim(),
};

export const EMAIL_CONFIG = {
  gmailUser: (process.env.GMAIL_USER || "").trim(),
  gmailAppPassword: (process.env.GMAIL_APP_PASSWORD || "").trim(),
};

/**
 * Konfigurace pro jednoduchý přístupový token administrátora.
 * Pokud není ADMIN_TOKEN nastaven, API zůstává bez ochrany a vypíše se varování.
 */
const adminTokenRaw = (process.env.ADMIN_TOKEN || "").trim();

export const ADMIN_CONFIG = {
  token: adminTokenRaw,
};

export function assertEmailConfig() {
  if (!EMAIL_CONFIG.gmailUser) {
    throw new Error("GMAIL_USER není nastaven. Zadej jej v .env souboru.");
  }
  if (!EMAIL_CONFIG.gmailAppPassword) {
    throw new Error("GMAIL_APP_PASSWORD není nastaven. Zadej jej v .env souboru.");
  }
}

