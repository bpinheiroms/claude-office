import { type AgentState, type AgentActivity, type AgentStatus, type ContextUsage, type ToolAction, type TeamInfo, type UsageSummary, type TokenBucket } from './types.js';
import { homedir } from 'os';
import { readFile, readdir, stat } from 'fs/promises';
import { join, basename } from 'path';

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const HOME = homedir();
const CLAUDE_DIR = join(HOME, '.claude');
const PROJECTS_DIR = join(CLAUDE_DIR, 'projects');
const TEAMS_DIR = join(CLAUDE_DIR, 'teams');

// --- Helpers ---

async function safeRead(path: string): Promise<string | null> {
  try { return await readFile(path, 'utf-8'); } catch { return null; }
}

async function safeStat(path: string): Promise<Date | null> {
  try { const s = await stat(path); return s.mtime; } catch { return null; }
}

async function safeReaddir(path: string): Promise<string[]> {
  try { return await readdir(path); } catch { return []; }
}

/** Returns a Set of project dir names that have a live Claude process */
async function discoverLiveProcesses(): Promise<Set<string>> {
  const live = new Set<string>();
  try {
    // Single ps -Eww call to get all claude processes with their environment
    const { stdout } = await execAsync("ps -Eww -o pid,comm,args 2>/dev/null | grep '[c]laude'", { encoding: 'utf-8', timeout: 3000 });
    const lines = stdout.trim().split('\n').filter(Boolean);
    for (const line of lines) {
      const pwdMatch = line.match(/PWD=([^\s]+)/);
      if (pwdMatch) {
        // Convert path to project dir format: /Users/x.y/z -> -Users-x-y-z
        // Claude encodes both / and . as - in project dir names
        const projDir = pwdMatch[1].replace(/[/.]/g, '-');
        live.add(projDir);
      }
    }
  } catch { /* skip - no claude processes or ps failed */ }
  return live;
}

function decodeProjectName(projDir: string): string {
  // Strip home directory prefix to get meaningful project name
  // e.g. -Users-bruno-silva-personal-claude-plugin-orquestration -> claude-plugin-orquestration
  const homeParts = HOME.replace(/[/.]/g, '-').replace(/^-/, '').split('-').filter(Boolean);
  const dirParts = projDir.replace(/^-/, '').split('-').filter(Boolean);

  // Remove matching home prefix
  let start = 0;
  for (const hp of homeParts) {
    if (start < dirParts.length && dirParts[start].toLowerCase() === hp.toLowerCase()) {
      start++;
    } else break;
  }

  // Skip common workspace directories
  const skipDirs = new Set(['personal', 'work', 'projects', 'documents', 'dev', 'repos', 'src', 'code', 'github', 'workspace']);
  while (start < dirParts.length - 1 && skipDirs.has(dirParts[start].toLowerCase())) {
    start++;
  }

  const meaningful = dirParts.slice(start);
  return meaningful.join('-') || dirParts[dirParts.length - 1] || projDir;
}

function classifyByMtime(mtime: Date): AgentActivity {
  const secs = (Date.now() - mtime.getTime()) / 1000;
  if (secs < 30) return 'active';
  if (secs < 300) return 'idle';
  return 'sleeping';
}

/** Returns true if the status represents active work (calling tool, thinking, responding) */
function isActiveStatus(status: AgentStatus): boolean {
  return status.state === 'calling_tool' || status.state === 'thinking' || status.state === 'responding';
}

function parseToolFromMessage(msg: any): ToolAction | null {
  const content = msg?.message?.content;
  if (!Array.isArray(content)) return null;
  for (const c of content) {
    if (c?.type === 'tool_use' && c.name) {
      let detail = '';
      const input = c.input;
      if (input) {
        if (input.file_path) detail = basename(input.file_path);
        else if (input.command) detail = input.command.slice(0, 60);
        else if (input.pattern) detail = input.pattern;
        else if (input.query) detail = input.query.slice(0, 60);
        else if (input.prompt) detail = input.prompt.slice(0, 60);
        else if (input.description) detail = input.description.slice(0, 60);
      }
      return { name: c.name, detail, timestamp: new Date(msg.timestamp || Date.now()) };
    }
  }
  return null;
}

