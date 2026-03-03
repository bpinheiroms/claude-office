/**
 * Fetches rate-limit quota from the Anthropic OAuth usage API.
 * Refreshes expired tokens automatically using the OAuth refresh flow.
 *
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

const CACHE_TTL_MS = 60_000;
const CACHE_FAILURE_TTL_MS = 15_000;
const REQUEST_TIMEOUT_MS = 5_000;
const KEYCHAIN_TIMEOUT_MS = 5_000;

const OAUTH_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
const OAUTH_TOKEN_URL = 'https://console.anthropic.com/v1/oauth/token';

interface CacheFile {
  data: {
    fiveHour: number | null;
    sevenDay: number | null;
    fiveHourResetAt: string | null;
    sevenDayResetAt: string | null;
    planName: string | null;
    apiUnavailable?: boolean;
    apiError?: string;
  };
  timestamp: number;
}

// --- Credentials ---

interface OAuthData {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  subscriptionType?: string;
}

function readKeychainRaw(): OAuthData | null {
  try {
    const raw = execFileSync(
      '/usr/bin/security',
      ['find-generic-password', '-s', 'Claude Code-credentials', '-w'],
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: KEYCHAIN_TIMEOUT_MS }
    ).trim();
    if (!raw) return null;
    return JSON.parse(raw)?.claudeAiOauth ?? null;
  } catch {
    return null;
  }
}

async function readFileCredentials(): Promise<OAuthData | null> {
  try {
    const content = await readFile(CREDENTIALS_PATH, 'utf-8');
    return JSON.parse(content)?.claudeAiOauth ?? null;
  } catch {
    return null;
  }
}

function getPlanName(subscriptionType: string | undefined | null): string | null {
  if (!subscriptionType) return null;
  const lower = subscriptionType.toLowerCase();
  if (lower.includes('max')) return 'Max';
  if (lower.includes('pro')) return 'Pro';
  if (lower.includes('team')) return 'Team';
  if (lower.includes('api')) return null;
  return subscriptionType.charAt(0).toUpperCase() + subscriptionType.slice(1);
}

// --- Token refresh ---

function refreshAccessToken(refreshToken: string): Promise<{ accessToken: string; expiresIn: number } | null> {
  return new Promise((resolve) => {
    const body = `grant_type=refresh_token&refresh_token=${encodeURIComponent(refreshToken)}&client_id=${OAUTH_CLIENT_ID}`;
    const url = new URL(OAUTH_TOKEN_URL);

    const req = https.request({
      hostname: url.hostname,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
      },
      timeout: REQUEST_TIMEOUT_MS,
    }, (res) => {
      let data = '';
      res.on('data', (chunk: string) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode !== 200) { resolve(null); return; }
        try {
          const parsed = JSON.parse(data);
          if (parsed.access_token) {
            resolve({ accessToken: parsed.access_token, expiresIn: parsed.expires_in || 28800 });
          } else {
            resolve(null);
          }
        } catch { resolve(null); }
      });
    });

    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.on('error', () => resolve(null));
    req.write(body);
    req.end();
  });
}

async function getAccessToken(): Promise<{ token: string; planName: string | null; refreshToken?: string } | null> {
  const keychain = readKeychainRaw();
  const file = await readFileCredentials();
  const source = keychain || file;
  if (!source?.accessToken) return null;

  const subscriptionType = keychain?.subscriptionType || file?.subscriptionType;
  const planName = getPlanName(subscriptionType);
  const refreshToken = keychain?.refreshToken || file?.refreshToken;

  return { token: source.accessToken, planName, refreshToken };
}

/** Try to refresh an expired token and update the keychain */
async function tryRefreshAndRetry(
  refreshToken: string,
  planName: string | null,
): Promise<QuotaData | null> {
  const refreshed = await refreshAccessToken(refreshToken);
  if (!refreshed) return null;

  // Update keychain with new token
  try {
    const raw = execFileSync(
      '/usr/bin/security',
      ['find-generic-password', '-s', 'Claude Code-credentials', '-w'],
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: KEYCHAIN_TIMEOUT_MS }
    ).trim();
    if (raw) {
      const creds = JSON.parse(raw);
      if (creds.claudeAiOauth) {
        creds.claudeAiOauth.accessToken = refreshed.accessToken;
        creds.claudeAiOauth.expiresAt = Date.now() + refreshed.expiresIn * 1000;

        // Find account name
        let account = 'claude';
        try {
          const info = execFileSync(
            '/usr/bin/security',
            ['find-generic-password', '-s', 'Claude Code-credentials'],
            { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: KEYCHAIN_TIMEOUT_MS }
          );
          const match = info.match(/"acct"<blob>="([^"]+)"/);
          if (match) account = match[1];
        } catch { /* use default */ }

        execFileSync('/usr/bin/security', [
          'add-generic-password', '-U', '-s', 'Claude Code-credentials',
          '-a', account, '-w', JSON.stringify(creds),
        ], { stdio: ['pipe', 'pipe', 'pipe'], timeout: KEYCHAIN_TIMEOUT_MS });
      }
    }
  } catch { /* non-fatal: token still works for this request */ }

  // Retry API call with fresh token
  const apiResult = await fetchUsageApi(refreshed.accessToken);
  if (apiResult.error) return null;

  return {
    fiveHour: parseUtilization(apiResult.data?.five_hour?.utilization),
    sevenDay: parseUtilization(apiResult.data?.seven_day?.utilization),
    fiveHourResetAt: parseDate(apiResult.data?.five_hour?.resets_at),
    sevenDayResetAt: parseDate(apiResult.data?.seven_day?.resets_at),
    planName,
  };
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

