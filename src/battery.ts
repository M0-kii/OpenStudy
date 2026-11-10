export interface BatteryStatus {
  percent: number;
  charging: boolean;
}

export function batteryAlertLevel(status: BatteryStatus | null): number {
  if (!status || status.charging || !Number.isFinite(status.percent) || status.percent < 0 || status.percent > 100) return 0;
  if (status.percent <= 10) return 2;
  return status.percent <= 20 ? 1 : 0;
}
