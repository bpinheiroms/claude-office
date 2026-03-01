export type AgentActivity = 'active' | 'idle' | 'sleeping';

/** Precise status derived from JSONL last message + mtime + live process */
export type AgentStatus =
  | { state: 'calling_tool'; toolName: string; toolDetail: string }
  | { state: 'thinking' }
  | { state: 'responding' }
  | { state: 'needs_response'; toolName: string }  // blocked: question or permission prompt pending
  | { state: 'waiting_input' }   // live process, turn ended, waiting for next message
  | { state: 'done' }            // turn ended, no live process
  | { state: 'idle' }
  | { state: 'sleeping' };

export interface ToolAction {
  name: string;      // "Bash", "Edit", "Read", "Write", "Grep", "Agent", etc.
  detail: string;    // file path, command snippet, etc.
  timestamp: Date;
}

export interface ContextUsage {
  inputTokens: number;       // total input tokens (incl cache)
  outputTokens: number;
  contextPercent: number;    // 0-100, based on 200k window
  model: string;
}

export interface AgentState {
  id: string;
  name: string;              // human-readable name (sub-agent team name or project name)
  project: string;
  cwd: string;
  gitBranch: string;
  summary: string;
  activity: AgentActivity;
  status: AgentStatus;
  context: ContextUsage | null;
  sessionName: string;       // zellij session name
  lastActive: Date;          // JSONL last modified time
  lastTool: ToolAction | null;
  recentTools: ToolAction[];
  isSubAgent: boolean;
  parentId: string | null;
  teamName: string | null;
  teamRole: string | null;
  subAgents: AgentState[];
  pid: number | null;
  elapsedSeconds: number;
}

export interface UsageSummary {
  today: TokenBucket;
  week: TokenBucket;
  month: TokenBucket;
  todayEstimatedCostUSD: number;
  weekEstimatedCostUSD: number;
  monthEstimatedCostUSD: number;
  plan: 'max' | 'pro' | 'free';
  planPriceUSD: number;
  billingCycleStart: Date;
}

export interface TokenBucket {
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
  messageCount: number;
}

export interface TeamInfo {
  name: string;
  description: string;
  members: { name: string; agentType: string; model: string; cwd: string }[];
}

export interface QuotaData {
  fiveHour: number | null;       // 0-100 utilization %
  sevenDay: number | null;       // 0-100 utilization %
  fiveHourResetAt: Date | null;
  sevenDayResetAt: Date | null;
  planName: string | null;       // 'Max', 'Pro', 'Team', null
  apiUnavailable?: boolean;
  apiError?: string;
}
