/**
 * Browser half of Computer Use.
 *
 * Driven through Playwright's DOM rather than by looking at pixels: on a web
 * page the accessibility tree already names every button, link and field, so
 * clicking "Continue" is an exact lookup instead of a guess from a screenshot.
 * Screen-level control is the Python sidecar's job, for the cases where there
 * is no DOM to read.
 *
 * playwright-core drives the browser already installed on the machine — no
 * bundled Chromium, so nothing is added to the installer and it really is the
 * user's own browser.
 */
import { chromium, Browser, BrowserContext, Page } from 'playwright-core';
import { execSync, spawn, ChildProcess } from 'child_process';
import { existsSync, readFileSync, mkdirSync, copyFileSync, cpSync, statSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createServer } from 'net';
import { timed, record } from './logger';

const NAV_TIMEOUT = 30000;
const ACTION_TIMEOUT = 12000;

let browser: Browser | null = null;
let context: BrowserContext | null = null;
let page: Page | null = null;

export interface UiElement {
  role: string;
  name: string;
  /** Selector Playwright can act on later. */
  ref: string;
  enabled: boolean;
}

/** Known sites get a direct search URL — far more reliable than driving their UI. */
const SEARCH_URLS: Record<string, (q: string) => string> = {
  google: (q) => `https://www.google.com/search?q=${encodeURIComponent(q)}`,
  youtube: (q) => `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`,
  github: (q) => `https://github.com/search?q=${encodeURIComponent(q)}&type=repositories`,
  yelp: (q) => `https://www.yelp.com/search?find_desc=${encodeURIComponent(q)}`,
  amazon: (q) => `https://www.amazon.com/s?k=${encodeURIComponent(q)}`,
  wikipedia: (q) => `https://en.wikipedia.org/w/index.php?search=${encodeURIComponent(q)}`,
  reddit: (q) => `https://www.reddit.com/search/?q=${encodeURIComponent(q)}`,
  stackoverflow: (q) => `https://stackoverflow.com/search?q=${encodeURIComponent(q)}`
};

export const knownSites = () => Object.keys(SEARCH_URLS);

const LAUNCH_ARGS = [
  '--start-maximized',
  // Playwright otherwise sets navigator.webdriver, which sites like Yelp use
  // to refuse the request outright.
  '--disable-blink-features=AutomationControlled'
];

/** Edge is never used, even when Windows reports it as the default. */
const isEdge = (path: string) => /msedge\.exe$/i.test(path);

/** Chromium-based browsers Playwright can drive through executablePath. */
const CANDIDATE_PATHS = [
  `${process.env.LOCALAPPDATA}\\Programs\\Opera\\opera.exe`,
  `${process.env.LOCALAPPDATA}\\Programs\\Opera GX\\opera.exe`,
  `${process.env.PROGRAMFILES}\\Opera\\opera.exe`,
  `${process.env.PROGRAMFILES}\\Google\\Chrome\\Application\\chrome.exe`,
  `${process.env['PROGRAMFILES(X86)']}\\Google\\Chrome\\Application\\chrome.exe`,
  `${process.env.PROGRAMFILES}\\BraveSoftware\\Brave-Browser\\Application\\brave.exe`,
  `${process.env.LOCALAPPDATA}\\Vivaldi\\Application\\vivaldi.exe`
];

/**
 * The browser Windows actually opens links with. Read from the shell
 * association rather than guessed, so "open the default browser" means the
 * user's choice — Opera here — and not whatever ships with the OS.
 */
function defaultBrowserPath(): string | null {
  if (process.platform !== 'win32') return null;
  try {
    const userChoice = execSync(
      'reg query "HKCU\\SOFTWARE\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\https\\UserChoice" /v ProgId',
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
    );
    const progId = userChoice.match(/ProgId\s+REG_SZ\s+(\S+)/i)?.[1];
    if (!progId) return null;

    const command = execSync(`reg query "HKCR\\${progId}\\shell\\open\\command" /ve`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    });
    const exe = command.match(/REG_SZ\s+"?([^"]+\.exe)"?/i)?.[1];
    return exe && existsSync(exe) ? exe : null;
  } catch {
    return null;
  }
}