async function readFirstLine(filePath: string): Promise<string | null> {
  try {
    const file = Bun.file(filePath);
    if (file.size === 0) return null;
    const slice = file.slice(0, Math.min(file.size, 2048));
    const text = await slice.text();
    const nl = text.indexOf('\n');
    return nl > 0 ? text.slice(0, nl) : text;
  } catch { return null; }
}

async function parseSubAgentName(jsonlPath: string): Promise<string | null> {
  const line = await readFirstLine(jsonlPath);
  if (!line) return null;
  try {
    const msg = JSON.parse(line);
    const content = msg.message?.content;
    const texts: string[] = [];
    if (Array.isArray(content)) {
      for (const c of content) texts.push(c.text || c.content || '');
    } else if (typeof content === 'string') {
      texts.push(content);
    }
    for (const text of texts) {
      // Primary: explicit name assignment
      const nameMatch = text.match(/Your name is "([^"]+)"/);
      if (nameMatch) return nameMatch[1];
    }
    // Fallback: use the teammate_id that spawned this sub-agent as context
    for (const text of texts) {
      const tmMatch = text.match(/teammate_id="([^"]+)"/);
      if (tmMatch) return `@${tmMatch[1]}`;
    }
  } catch { /* skip */ }
  return null;
}

async function readLastBytes(filePath: string, bytes: number): Promise<string[]> {
  try {
    const file = Bun.file(filePath);
    const size = file.size;
    if (size === 0) return [];
    const start = Math.max(0, size - bytes);
    const slice = file.slice(start, size);
    const text = await slice.text();
    const lines = text.split('\n').filter(Boolean);
    // If we started mid-line, drop the first partial line
    if (start > 0 && lines.length > 0) lines.shift();
    return lines;
  } catch { return []; }
}

