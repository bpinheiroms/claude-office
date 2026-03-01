/**
 * Fetches rate-limit quota from the Anthropic OAuth usage API.
 * Mirrors the approach used by claude-hud:
 *   GET https://api.anthropic.com/api/oauth/usage
 *   Authorization: Bearer <oauth_token>
 *   anthropic-beta: oauth-2025-04-20
 */

import type { QuotaData } from './types.js';
import { homedir } from 'os';
import { join } from 'path';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { execFileSync } from 'child_process';
import https from 'https';

const HOME = homedir();
const CLAUDE_DIR = join(HOME, '.claude');
const CREDENTIALS_PATH = join(CLAUDE_DIR, '.credentials.json');
const CACHE_DIR = join(CLAUDE_DIR, 'plugins', 'claude-office');
const CACHE_PATH = join(CACHE_DIR, '.quota-cache.json');

const CACHE_TTL_MS = 60_000;         // 60s for success
const CACHE_FAILURE_TTL_MS = 15_000;  // 15s for failures
const REQUEST_TIMEOUT_MS = 5_000;
const KEYCHAIN_TIMEOUT_MS = 5_000;

interface CacheFileData {
  fiveHour: number | null;
  sevenDay: number | null;
  fiveHourResetAt: string | null;
  sevenDayResetAt: string | null;
  planName: string | null;
  apiUnavailable?: boolean;
  apiError?: string;
}

interface CacheFile {
  data: CacheFileData;
  timestamp: number;
}

// --- Token retrieval ---

function getTokenFromKeychain(): string | null {
  try {
    const result = execFileSync(
      '/usr/bin/security',
      ['find-generic-password', '-s', 'Claude Code-credentials', '-w'],
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: KEYCHAIN_TIMEOUT_MS }
    ).trim();
    if (!result) return null;
    const data = JSON.parse(result);
    const token = data?.claudeAiOauth?.accessToken;
    if (!token) return null;
    // Check expiry
    const expiresAt = data.claudeAiOauth?.expiresAt;
    if (expiresAt != null && expiresAt <= Date.now()) return null;
    return token;
  } catch {
    return null;
  }
}

async function getTokenFromFile(): Promise<string | null> {
  try {
    const content = await readFile(CREDENTIALS_PATH, 'utf-8');
    const data = JSON.parse(content);
    const token = data?.claudeAiOauth?.accessToken;
    if (!token) return null;
    const expiresAt = data.claudeAiOauth?.expiresAt;
    if (expiresAt != null && expiresAt <= Date.now()) return null;
    return token;
  } catch {
    return null;
  }
}

function getSubscriptionType(data: any): string | null {
  return data?.claudeAiOauth?.subscriptionType || null;
}

async function getCredentials(): Promise<{ token: string; subscriptionType: string | null } | null> {
  // Try keychain first, then file
  let keychainData: any = null;
  try {
    const raw = execFileSync(
      '/usr/bin/security',
      ['find-generic-password', '-s', 'Claude Code-credentials', '-w'],
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: KEYCHAIN_TIMEOUT_MS }
    ).trim();
    if (raw) keychainData = JSON.parse(raw);
  } catch { /* skip */ }

  let fileData: any = null;
  try {
    const content = await readFile(CREDENTIALS_PATH, 'utf-8');
    fileData = JSON.parse(content);
  } catch { /* skip */ }

  // Get token (keychain priority)
  const keychainToken = keychainData?.claudeAiOauth?.accessToken;
  const fileToken = fileData?.claudeAiOauth?.accessToken;
  const token = keychainToken || fileToken;
  if (!token) return null;

  // Check expiry
  const source = keychainToken ? keychainData : fileData;
  const expiresAt = source?.claudeAiOauth?.expiresAt;
  if (expiresAt != null && expiresAt <= Date.now()) return null;

  // subscriptionType may be in either source
  const subscriptionType = getSubscriptionType(keychainData) || getSubscriptionType(fileData);

  return { token, subscriptionType };
}

function getPlanName(subscriptionType: string | null): string | null {
  if (!subscriptionType) return null;
  const lower = subscriptionType.toLowerCase();
  if (lower.includes('max')) return 'Max';
  if (lower.includes('pro')) return 'Pro';
  if (lower.includes('team')) return 'Team';
  if (lower.includes('api')) return null;
  return subscriptionType.charAt(0).toUpperCase() + subscriptionType.slice(1);
}

// --- Cache ---