/** Chosen once and reported, so the log says which browser was driven. */
function resolveExecutable(): { path: string; reason: string } | null {
  const preferred = defaultBrowserPath();
  if (preferred && !isEdge(preferred)) {
    return { path: preferred, reason: 'system default' };
  }
  if (preferred && isEdge(preferred)) {
    record({ action: 'browser_skip_edge', success: true, durationMs: 0, detail: preferred });
  }

  for (const candidate of CANDIDATE_PATHS) {
    if (candidate && !isEdge(candidate) && existsSync(candidate)) {
      return { path: candidate, reason: 'installed browser' };
    }
  }
  return null;
}

export interface BrowserProfile {
  browser: string;
  /** Chrome's directory name, e.g. "Profile 20". */
  directory: string;
  name: string;
  account?: string;
  userDataDir: string;
  executablePath: string;
}

const PROFILE_ROOTS: { browser: string; userDataDir: string; exeCandidates: string[] }[] = [
  {
    browser: 'chrome',
    userDataDir: `${process.env.LOCALAPPDATA}\\Google\\Chrome\\User Data`,
    exeCandidates: [
      `${process.env.PROGRAMFILES}\\Google\\Chrome\\Application\\chrome.exe`,
      `${process.env['PROGRAMFILES(X86)']}\\Google\\Chrome\\Application\\chrome.exe`
    ]
  },
  {
    browser: 'opera',
    userDataDir: `${process.env.APPDATA}\\Opera Software\\Opera Stable`,
    exeCandidates: [`${process.env.LOCALAPPDATA}\\Programs\\Opera\\opera.exe`]
  }
];

/**
 * Real browser profiles, so a session can carry the user's own logins,
 * cookies and bookmarks instead of starting signed out.
 */
export function listProfiles(): BrowserProfile[] {
  const out: BrowserProfile[] = [];

  for (const root of PROFILE_ROOTS) {
    const exe = root.exeCandidates.find((p) => p && existsSync(p));
    if (!exe || !existsSync(root.userDataDir)) continue;

    const localState = join(root.userDataDir, 'Local State');
    if (!existsSync(localState)) {
      out.push({
        browser: root.browser,
        directory: 'Default',
        name: 'Default',
        userDataDir: root.userDataDir,
        executablePath: exe
      });
      continue;
    }

    try {
      const parsed = JSON.parse(readFileSync(localState, 'utf8'));
      const cache = parsed?.profile?.info_cache || {};
      for (const [directory, info] of Object.entries<any>(cache)) {
        out.push({
          browser: root.browser,
          directory,
          name: info?.name || directory,
          account: info?.user_name || undefined,
          userDataDir: root.userDataDir,
          executablePath: exe
        });
      }
    } catch {
      /* unreadable Local State: skip this browser rather than fail the list */
    }
  }

  return out;
}

/** Chosen profile. Left null until the default is resolved on first use. */
let activeProfile: BrowserProfile | null = null;

/**
 * The profile matching the system default browser, preferred over any other.
 * This is what makes "open a tab" land in the browser the user actually uses,
 * already signed in.
 */
function defaultProfile(): BrowserProfile | null {
  const profiles = listProfiles();
  if (profiles.length === 0) return null;

  const preferredExe = defaultBrowserPath();
  if (preferredExe && !isEdge(preferredExe)) {
    const match = profiles.find(
      (p) => p.executablePath.toLowerCase() === preferredExe.toLowerCase()
    );
    if (match) return match;
  }
  // No usable default: any real profile beats a signed-out throwaway.
  return profiles[0];
}

export const getActiveProfile = () => activeProfile;