async function parseAgentStatus(jsonlPath: string, mtime: Date, hasProcess: boolean): Promise<AgentStatus> {
  const ageSecs = (Date.now() - mtime.getTime()) / 1000;

  // Sessions without a live process: only check JSONL if recent (< 1h)
  // Sessions WITH a live process: always check JSONL (could be waiting for hours)
  if (!hasProcess && ageSecs > 3600) return { state: 'sleeping' };

  // Read last ~8KB to get the last few messages (turn_duration can be after large assistant msgs)
  const lines = await readLastBytes(jsonlPath, 8192);
  if (lines.length === 0) return ageSecs > 300 ? { state: 'sleeping' } : { state: 'idle' };

  // Interactive tools that require user response (question, permission, etc.)
  const INTERACTIVE_TOOLS = new Set(['AskUserQuestion', 'EnterPlanMode', 'ExitPlanMode']);

  // Find the last meaningful message (skip progress/file-history-snapshot)
  // Walking backward: first meaningful message determines the state
  let sawToolResult = false;

  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const msg = JSON.parse(lines[i]);
      const type = msg.type;
      const role = msg.message?.role;
      const content = msg.message?.content;

      // Skip non-meaningful types
      if (['progress', 'file-history-snapshot', 'hook_progress', 'bash_progress'].includes(type)) {
        continue;
      }

      // system + turn_duration = turn finished normally
      if (type === 'system' && msg.subtype === 'turn_duration') {
        return { state: 'waiting_input' };
      }

      // Track if we've seen a tool_result (means the tool already executed)
      if (type === 'user' && role === 'user' && Array.isArray(content)) {
        if (content.some((c: any) => c.type === 'tool_result')) {
          sawToolResult = true;
          return ageSecs > 120 ? { state: 'waiting_input' } : { state: 'thinking' };
        }
        // Any other user message = agent should be responding
        return ageSecs > 120 ? { state: 'waiting_input' } : { state: 'thinking' };
      }

      // assistant with tool_use
      if (type === 'assistant' && role === 'assistant' && Array.isArray(content)) {
        const toolUse = content.find((c: any) => c.type === 'tool_use');
        if (toolUse) {
          const toolName = toolUse.name || '';
          let detail = '';
          const input = toolUse.input;
          if (input) {
            if (input.file_path) detail = basename(input.file_path);
            else if (input.command) detail = input.command.slice(0, 50);
            else if (input.pattern) detail = input.pattern;
            else if (input.query) detail = input.query.slice(0, 50);
            else if (input.description) detail = input.description.slice(0, 50);
          }

          // Only truly interactive tools require user response
          // (AskUserQuestion = user must pick an option, permission prompts for any tool)
          const isInteractiveTool = INTERACTIVE_TOOLS.has(toolName);

          if (!sawToolResult) {
            // Interactive tool without result = always needs user response
            if (isInteractiveTool) {
              return { state: 'needs_response', toolName };
            }

            // Non-interactive tool without result: still executing
            // (could be slow bash, compacting conversation, large file read, etc.)
            // Only mark as needs_response if stale AND has live process
            // (permission prompt may be blocking)
            if (hasProcess && ageSecs > 60) {
              return { state: 'needs_response', toolName };
            }

            // Otherwise it's still working on the tool
            return { state: 'calling_tool', toolName, toolDetail: detail };
          }

          // Fresh tool call with result already present
          if (ageSecs <= 30) {
            return { state: 'calling_tool', toolName, toolDetail: detail };
          }

          // Old tool call with result = turn likely ended
          return { state: 'waiting_input' };
        }

        // assistant with text only
        const hasText = content.some((c: any) => c.type === 'text');
        if (hasText) {
          return ageSecs > 30 ? { state: 'waiting_input' } : { state: 'responding' };
        }
      }

    } catch { /* skip malformed lines */ }
  }

  // Fallback
  if (ageSecs > 300) return { state: 'sleeping' };
  return ageSecs < 30 ? { state: 'thinking' } : { state: 'idle' };
}

const CONTEXT_WINDOW = 200_000;

async function parseContextUsage(jsonlPath: string): Promise<ContextUsage | null> {
  // Usage is inside large assistant messages - need to scan more data.
  // Progressive reverse scan reading only NEW bytes each step.
  const steps = [8192, 32768, 131072];
  let lastEnd = 0; // tracks how many bytes from EOF we've already scanned

  for (const bytes of steps) {
    if (bytes <= lastEnd) continue; // already covered this range

    try {
      const file = Bun.file(jsonlPath);
      const size = file.size;
      if (size === 0) return null;

      const newStart = Math.max(0, size - bytes);
      const oldStart = Math.max(0, size - lastEnd);
      // Read only the new portion: [newStart, oldStart)
      if (newStart >= oldStart) { lastEnd = bytes; continue; }

      const slice = file.slice(newStart, oldStart);
      const text = await slice.text();
      const lines = text.split('\n').filter(Boolean);
      // If we started mid-line, drop the first partial line
      if (newStart > 0 && lines.length > 0) lines.shift();

      for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i];
        if (!line.includes('"input_tokens"')) continue;
        try {
          const msg = JSON.parse(line);
          const usage = msg.message?.usage;
          if (!usage) continue;
          const input = (usage.input_tokens || 0)
            + (usage.cache_creation_input_tokens || 0)
            + (usage.cache_read_input_tokens || 0);
          const output = usage.output_tokens || 0;
          const model = msg.message?.model || '';
          return {
            inputTokens: input,
            outputTokens: output,
            contextPercent: Math.min(100, Math.round((input / CONTEXT_WINDOW) * 100)),
            model,
          };
        } catch { /* skip */ }
      }

      lastEnd = bytes;
    } catch { /* skip */ }
  }
  return null;
}

