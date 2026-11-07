/**
 * Launch desktop applications by name.
 *
 * Installed locations are checked before falling back to the shell, because
 * `start spotify` on Windows will happily open a web page when the desktop app
 * is not where it was expected — and "open Spotify" means the application.
 */
import { spawn, execSync } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';

export interface AppTarget {
  id: string;
  label: string;
  /** Candidate executables, first match wins. */
  paths?: string[];
  /** Windows URI handler, used only if no executable is found. */
  protocol?: string;
  /** Store app id, launched via explorer.exe shell:AppsFolder. */
  appUserModelId?: string;
}

const LOCAL = process.env.LOCALAPPDATA || '';
const PROGRAMS = process.env.PROGRAMFILES || '';
const PROGRAMS_X86 = process.env['PROGRAMFILES(X86)'] || '';
const ROAMING = process.env.APPDATA || '';

export const APPS: AppTarget[] = [
  {
    id: 'spotify',
    label: 'Spotify',
    paths: [
      join(ROAMING, 'Spotify', 'Spotify.exe'),
      join(LOCAL, 'Microsoft', 'WindowsApps', 'Spotify.exe')
    ],
    appUserModelId: 'SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify',
    protocol: 'spotify:'
  },
  {
    id: 'chrome',
    label: 'Google Chrome',
    paths: [
      join(PROGRAMS, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      join(PROGRAMS_X86, 'Google', 'Chrome', 'Application', 'chrome.exe')
    ]
  },
  {
    id: 'opera',
    label: 'Opera',
    paths: [join(LOCAL, 'Programs', 'Opera', 'opera.exe')]
  },
  { id: 'notepad', label: 'Notepad', paths: ['notepad.exe'] },
  { id: 'calculator', label: 'Calculator', protocol: 'calculator:' },
  { id: 'explorer', label: 'File Explorer', paths: ['explorer.exe'] },
  { id: 'terminal', label: 'Windows Terminal', paths: [join(LOCAL, 'Microsoft', 'WindowsApps', 'wt.exe')] },
  { id: 'settings', label: 'Windows Settings', protocol: 'ms-settings:' },
  { id: 'discord', label: 'Discord', paths: [join(LOCAL, 'Discord', 'Update.exe')] },
  { id: 'vscode', label: 'Visual Studio Code', paths: [join(LOCAL, 'Programs', 'Microsoft VS Code', 'Code.exe')] }
];

const onPath = (exe: string): boolean => {
  if (exe.includes('\\')) return existsSync(exe);
  try {
    execSync(`where ${exe}`, { stdio: ['ignore', 'ignore', 'ignore'] });
    return true;
  } catch {
    return false;
  }
};

/** Resolve a spoken name to a known application. */
export function findApp(spoken: string): AppTarget | null {
  const needle = spoken.trim().toLowerCase().replace(/\.(exe|app)$/, '');
  if (!needle) return null;

  return (
    APPS.find((a) => a.id === needle) ||
    APPS.find((a) => a.label.toLowerCase() === needle) ||
    APPS.find((a) => a.label.toLowerCase().includes(needle) || needle.includes(a.id)) ||
    null
  );
}

export function installedApps(): { id: string; label: string; available: boolean }[] {
  return APPS.map((app) => ({
    id: app.id,
    label: app.label,
    available: Boolean(
      app.paths?.some((p) => onPath(p)) || app.protocol || app.appUserModelId
    )
  }));
}

export function launchApp(spoken: string): { launched: string; via: string } {
  const app = findApp(spoken);
  if (!app) {
    throw new Error(
      `I do not know an app called "${spoken}". Known: ${APPS.map((a) => a.label).join(', ')}.`
    );
  }

  // An installed executable is the most reliable route.
  const exe = app.paths?.find((p) => onPath(p));
  if (exe) {
    spawn(exe, [], { detached: true, stdio: 'ignore' }).unref();
    return { launched: app.label, via: 'executable' };
  }

  // Store apps have no plain executable; explorer resolves them by id.
  if (app.appUserModelId) {
    try {
      spawn('explorer.exe', [`shell:AppsFolder\\${app.appUserModelId}`], {
        detached: true,
        stdio: 'ignore'
      }).unref();
      return { launched: app.label, via: 'store app' };
    } catch {
      /* fall through to the protocol handler */
    }
  }

  if (app.protocol) {
    spawn('cmd', ['/c', 'start', '', app.protocol], { detached: true, stdio: 'ignore' }).unref();
    return { launched: app.label, via: 'protocol' };
  }

  throw new Error(`${app.label} does not appear to be installed.`);
}
