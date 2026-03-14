export type NotificationChannel = "email";

export type NotificationType = "svoz" | "poplatek";

export interface User {
  id: string;
  email: string;
  name?: string;
  address?: string;
  createdAt: Date;
}

export interface HouseholdSettings {
  id: string;
  userId: string;
  binVolumeLiters: number;
  pickupFrequencyDays: number;
  hasPrivateWell: boolean;
  hasMunicipalWater: boolean;
  dogsCount: number;
  activeFlatSewageFee: boolean;
  activeDogFee: boolean;
}

export type WastePickupType = "komunal" | "bio" | "special";

export interface WastePickupEvent {
  id: string;
  municipality: string;
  date: Date;
  type: WastePickupType;
  note?: string;
  createdAt: Date;
}

export interface FeeType {
  id: string;
  key: string;
  name: string;
  rate?: number;
  unit?: string;
  description?: string;
}

export type FeeDeadlineType = "platba" | "nahlaseni_stavu";

export interface FeePeriod {
  id: string;
  feeTypeId: string;
  dateFrom: Date;
  dateTo: Date;
  deadlineType: FeeDeadlineType;
  note?: string;
}

export type NotificationStatus =
  | "naplanovano"
  | "odeslano"
  | "selhalo"
  | "znovu_naplanovano";

export interface Notification {
  id: string;
  userId: string;
  channel: NotificationChannel;
  type: NotificationType;
  wastePickupId?: string;
  feePeriodId?: string;
  sendAt: Date;
  sentAt?: Date;
  status: NotificationStatus;
  errorMessage?: string;
}