async function getRecentTools(jsonlPath: string): Promise<ToolAction[]> {
  // Read last ~8KB instead of parsing the whole file
  const lines = await readLastBytes(jsonlPath, 8192);
  const tools: ToolAction[] = [];
  for (const line of lines) {
    try {
      const msg = JSON.parse(line);
      if (msg.message?.role === 'assistant') {
        const tool = parseToolFromMessage(msg);
        if (tool) tools.push(tool);
      }
    } catch { /* skip */ }
  }
  return tools.slice(-5);
}

// --- Session discovery ---

interface SessionInfo {
  projectDir: string;
  projectName: string;
  sessionId: string;
  jsonlPath: string;
  mtime: Date;
  gitBranch: string;
  summary: string;
}

async function discoverSessions(): Promise<SessionInfo[]> {
  const projectDirs = await safeReaddir(PROJECTS_DIR);
  const sessions: SessionInfo[] = [];

  await Promise.all(projectDirs.map(async (projDir) => {
    if (projDir === '-') return;
    const projPath = join(PROJECTS_DIR, projDir);

    const [indexContent, files] = await Promise.all([
      safeRead(join(projPath, 'sessions-index.json')),
      safeReaddir(projPath),
    ]);
    let gitBranch = '';
    let summary = '';
    let latestSessionId = '';

    if (indexContent) {
      try {
        const index = JSON.parse(indexContent);
        if (index.entries?.length) {
          // FIX 7: Use reduce instead of sort to find max by modified date
          const latest = index.entries.reduce((best: any, entry: any) =>
            !best || new Date(entry.modified).getTime() > new Date(best.modified).getTime() ? entry : best,
            null
          );
          if (latest) {
            gitBranch = latest.gitBranch || '';
            summary = latest.summary || '';
            latestSessionId = latest.sessionId || '';
          }
        }
      } catch { /* skip */ }
    }

    const jsonlFiles = files.filter(f => f.endsWith('.jsonl'));
    const projectName = decodeProjectName(projDir);

    // Parallelize stat calls across all jsonl files
    await Promise.all(jsonlFiles.map(async (f) => {
      const sessionId = f.replace('.jsonl', '');
      const jsonlPath = join(projPath, f);
      const mtime = await safeStat(jsonlPath);
      if (!mtime) return;

      sessions.push({
        projectDir: projDir,
        projectName,
        sessionId,
        jsonlPath,
        mtime,
        gitBranch: sessionId === latestSessionId ? gitBranch : '',
        summary: sessionId === latestSessionId ? summary : '',
      });
    }));
  }));

  return sessions;
}

// --- Sub-agent discovery ---

async function discoverSubAgents(parentJsonlPath: string, parentSessionId: string): Promise<AgentState[]> {
  const subDir = join(parentJsonlPath.replace('.jsonl', ''), 'subagents');
  const files = await safeReaddir(subDir);
  const subAgents: AgentState[] = [];

  await Promise.all(files.map(async (f) => {
    if (!f.endsWith('.jsonl')) return;
    const agentId = f.replace('.jsonl', '');
    const path = join(subDir, f);
    const mtime = await safeStat(path);
    if (!mtime) return;

    const activity = classifyByMtime(mtime);
    // Only read tools/status/name/context for active/idle sub-agents
    const [tools, status, agentName, context] = activity !== 'sleeping'
      ? await Promise.all([
          getRecentTools(path),
          parseAgentStatus(path, mtime, false),
          parseSubAgentName(path),
          parseContextUsage(path),
        ])
      : [[] as ToolAction[], { state: 'sleeping' } as AgentStatus, null, null];
    const lastTool = tools.length > 0 ? tools[tools.length - 1] : null;

    // Sub-agents don't have their own process — they either work or they're done.
    // Any non-active status means the sub-agent finished.
    let finalStatus = status;
    if (!isActiveStatus(finalStatus)) {
      finalStatus = { state: 'done' };
    }

    subAgents.push({
      id: agentId,
      name: agentName || agentId.slice(0, 12),
      project: '',
      cwd: '',
      gitBranch: '',
      summary: '',
      activity,
      status: finalStatus,
      context,
      sessionName: '',
      lastActive: mtime,
      lastTool,
      recentTools: tools,
      isSubAgent: true,
      parentId: parentSessionId,
      teamName: null,
      teamRole: null,
      subAgents: [],
      pid: null,
      elapsedSeconds: Math.floor((Date.now() - mtime.getTime()) / 1000),
    });
  }));

  return subAgents;
}

