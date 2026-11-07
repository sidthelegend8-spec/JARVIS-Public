/**
 * Computer Use entry point.
 *
 * Two backends sit behind one API:
 *   - browser actions run in-process through Playwright (always available)
 *   - screen, mouse and keyboard actions are forwarded to the Python sidecar
 *     (available once `computer_use` is set up)
 *
 * Callers ask for a capability and get an answer either way; when the sidecar
 * is absent the desktop actions fail with an explanation rather than silently
 * doing nothing.
 */
import * as browser from './browser';
import { record, getLog, clearLog } from './logger';

const SIDECAR_URL = process.env.COMPUTER_USE_URL || 'http://127.0.0.1:8765';
const SIDECAR_TIMEOUT = 30000;

export type DesktopStatus = { available: boolean; detail: string; version?: string };

let cachedStatus: DesktopStatus | null = null;
let cachedAt = 0;

async function sidecar(path: string, body?: unknown): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SIDECAR_TIMEOUT);
  try {
    const response = await fetch(`${SIDECAR_URL}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal
    });
    const text = await response.text();
    const parsed = text ? JSON.parse(text) : null;
    if (!response.ok) {
      throw new Error(parsed?.detail || parsed?.error || `sidecar ${path} failed (${response.status})`);
    }
    return parsed;
  } catch (e: any) {
    if (e?.name === 'AbortError') throw new Error(`Desktop action timed out after ${SIDECAR_TIMEOUT}ms`);
    if (e?.cause?.code === 'ECONNREFUSED' || /fetch failed/i.test(e?.message || '')) {
      throw new Error(
        'The desktop half of Computer Use is not running. Set up the Python sidecar (see computer_use/README.md) to control the screen, mouse and keyboard. Browser tasks work without it.'
      );
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/** Cached briefly so repeated tool calls do not each pay a connection attempt. */
export async function desktopStatus(force = false): Promise<DesktopStatus> {
  if (!force && cachedStatus && Date.now() - cachedAt < 15000) return cachedStatus;
  try {
    const data = await sidecar('/health');
    cachedStatus = { available: true, detail: 'Desktop control ready', version: data?.version };
  } catch (e: any) {
    cachedStatus = { available: false, detail: e?.message || 'Sidecar unreachable' };
  }
  cachedAt = Date.now();
  return cachedStatus;
}

export const desktop = {
  screenshot: () => sidecar('/screen/capture', {}),
  observe: (query?: string) => sidecar('/screen/observe', { query }),
  click: (payload: { x?: number; y?: number; target?: string; button?: string; clicks?: number }) =>
    sidecar('/mouse/click', payload),
  move: (payload: { x: number; y: number }) => sidecar('/mouse/move', payload),
  scroll: (payload: { direction: string; amount?: number }) => sidecar('/mouse/scroll', payload),
  drag: (payload: { fromX: number; fromY: number; toX: number; toY: number }) =>
    sidecar('/mouse/drag', payload),
  type: (payload: { text: string }) => sidecar('/keyboard/type', payload),
  hotkey: (payload: { keys: string[] }) => sidecar('/keyboard/hotkey', payload),
  launch: (payload: { name: string }) => sidecar('/app/launch', payload),
  windows: () => sidecar('/window/list'),
  focus: (payload: { title: string }) => sidecar('/window/focus', payload),
  runTask: (payload: { task: string; maxSteps?: number }) => sidecar('/task/run', payload)
};

export const web = browser;
export { record, getLog, clearLog };
