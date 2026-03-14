import Database from "better-sqlite3";
import path from "path";
import { NotificationStatus } from "./models";

const dbFile = path.join(__dirname, "..", "popelnice.db");

export const db = new Database(dbFile);

export function initDb() {
  db.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      name TEXT,
      address TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS household_settings (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      bin_volume_liters INTEGER NOT NULL,
      pickup_frequency_days INTEGER NOT NULL,
      has_private_well INTEGER NOT NULL,
      has_municipal_water INTEGER NOT NULL,
      dogs_count INTEGER NOT NULL,
      active_flat_sewage_fee INTEGER NOT NULL,
      active_dog_fee INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS waste_pickup_events (
      id TEXT PRIMARY KEY,
      municipality TEXT NOT NULL,
      date TEXT NOT NULL,
      type TEXT NOT NULL,
      note TEXT
    );

    CREATE TABLE IF NOT EXISTS fee_types (
      id TEXT PRIMARY KEY,
      \`key\` TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      rate REAL,
      unit TEXT,
      description TEXT
    );

    CREATE TABLE IF NOT EXISTS fee_periods (
      id TEXT PRIMARY KEY,
      fee_type_id TEXT NOT NULL,
      date_from TEXT NOT NULL,
      date_to TEXT NOT NULL,
      deadline_type TEXT NOT NULL,
      note TEXT,
      FOREIGN KEY (fee_type_id) REFERENCES fee_types(id)
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      channel TEXT NOT NULL,
      type TEXT NOT NULL,
      waste_pickup_id TEXT,
      fee_period_id TEXT,
      send_at TEXT NOT NULL,
      sent_at TEXT,
      status TEXT NOT NULL,
      error_message TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS notification_recipients (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      label TEXT,
      created_at TEXT NOT NULL
    );
  `);
}

export interface DbNotificationRow {
  id: string;
  user_id: string;
  channel: string;
  type: string;
  waste_pickup_id?: string | null;
  fee_period_id?: string | null;
  send_at: string;
  sent_at?: string | null;
  status: NotificationStatus;
  error_message?: string | null;
}