// --- Team discovery ---

async function discoverTeams(): Promise<TeamInfo[]> {
  const teamDirs = await safeReaddir(TEAMS_DIR);
  const teams: TeamInfo[] = [];

  for (const dir of teamDirs) {
    const configPath = join(TEAMS_DIR, dir, 'config.json');
    const content = await safeRead(configPath);
    if (!content) continue;
    try {
      const config = JSON.parse(content);
      teams.push({
        name: config.name || dir,
        description: config.description || '',
        members: (config.members || []).map((m: any) => ({
          name: m.name || '',
          agentType: m.agentType || '',
          model: m.model || '',
          cwd: m.cwd || '',
        })),
      });
    } catch { /* skip */ }
  }

  return teams;
}

// --- Main collector ---

export class Collector {
  private teams: TeamInfo[] = [];

  async collect(): Promise<AgentState[]> {
    const [sessions, teams, liveProcs] = await Promise.all([
      discoverSessions(),
      discoverTeams(),
      discoverLiveProcesses(),
    ]);

    this.teams = teams;

    // Only most recent session per project
    const byProject = new Map<string, SessionInfo>();
    for (const s of sessions) {
      const existing = byProject.get(s.projectDir);
      if (!existing || s.mtime > existing.mtime) {
        byProject.set(s.projectDir, s);
      }
    }

    const agents: AgentState[] = [];

    await Promise.all([...byProject.values()].map(async (session) => {
      let activity = classifyByMtime(session.mtime);
      const hasProcess = liveProcs.has(session.projectDir);

      // Always parse status to detect waiting_input even for "sleeping" sessions
      let status = await parseAgentStatus(session.jsonlPath, session.mtime, hasProcess);

      // waiting_input = turn ended normally → always treat as done
      if (status.state === 'waiting_input') {
        status = { state: 'done' };
      }

      // needs_response without a live process = done (session closed)
      if (status.state === 'needs_response' && !hasProcess) {
        status = { state: 'done' };
      }

      // Only needs_response gets promoted to the live list (has a pending question)
      if (status.state === 'needs_response' && activity === 'sleeping') {
        activity = 'idle';
      }

      // Only read tools/subagents/context for non-sleeping sessions (fast path)
      const [tools, subAgents, context] = activity !== 'sleeping'
        ? await Promise.all([
            getRecentTools(session.jsonlPath),
            discoverSubAgents(session.jsonlPath, session.sessionId),
            parseContextUsage(session.jsonlPath),
          ])
        : [[] as ToolAction[], [] as AgentState[], null];
      const lastTool = tools.length > 0 ? tools[tools.length - 1] : null;

      const cwdParts = session.projectDir.replace(/^-/, '/').replace(/-/g, '/');

      // Team membership
      let teamName: string | null = null;
      let teamRole: string | null = null;
      for (const team of teams) {
        for (const member of team.members) {
          if (member.cwd && session.projectDir.includes(basename(member.cwd))) {
            teamName = team.name;
            teamRole = member.agentType;
          }
        }
      }

      const activeSubAgents = subAgents.filter(s => s.activity !== 'sleeping');

      // Propagate sub-agent state to parent:
      // If any sub-agent is actively working, parent can't be "done" or "idle"
      const hasWorkingSubAgents = activeSubAgents.some(s => isActiveStatus(s.status));
      if (hasWorkingSubAgents && (status.state === 'done' || status.state === 'idle')) {
        status = { state: 'thinking' };
        activity = 'active';
      }

      agents.push({
        id: session.sessionId,
        name: session.projectName,
        project: session.projectName,
        cwd: cwdParts,
        gitBranch: session.gitBranch,
        summary: session.summary,
        activity,
        status,
        context,
        sessionName: '',
        lastActive: session.mtime,
        lastTool,
        recentTools: tools,
        isSubAgent: false,
        parentId: null,
        teamName,
        teamRole,
        subAgents: activeSubAgents,
        pid: null,
        elapsedSeconds: Math.floor((Date.now() - session.mtime.getTime()) / 1000),
      });
    }));

    // Sort: active first, then idle, then sleeping
    const order: Record<AgentActivity, number> = { active: 0, idle: 1, sleeping: 2 };
    agents.sort((a, b) => {
      const actDiff = order[a.activity] - order[b.activity];
      if (actDiff !== 0) return actDiff;
      return a.lastActive > b.lastActive ? -1 : 1;
    });

    return agents;
  }

