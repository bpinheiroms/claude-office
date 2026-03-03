export interface QuotaData {
  fiveHour: number | null;       // 0-100 utilization %
  sevenDay: number | null;       // 0-100 utilization %
  fiveHourResetAt: Date | null;
  sevenDayResetAt: Date | null;
  planName: string | null;       // 'Max', 'Pro', 'Team', null
  apiUnavailable?: boolean;
  apiError?: string;
}
