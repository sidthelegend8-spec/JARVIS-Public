/**
 * Action log for Computer Use. Every attempt is recorded whether it succeeds or
 * not — a failed click is more interesting than a successful one when working
 * out why a task stalled.
 */

export interface ActionLogEntry {
  id: number;
  timestamp: string;
  action: string;
  target?: string;
  coordinates?: { x: number; y: number };
  success: boolean;
  durationMs: number;
  detail?: string;
}

const MAX_ENTRIES = 500;

let counter = 0;
const entries: ActionLogEntry[] = [];

export function record(entry: Omit<ActionLogEntry, 'id' | 'timestamp'>): ActionLogEntry {
  const full: ActionLogEntry = {
    ...entry,
    id: ++counter,
    timestamp: new Date().toISOString()
  };
  entries.push(full);
  if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);

  const mark = full.success ? 'ok ' : 'ERR';
  console.log(`[computer-use] ${mark} ${full.action}${full.target ? ` "${full.target}"` : ''} (${full.durationMs}ms)`);
  return full;
}

/** Wrap an action so timing and outcome are captured without repeating boilerplate. */
export async function timed<T>(
  action: string,
  target: string | undefined,
  fn: () => Promise<T>
): Promise<T> {
  const started = Date.now();
  try {
    const result = await fn();
    record({ action, target, success: true, durationMs: Date.now() - started });
    return result;
  } catch (e: any) {
    record({
      action,
      target,
      success: false,
      durationMs: Date.now() - started,
      detail: e?.message || String(e)
    });
    throw e;
  }
}

export const getLog = (limit = 100): ActionLogEntry[] => entries.slice(-limit).reverse();

export const clearLog = () => {
  entries.length = 0;
};