  getTeams(): TeamInfo[] { return this.teams; }

  // --- Usage summary (runs less often, cached aggressively) ---

  private usageCache = new Map<string, { mtimeMs: number; bucket: TokenBucket }>();
  private lastUsage: UsageSummary | null = null;

  async collectUsage(): Promise<UsageSummary> {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekStart = getBillingCycleStart(now);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const today = emptyBucket();
    const week = emptyBucket();
    const month = emptyBucket();

    // Evict stale cache entries (files deleted or older than month boundary)
    const monthMs = monthStart.getTime();
    for (const [path, entry] of this.usageCache) {
      if (entry.mtimeMs < monthMs) {
        this.usageCache.delete(path);
      }
    }

    const projectDirs = await safeReaddir(PROJECTS_DIR);

    const addFile = async (filePath: string) => {
      const mtime = await safeStat(filePath);
      if (!mtime) return;

      // Skip files older than this month
      if (mtime < monthStart) return;

      const isToday = mtime >= todayStart;
      const isWeek = mtime >= weekStart;
      const mtimeMs = mtime.getTime();

      // Check cache
      const cached = this.usageCache.get(filePath);
      if (cached && cached.mtimeMs === mtimeMs) {
        if (isToday) addBucket(today, cached.bucket);
        if (isWeek) addBucket(week, cached.bucket);
        addBucket(month, cached.bucket);
        return;
      }

      // Parse file for usage data
      const bucket = await parseFileUsage(filePath);
      this.usageCache.set(filePath, { mtimeMs, bucket });

      if (isToday) addBucket(today, bucket);
      if (isWeek) addBucket(week, bucket);
      addBucket(month, bucket);
    };

    await Promise.all(projectDirs.map(async (projDir) => {
      if (projDir === '-') return;
      const projPath = join(PROJECTS_DIR, projDir);
      const files = await safeReaddir(projPath);

      await Promise.all(files.map(async (f) => {
        if (!f.endsWith('.jsonl')) return;
        const filePath = join(projPath, f);
        await addFile(filePath);

        // Also scan sub-agent files
        const subDir = join(projPath, f.replace('.jsonl', ''), 'subagents');
        const subFiles = await safeReaddir(subDir);
        await Promise.all(subFiles.map(async (sf) => {
          if (!sf.endsWith('.jsonl')) return;
          await addFile(join(subDir, sf));
        }));
      }));
    }));

    // Detect plan from settings
    const plan = await detectPlan();

    this.lastUsage = {
      today,
      week,
      month,
      todayEstimatedCostUSD: estimateCost(today),
      weekEstimatedCostUSD: estimateCost(week),
      monthEstimatedCostUSD: estimateCost(month),
      plan: plan.name,
      planPriceUSD: plan.price,
      billingCycleStart: weekStart,
    };
    return this.lastUsage;
  }

  getUsage(): UsageSummary | null { return this.lastUsage; }
}

function emptyBucket(): TokenBucket {
  return { inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0, messageCount: 0 };
}

function addBucket(target: TokenBucket, src: TokenBucket) {
  target.inputTokens += src.inputTokens;
  target.outputTokens += src.outputTokens;
  target.cacheWriteTokens += src.cacheWriteTokens;
  target.cacheReadTokens += src.cacheReadTokens;
  target.messageCount += src.messageCount;
}