async function readCache(): Promise<QuotaData | null> {
  try {
    const content = await readFile(CACHE_PATH, 'utf-8');
    const cache: CacheFile = JSON.parse(content);
    const ttl = cache.data.apiUnavailable ? CACHE_FAILURE_TTL_MS : CACHE_TTL_MS;
    if (Date.now() - cache.timestamp >= ttl) return null;

    return {
      fiveHour: cache.data.fiveHour,
      sevenDay: cache.data.sevenDay,
      fiveHourResetAt: cache.data.fiveHourResetAt ? new Date(cache.data.fiveHourResetAt) : null,
      sevenDayResetAt: cache.data.sevenDayResetAt ? new Date(cache.data.sevenDayResetAt) : null,
      planName: cache.data.planName,
      apiUnavailable: cache.data.apiUnavailable,
      apiError: cache.data.apiError,
    };
  } catch {
    return null;
  }
}

async function writeCache(data: QuotaData): Promise<void> {
  try {
    await mkdir(CACHE_DIR, { recursive: true });
    const cacheData: CacheFile = {
      data: {
        fiveHour: data.fiveHour,
        sevenDay: data.sevenDay,
        fiveHourResetAt: data.fiveHourResetAt?.toISOString() ?? null,
        sevenDayResetAt: data.sevenDayResetAt?.toISOString() ?? null,
        planName: data.planName,
        apiUnavailable: data.apiUnavailable,
        apiError: data.apiError,
      },
      timestamp: Date.now(),
    };
    await writeFile(CACHE_PATH, JSON.stringify(cacheData));
  } catch { /* skip */ }
}

// --- API fetch ---

function parseUtilization(value: number | undefined): number | null {
  if (value == null) return null;
  if (!Number.isFinite(value)) return null;
  return Math.round(Math.max(0, Math.min(100, value)));
}

function parseDate(dateStr: string | undefined): Date | null {
  if (!dateStr) return null;
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return null;
  return date;
}

function fetchUsageApi(accessToken: string): Promise<{ data?: any; error?: string }> {
  return new Promise((resolve) => {
    const options = {
      hostname: 'api.anthropic.com',
      path: '/api/oauth/usage',
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'anthropic-beta': 'oauth-2025-04-20',
        'User-Agent': 'claude-office/1.0',
      },
      timeout: REQUEST_TIMEOUT_MS,
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk: string) => { body += chunk; });
      res.on('end', () => {
        if (res.statusCode !== 200) {
          resolve({ error: `http-${res.statusCode}` });
          return;
        }
        try {
          resolve({ data: JSON.parse(body) });
        } catch {
          resolve({ error: 'parse' });
        }
      });
    });

    req.on('timeout', () => { req.destroy(); resolve({ error: 'timeout' }); });
    req.on('error', () => { resolve({ error: 'network' }); });
    req.end();
  });
}

// --- Main export ---

export async function getQuota(): Promise<QuotaData> {
  // Check cache
  const cached = await readCache();
  if (cached) return cached;

  // Get credentials
  const creds = await getCredentials();
  if (!creds) {
    const result: QuotaData = {
      fiveHour: null, sevenDay: null,
      fiveHourResetAt: null, sevenDayResetAt: null,
      planName: null, apiUnavailable: true, apiError: 'no-credentials',
    };
    await writeCache(result);
    return result;
  }

  const planName = getPlanName(creds.subscriptionType);

  // API users don't have quota limits
  if (!planName) {
    const result: QuotaData = {
      fiveHour: null, sevenDay: null,
      fiveHourResetAt: null, sevenDayResetAt: null,
      planName: null,
    };
    await writeCache(result);
    return result;
  }

  // Fetch from API
  const apiResult = await fetchUsageApi(creds.token);

  if (apiResult.error) {
    const result: QuotaData = {
      fiveHour: null, sevenDay: null,
      fiveHourResetAt: null, sevenDayResetAt: null,
      planName, apiUnavailable: true, apiError: apiResult.error,
    };
    await writeCache(result);
    return result;
  }

  const result: QuotaData = {
    fiveHour: parseUtilization(apiResult.data?.five_hour?.utilization),
    sevenDay: parseUtilization(apiResult.data?.seven_day?.utilization),
    fiveHourResetAt: parseDate(apiResult.data?.five_hour?.resets_at),
    sevenDayResetAt: parseDate(apiResult.data?.seven_day?.resets_at),
    planName,
  };

  await writeCache(result);
  return result;
}