export async function useProfile(browserName: string, directory: string): Promise<BrowserProfile> {
  const match = listProfiles().find(
    (p) => p.browser === browserName.toLowerCase() && p.directory === directory
  );
  if (!match) throw new Error(`No ${browserName} profile named "${directory}"`);

  // The profile directory is locked by a running browser, so switching means
  // starting over.
  await closeBrowser();
  activeProfile = match;
  record({ action: 'browser_profile', target: `${match.browser}/${match.name}`, success: true, durationMs: 0 });
  return match;
}

export async function clearProfile(): Promise<void> {
  await closeBrowser();
  activeProfile = null;
}

const PROFILE_LAUNCH_TIMEOUT = 45000;

let spawnedBrowser: ChildProcess | null = null;

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.unref();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => resolve(port));
    });
  });
}

async function waitForCdp(port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('timeout');
}

const processName = (browserName: string) => (browserName === 'chrome' ? 'chrome' : 'opera');

function isRunning(browserName: string): boolean {
  try {
    const out = execSync(`tasklist /FI "IMAGENAME eq ${processName(browserName)}.exe" /NH`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    });
    return new RegExp(`${processName(browserName)}\\.exe`, 'i').test(out);
  } catch {
    return false;
  }
}

const WORK_ROOT = join(process.env.JARVIS_DATA_DIR || tmpdir(), 'jarvis-browser-profiles');

/** Session state worth carrying: logins, cookies, saved sites, preferences. */
const PROFILE_FILES = [
  'Cookies',
  'Cookies-journal',
  'Login Data',
  'Login Data-journal',
  'Web Data',
  'Web Data-journal',
  'Preferences',
  'Secure Preferences',
  'Bookmarks',
  'History',
  'Favicons'
];
const PROFILE_DIRS = ['Network', 'Local Storage', 'Session Storage', 'IndexedDB'];

/**
 * Chrome 136 and later refuse to open a debugging port when the browser is
 * running on its default user-data directory — a deliberate defence against
 * cookie theft over CDP. There is no flag to opt out.
 *
 * The way round it is a separate user-data directory, which is allowed. The
 * real profile's session state is copied into a working directory once, so the
 * browser starts already signed in without ever driving the original profile.
 * Caches are left behind: they are large and worthless here.
 */
function seedWorkingProfile(profile: BrowserProfile): string {
  const dest = join(WORK_ROOT, `${profile.browser}-${profile.directory}`.replace(/\s+/g, '-'));
  const destProfile = join(dest, 'Default');

  // Seeded once; afterwards the copy keeps its own evolving session.
  if (existsSync(join(destProfile, 'Preferences'))) return dest;

  mkdirSync(destProfile, { recursive: true });

  const sourceRoot = profile.userDataDir;
  const sourceProfile = join(sourceRoot, profile.directory);

  // Local State holds the key that decrypts the cookie store; without it the
  // copied cookies are unreadable and the session lands signed out.
  const localState = join(sourceRoot, 'Local State');
  if (existsSync(localState)) copyFileSync(localState, join(dest, 'Local State'));

  for (const name of PROFILE_FILES) {
    const from = join(sourceProfile, name);
    if (existsSync(from)) {
      try {
        copyFileSync(from, join(destProfile, name));
      } catch {
        /* locked or vanished; the rest is still worth having */
      }
    }
  }

  for (const name of PROFILE_DIRS) {
    const from = join(sourceProfile, name);
    if (existsSync(from) && statSync(from).isDirectory()) {
      try {
        cpSync(from, join(destProfile, name), { recursive: true, force: true });
      } catch {
        /* best effort */
      }
    }
  }

  record({
    action: 'browser_profile_seeded',
    target: `${profile.browser}/${profile.name}`,
    success: true,
    durationMs: 0,
    detail: dest
  });
  return dest;
}

/**
 * Launch the user's browser on a working copy of their profile, then attach
 * over CDP. The copy is what makes both the debugging port and the signed-in
 * session possible at the same time.
 */