function fetchUsageApi(accessToken: string): Promise<{ data?: any; error?: string }> {
  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'api.anthropic.com',
      path: '/api/oauth/usage',
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'anthropic-beta': 'oauth-2025-04-20',
        'User-Agent': 'claude-office/2.0',
      },
      timeout: REQUEST_TIMEOUT_MS,
    }, (res) => {
      let body = '';
      res.on('data', (chunk: string) => { body += chunk; });
      res.on('end', () => {
        if (res.statusCode !== 200) { resolve({ error: `http-${res.statusCode}` }); return; }
        try { resolve({ data: JSON.parse(body) }); } catch { resolve({ error: 'parse' }); }
      });
    });
    req.on('timeout', () => { req.destroy(); resolve({ error: 'timeout' }); });
    req.on('error', () => resolve({ error: 'network' }));
    req.end();
  });
}

function parseUtilization(value: number | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.round(Math.max(0, Math.min(100, value)));
}

function parseDate(dateStr: string | undefined): Date | null {
  if (!dateStr) return null;
  const date = new Date(dateStr);
  return isNaN(date.getTime()) ? null : date;
}

// --- Main export ---

export async function getQuota(): Promise<QuotaData> {
  const cached = await readCache();
  if (cached) return cached;

  const creds = await getAccessToken();
  if (!creds) {
    const result: QuotaData = {
      fiveHour: null, sevenDay: null,
      fiveHourResetAt: null, sevenDayResetAt: null,
      planName: null, apiUnavailable: true, apiError: 'no-credentials',
    };
    await writeCache(result);
    return result;
  }

  // API users don't have quota limits
  if (!creds.planName) {
    const result: QuotaData = {
      fiveHour: null, sevenDay: null,
      fiveHourResetAt: null, sevenDayResetAt: null,
      planName: null,
    };
    await writeCache(result);
    return result;
  }

  const apiResult = await fetchUsageApi(creds.token);

  if (apiResult.error) {
    if (apiResult.error === 'http-401') {
      // Re-read keychain — Claude Code may have refreshed the token since our first read.
      // This handles the common case where our cached/initial read was stale but CC already
      // updated the keychain in the background (race condition with concurrent sessions).
      const freshCreds = await getAccessToken();
      if (freshCreds && freshCreds.token !== creds.token) {
        const retryResult = await fetchUsageApi(freshCreds.token);
        if (!retryResult.error) {
          const result: QuotaData = {
            fiveHour: parseUtilization(retryResult.data?.five_hour?.utilization),
            sevenDay: parseUtilization(retryResult.data?.seven_day?.utilization),
            fiveHourResetAt: parseDate(retryResult.data?.five_hour?.resets_at),
            sevenDayResetAt: parseDate(retryResult.data?.seven_day?.resets_at),
            planName: freshCreds.planName ?? creds.planName,
          };
          await writeCache(result);
          return result;
        }
      }

      // Last resort: try OAuth refresh flow
      const refreshToken = freshCreds?.refreshToken ?? creds.refreshToken;
      if (refreshToken) {
        const refreshed = await tryRefreshAndRetry(refreshToken, creds.planName);
        if (refreshed) {
          await writeCache(refreshed);
          return refreshed;
        }
      }
    }

    const result: QuotaData = {
      fiveHour: null, sevenDay: null,
      fiveHourResetAt: null, sevenDayResetAt: null,
      planName: creds.planName, apiUnavailable: true, apiError: apiResult.error,
    };
    await writeCache(result);
    return result;
  }

  const result: QuotaData = {
    fiveHour: parseUtilization(apiResult.data?.five_hour?.utilization),
    sevenDay: parseUtilization(apiResult.data?.seven_day?.utilization),
    fiveHourResetAt: parseDate(apiResult.data?.five_hour?.resets_at),
    sevenDayResetAt: parseDate(apiResult.data?.seven_day?.resets_at),
    planName: creds.planName,
  };

  await writeCache(result);
  return result;
}

/** @internal — exported for unit testing only */
export const _test = { getPlanName, parseUtilization, parseDate };