/**
 * Claude MAX billing cycle resets every Friday at a specific hour (local time).
 * Returns the start of the current billing week.
 */
const BILLING_CYCLE_DAY = 5;   // Friday (0=Sun, 5=Fri)
const BILLING_CYCLE_HOUR = 14; // 14:00 local time

function getBillingCycleStart(now: Date): Date {
  const day = now.getDay();     // 0=Sun .. 6=Sat
  const hour = now.getHours();

  // How many days ago was the last billing reset?
  let daysBack = (day - BILLING_CYCLE_DAY + 7) % 7;
  // If today is the reset day but before the reset hour, go back a full week
  if (daysBack === 0 && hour < BILLING_CYCLE_HOUR) daysBack = 7;

  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysBack, BILLING_CYCLE_HOUR, 0, 0, 0);
  return start;
}

// Opus pricing per 1M tokens
const PRICE_INPUT = 15;
const PRICE_OUTPUT = 75;
const PRICE_CACHE_WRITE = 18.75;
const PRICE_CACHE_READ = 1.50;

async function detectPlan(): Promise<{ name: 'max' | 'pro' | 'free'; price: number }> {
  try {
    const settingsPath = join(CLAUDE_DIR, 'settings.json');
    const content = await safeRead(settingsPath);
    if (content) {
      const settings = JSON.parse(content);
      const model = settings.model || '';
      // Opus requires MAX ($200/mo), Sonnet works on Pro ($20/mo)
      if (model === 'opus') return { name: 'max', price: 200 };
      if (model === 'sonnet') return { name: 'pro', price: 20 };
    }
  } catch { /* fallback */ }
  return { name: 'pro', price: 20 };
}

function estimateCost(b: TokenBucket): number {
  return (
    (b.inputTokens / 1_000_000) * PRICE_INPUT +
    (b.outputTokens / 1_000_000) * PRICE_OUTPUT +
    (b.cacheWriteTokens / 1_000_000) * PRICE_CACHE_WRITE +
    (b.cacheReadTokens / 1_000_000) * PRICE_CACHE_READ
  );
}

async function parseFileUsage(filePath: string): Promise<TokenBucket> {
  const bucket = emptyBucket();
  try {
    const stream = Bun.file(filePath).stream();
    const decoder = new TextDecoder();
    let partial = '';

    for await (const chunk of stream) {
      const text = partial + decoder.decode(chunk, { stream: true });
      let start = 0;
      let nl = text.indexOf('\n', start);
      while (nl !== -1) {
        const line = text.substring(start, nl);
        start = nl + 1;

        if (line.includes('"usage"')) {
          try {
            const msg = JSON.parse(line);
            const usage = msg.message?.usage;
            if (usage) {
              bucket.inputTokens += usage.input_tokens || 0;
              bucket.outputTokens += usage.output_tokens || 0;
              bucket.cacheWriteTokens += usage.cache_creation_input_tokens || 0;
              bucket.cacheReadTokens += usage.cache_read_input_tokens || 0;
              bucket.messageCount++;
            }
          } catch { /* skip */ }
        }
        nl = text.indexOf('\n', start);
      }
      partial = text.substring(start);
    }

    // Handle last partial line
    if (partial.includes('"usage"')) {
      try {
        const msg = JSON.parse(partial);
        const usage = msg.message?.usage;
        if (usage) {
          bucket.inputTokens += usage.input_tokens || 0;
          bucket.outputTokens += usage.output_tokens || 0;
          bucket.cacheWriteTokens += usage.cache_creation_input_tokens || 0;
          bucket.cacheReadTokens += usage.cache_read_input_tokens || 0;
          bucket.messageCount++;
        }
      } catch { /* skip */ }
    }
  } catch { /* skip */ }
  return bucket;
}

export async function collectAgents(): Promise<AgentState[]> {
  return new Collector().collect();
}