async function launchWithProfile(profile: BrowserProfile): Promise<BrowserContext> {
  const userDataDir = seedWorkingProfile(profile);
  const port = await freePort();

  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    '--profile-directory=Default',
    '--no-first-run',
    '--no-default-browser-check',
    ...LAUNCH_ARGS
  ];

  spawnedBrowser = spawn(profile.executablePath, args, { detached: true, stdio: 'ignore' });
  spawnedBrowser.unref();

  try {
    await waitForCdp(port, PROFILE_LAUNCH_TIMEOUT);
  } catch {
    const alsoRunning = isRunning(profile.browser)
      ? ` A ${profile.browser} window is open; close every one of them and try again.`
      : '';
    throw new Error(
      `${profile.browser} did not expose a debugging port within ${PROFILE_LAUNCH_TIMEOUT / 1000}s.${alsoRunning}`
    );
  }

  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const contexts = browser.contexts();
  const attached = contexts.length > 0 ? contexts[0] : await browser.newContext();

  record({
    action: 'browser_attached',
    target: `${profile.browser}/${profile.name}`,
    success: true,
    durationMs: 0,
    detail: `cdp:${port}`
  });
  return attached;
}

async function launch(): Promise<Browser> {
  const resolved = resolveExecutable();

  if (resolved) {
    try {
      record({
        action: 'browser_select',
        target: resolved.path,
        success: true,
        durationMs: 0,
        detail: resolved.reason
      });
      return await chromium.launch({
        executablePath: resolved.path,
        headless: false,
        args: LAUNCH_ARGS
      });
    } catch (e) {
      record({
        action: 'browser_launch_failed',
        target: resolved.path,
        success: false,
        durationMs: 0,
        detail: (e as any)?.message || String(e)
      });
    }
  }

  // Last resort: Playwright's Chrome channel. Edge is deliberately not tried.
  try {
    return await chromium.launch({ channel: 'chrome', headless: false, args: LAUNCH_ARGS });
  } catch (e) {
    throw new Error(
      'Could not start a browser. Install Opera, Chrome, Brave or Vivaldi. ' +
        `Microsoft Edge is deliberately not used. (${(e as any)?.message || e})`
    );
  }
}

export async function ensurePage(): Promise<Page> {
  if (page && !page.isClosed()) return page;

  if (!context) {
    // Default to the user's real profile rather than a throwaway one. A fresh
    // profile is signed out of everything, which is both useless for real
    // browsing and the reason sites flag the session as a bot.
    const profile = activeProfile ?? defaultProfile();

    if (profile) {
      activeProfile = profile;
      context = await launchWithProfile(profile);
      const existing = context.pages();
      page = existing.length > 0 ? existing[existing.length - 1] : await context.newPage();
    } else {
      browser = await launch();
      context = await browser.newContext({ viewport: null });
    }
    context.setDefaultTimeout(ACTION_TIMEOUT);
    context.setDefaultNavigationTimeout(NAV_TIMEOUT);
  }

  if (!page || page.isClosed()) page = await context.newPage();
  return page;
}

/**
 * The page, but only if one is genuinely open.
 *
 * Reading actions use this rather than ensurePage so that asking "what am I
 * looking at" never silently opens an empty browser and then reports that it
 * is empty — which is exactly what it used to do.
 */
function requirePage(): Page {
  if (!page || page.isClosed()) {
    throw new Error(
      'No page is open in the browser I control. I can only read pages I opened myself — for what is on your actual screen, use the desktop screen tools.'
    );
  }
  return page;
}

export const isOpen = () => Boolean(page && !page.isClosed());

export async function closeBrowser(): Promise<void> {
  try {
    // Attached over CDP, this only drops the connection — the browser we
    // spawned is stopped separately below.
    if (browser) await browser.close();
    else await context?.close();
  } catch {
    /* already gone */
  }

  if (spawnedBrowser && !spawnedBrowser.killed) {
    try {
      spawnedBrowser.kill();
    } catch {
      /* already exited */
    }
  }

  spawnedBrowser = null;
  browser = null;
  context = null;
  page = null;
}

export async function openUrl(rawUrl: string) {
  const url = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
  return timed('open_url', url, async () => {
    const p = await ensurePage();
    await p.goto(url, { waitUntil: 'domcontentloaded' });
    return { url: p.url(), title: await p.title() };
  });
}

export async function searchSite(site: string, query: string) {
  const key = site.trim().toLowerCase().replace(/\.(com|org)$/, '');
  const build = SEARCH_URLS[key];
  if (!build) {
    // Unknown site: fall back to a web search naming it, which usually lands
    // on the right page anyway.
    return openUrl(SEARCH_URLS.google(`${site} ${query}`));
  }
  return timed('search_site', `${key}: ${query}`, async () => {
    const p = await ensurePage();
    try {
      await p.goto(build(query), { waitUntil: 'domcontentloaded' });
    } catch (e: any) {
      // Some sites refuse automated requests outright. Reaching the results
      // through a web search is better than reporting failure.
      record({
        action: 'search_site_blocked',
        target: key,
        success: false,
        durationMs: 0,
        detail: e?.message || 'navigation refused'
      });
      // The failed load leaves the tab on chrome-error://. Navigating off it
      // races with the error commit and is reported as an interrupted
      // navigation, so the errored tab is discarded and a clean one opened.
      try {
        await p.close();
      } catch {
        /* already gone */
      }
      page = null;

      const fresh = await ensurePage();
      await fresh.goto(SEARCH_URLS.google(`${key} ${query}`), { waitUntil: 'domcontentloaded' });
      return {
        url: fresh.url(),
        title: await fresh.title(),
        viaFallback: true,
        note: `${key} refused an automated visit; showing web results for it instead.`
      };
    }
    return { url: p.url(), title: await p.title() };
  });
}

/**
 * Structured view of what is on the page — the planner works from this rather
 * than from raw pixels.
 */
export async function describePage(limit = 60): Promise<{ url: string; title: string; elements: UiElement[] }> {
  const p = requirePage();
  const elements = await p.evaluate((max: number) => {
    const out: { role: string; name: string; ref: string; enabled: boolean }[] = [];
    const seen = new Set<string>();

    const visible = (el: Element) => {
      const rect = el.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) return false;
      const style = window.getComputedStyle(el);
      return style.visibility !== 'hidden' && style.display !== 'none' && style.opacity !== '0';
    };

    const label = (el: Element): string => {
      const aria = el.getAttribute('aria-label');
      if (aria) return aria.trim();
      const placeholder = el.getAttribute('placeholder');
      if (placeholder) return placeholder.trim();
      const title = el.getAttribute('title');
      if (title) return title.trim();
      const text = (el as HTMLElement).innerText || el.textContent || '';
      return text.trim().replace(/\s+/g, ' ').slice(0, 80);
    };

    const roleOf = (el: Element): string => {
      const explicit = el.getAttribute('role');
      if (explicit) return explicit;
      const tag = el.tagName.toLowerCase();
      if (tag === 'a') return 'link';
      if (tag === 'button') return 'button';
      if (tag === 'select') return 'combobox';
      if (tag === 'textarea') return 'textbox';
      if (tag === 'input') {
        const type = (el as HTMLInputElement).type;
        if (type === 'submit' || type === 'button') return 'button';
        if (type === 'checkbox') return 'checkbox';
        if (type === 'radio') return 'radio';
        return 'textbox';
      }
      return tag;
    };

    const selector = 'a[href], button, input, textarea, select, [role="button"], [role="link"], [role="tab"], [role="menuitem"], [role="textbox"], [role="combobox"]';
    for (const el of Array.from(document.querySelectorAll(selector))) {
      if (out.length >= max) break;
      if (!visible(el)) continue;

      const name = label(el);
      if (!name) continue;

      const role = roleOf(el);
      const key = `${role}:${name}`;
      if (seen.has(key)) continue;
      seen.add(key);

      out.push({
        role,
        name,
        ref: key,
        enabled: !(el as HTMLInputElement).disabled
      });
    }
    return out;
  }, limit);

  return { url: p.url(), title: await p.title(), elements };
}

/**
 * Click by visible name. Several strategies are tried in order of precision,
 * because "Continue" might be a button, a link, or a div someone made
 * clickable.
 */
export async function clickTarget(target: string) {
  return timed('click', target, async () => {
    const p = await ensurePage();

    const candidates = [
      p.getByRole('button', { name: target, exact: false }),
      p.getByRole('link', { name: target, exact: false }),
      p.getByRole('tab', { name: target, exact: false }),
      p.getByRole('menuitem', { name: target, exact: false }),
      p.getByPlaceholder(target, { exact: false }),
      p.getByText(target, { exact: false })
    ];

    for (const locator of candidates) {
      try {
        const first = locator.first();
        if ((await first.count()) === 0) continue;
        await first.scrollIntoViewIfNeeded({ timeout: 3000 });
        const box = await first.boundingBox();
        await first.click({ timeout: ACTION_TIMEOUT });
        if (box) {
          record({
            action: 'click_resolved',
            target,
            coordinates: { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) },
            success: true,
            durationMs: 0
          });
        }
        await p.waitForLoadState('domcontentloaded', { timeout: 8000 }).catch(() => {});
        return { url: p.url(), title: await p.title() };
      } catch {
        /* try the next strategy */
      }
    }

    throw new Error(`Nothing clickable matching "${target}". Use read_page to see what is available.`);
  });
}

export async function fillField(field: string, value: string, submit = false) {
  return timed('fill', `${field} = ${value}`, async () => {
    const p = await ensurePage();

    const candidates = [
      p.getByRole('textbox', { name: field, exact: false }),
      p.getByPlaceholder(field, { exact: false }),
      p.getByLabel(field, { exact: false }),
      // Last resort: the page's main search box, whatever it is called.
      p.locator('input[type="search"], input[name*="q" i], input[type="text"]').first()
    ];

    for (const locator of candidates) {
      try {
        const first = locator.first();
        if ((await first.count()) === 0) continue;
        await first.scrollIntoViewIfNeeded({ timeout: 3000 });
        await first.fill(value, { timeout: ACTION_TIMEOUT });
        if (submit) {
          await first.press('Enter');
          await p.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});
        }
        return { url: p.url(), title: await p.title() };
      } catch {
        /* try the next strategy */
      }
    }

    throw new Error(`No input matching "${field}". Use read_page to see what is available.`);
  });
}

export async function readPage(maxChars = 6000) {
  return timed('read_page', undefined, async () => {
    const p = requirePage();
    const text = await p.evaluate(() => {
      // Strip the furniture so the model reads content, not navigation.
      const drop = document.querySelectorAll('script, style, noscript, svg, nav, footer, header');
      drop.forEach((el) => el.remove());
      const main = document.querySelector('main, article, [role="main"]') || document.body;
      return (main as HTMLElement).innerText.replace(/\n{3,}/g, '\n\n').trim();
    });
    return {
      url: p.url(),
      title: await p.title(),
      text: text.length > maxChars ? `${text.slice(0, maxChars)}\n…[truncated]` : text
    };
  });
}

export async function scrollPage(direction: 'up' | 'down', amount = 1) {
  return timed('scroll', direction, async () => {
    const p = await ensurePage();
    const delta = (direction === 'down' ? 1 : -1) * amount * 600;
    await p.mouse.wheel(0, delta);
    await p.waitForTimeout(400);
    return { url: p.url() };
  });
}

export async function pressKeys(keys: string) {
  return timed('press', keys, async () => {
    const p = await ensurePage();
    await p.keyboard.press(keys);
    return { url: p.url() };
  });
}

export async function screenshotPage(): Promise<string> {
  return timed('screenshot', undefined, async () => {
    const p = await ensurePage();
    const buffer = await p.screenshot({ type: 'jpeg', quality: 60, fullPage: false });
    return buffer.toString('base64');
  });
}
