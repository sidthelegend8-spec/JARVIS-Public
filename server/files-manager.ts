/**
 * File access for J.A.R.V.I.S.
 *
 * Two rules shape everything here:
 *
 *  1. Reading and creating are allowed; deleting and moving are not — except
 *     for files J.A.R.V.I.S. created itself. Authorship is tracked in a ledger
 *     rather than inferred, so a file the user made can never be mistaken for
 *     one the assistant owns.
 *  2. Reading reaches across the machine, because "what files do I have" is
 *     not answerable from one folder. Writing stays inside the user's home
 *     directory, and credential stores and system folders are refused for
 *     both. Paths are resolved before any check, so "../" cannot slip past.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  statSync,
  renameSync,
  unlinkSync
} from 'fs';
import { join, resolve, relative, dirname, extname, basename, isAbsolute } from 'path';
import { homedir } from 'os';

export interface FileEntry {
  name: string;
  path: string;
  size: number;
  modified: string;
  isDirectory: boolean;
  /** True when J.A.R.V.I.S. created it, so it may also be moved or deleted. */
  owned: boolean;
}

const HOME = homedir();

const WORKSPACE =
  process.env.JARVIS_WORKSPACE || join(HOME, 'Documents', 'JARVIS');

/** Documents J.A.R.V.I.S. produces land here, where the user will look for them. */
export const PDF_DIR = process.env.JARVIS_PDF_DIR || join(HOME, 'Downloads');

const LEDGER = () => join(WORKSPACE, '.jarvis-created.json');

/** Places worth offering when the user says "my files". */
export const COMMON_FOLDERS: Record<string, string> = {
  downloads: join(HOME, 'Downloads'),
  documents: join(HOME, 'Documents'),
  desktop: join(HOME, 'Desktop'),
  pictures: join(HOME, 'Pictures'),
  music: join(HOME, 'Music'),
  videos: join(HOME, 'Videos'),
  workspace: WORKSPACE,
  home: HOME
};

/**
 * Reading is open across the machine, because "what files do I have" is not a
 * useful question if it can only see one folder. These paths are the
 * exception: they hold credentials and machine internals rather than the
 * user's own documents, and nothing is gained by reading them aloud.
 */
const DENIED = [
  join(HOME, 'AppData'),
  join(HOME, '.ssh'),
  join(HOME, '.aws'),
  join(HOME, '.gnupg'),
  join(HOME, '.config', 'gcloud'),
  process.env.WINDIR || 'C:\\Windows',
  process.env.PROGRAMFILES || 'C:\\Program Files',
  process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)',
  process.env.PROGRAMDATA || 'C:\\ProgramData'
].filter(Boolean);

const within = (parent: string, child: string) => {
  const rel = relative(resolve(parent), resolve(child));
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
};

const isDenied = (absolute: string) => DENIED.some((deny) => within(deny, absolute));

/** Expand "downloads", "my desktop" and similar into a real path. */
function expandFolder(input: string): string | null {
  const key = input.trim().toLowerCase().replace(/^(my|the)\s+/, '').replace(/[\\/]+$/, '');
  return COMMON_FOLDERS[key] ?? null;
}

/** Text-ish files that are safe to read back as characters. */
const READABLE = new Set([
  '.txt', '.md', '.markdown', '.json', '.csv', '.tsv', '.log', '.xml', '.yaml', '.yml',
  '.html', '.htm', '.css', '.js', '.ts', '.jsx', '.tsx', '.py', '.java', '.c', '.cpp',
  '.h', '.rs', '.go', '.rb', '.sh', '.ps1', '.ini', '.cfg', '.toml', '.sql', '.env'
]);

const MAX_READ_CHARS = 20000;

export function workspace(): string {
  if (!existsSync(WORKSPACE)) mkdirSync(WORKSPACE, { recursive: true });
  return WORKSPACE;
}

/**
 * Resolve a path for reading. Folder names like "downloads" are accepted, as
 * are absolute paths and paths relative to the workspace. Only the credential
 * and system paths above are refused.
 */
export function readPath(input: string): string {
  const named = expandFolder(input);
  const candidate = named
    ? resolve(named)
    : isAbsolute(input)
      ? resolve(input)
      : resolve(workspace(), input);

  if (isDenied(candidate)) {
    throw new Error(
      `"${input}" is off limits — it holds credentials or system files rather than your documents.`
    );
  }
  return candidate;
}

/**
 * Resolve a path for writing. Confined to the user's own home directory, so a
 * mistaken path cannot land in a system folder.
 */
export function writePath(input: string): string {
  const named = expandFolder(input);
  const candidate = named
    ? resolve(named)
    : isAbsolute(input)
      ? resolve(input)
      : resolve(workspace(), input);

  if (isDenied(candidate) || !within(HOME, candidate)) {
    throw new Error(
      `Refusing to write to "${input}". J.A.R.V.I.S. only writes inside your user folder.`
    );
  }
  return candidate;
}

/** Kept for callers that still expect the old name. */
export const safePath = writePath;

// --- ownership ledger -------------------------------------------------------

function readLedger(): Set<string> {
  try {
    const raw = readFileSync(LEDGER(), 'utf8').replace(/^﻿/, '');
    const parsed = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Set();
  }
}

function writeLedger(paths: Set<string>): void {
  try {
    writeFileSync(LEDGER(), JSON.stringify([...paths], null, 2), 'utf8');
  } catch (e) {
    console.error('[files] could not update the ownership ledger:', e);
  }
}

/**
 * Ledger key. Absolute and normalised, because created files now land outside
 * the workspace too — a PDF in Downloads has to be recognised as owned.
 */
const key = (absolute: string) => resolve(absolute).replace(/\\/g, '/').toLowerCase();

/** Shown to the user: short inside the workspace, full path elsewhere. */
const display = (absolute: string) => {
  const rel = relative(workspace(), absolute);
  return !rel.startsWith('..') && !isAbsolute(rel) ? rel.replace(/\\/g, '/') : absolute;
};

function claim(absolute: string): void {
  const ledger = readLedger();
  ledger.add(key(absolute));
  writeLedger(ledger);
}

function release(absolute: string): void {
  const ledger = readLedger();
  ledger.delete(key(absolute));
  writeLedger(ledger);
}

export const isOwned = (absolute: string): boolean => readLedger().has(key(absolute));

/** Refuse anything destructive on a file the user made. */
function requireOwned(absolute: string, action: string): void {
  if (!isOwned(absolute)) {
    throw new Error(
      `Refusing to ${action} "${basename(absolute)}" — J.A.R.V.I.S. did not create it. ` +
        'Only files it made itself can be moved or deleted.'
    );
  }
}

// --- reading ----------------------------------------------------------------

export function list(dir = '.'): { path: string; entries: FileEntry[] } {
  const target = readPath(dir);
  if (!existsSync(target)) return { path: target, entries: [] };

  const entries = readdirSync(target)
    .filter((name) => name !== '.jarvis-created.json')
    .map((name) => {
      const full = join(target, name);
      const stat = statSync(full);
      return {
        name,
        path: display(full),
        size: stat.size,
        modified: stat.mtime.toISOString(),
        isDirectory: stat.isDirectory(),
        owned: isOwned(full)
      };
    })
    .sort((a, b) => Number(b.isDirectory) - Number(a.isDirectory) || a.name.localeCompare(b.name));

  return { path: target, entries };
}

export function read(path: string): { path: string; text: string; truncated: boolean } {
  const target = readPath(path);
  if (!existsSync(target)) throw new Error(`No such file: ${path}`);
  if (statSync(target).isDirectory()) throw new Error(`"${path}" is a folder, not a file.`);

  const ext = extname(target).toLowerCase();
  if (!READABLE.has(ext)) {
    throw new Error(
      `Cannot read ${ext || 'that file type'} as text. Readable types: ${[...READABLE].slice(0, 12).join(', ')}…`
    );
  }

  const text = readFileSync(target, 'utf8');
  return {
    path: display(target),
    text: text.length > MAX_READ_CHARS ? `${text.slice(0, MAX_READ_CHARS)}\n…[truncated]` : text,
    truncated: text.length > MAX_READ_CHARS
  };
}

export function search(query: string, dir = '.'): FileEntry[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];

  const hits: FileEntry[] = [];
  const walk = (current: string, depth: number) => {
    if (depth > 4 || hits.length >= 50) return;
    let names: string[];
    try {
      names = readdirSync(current);
    } catch {
      return;
    }
    for (const name of names) {
      if (name === '.jarvis-created.json') continue;
      const full = join(current, name);
      let stat;
      try {
        stat = statSync(full);
      } catch {
        continue;
      }
      if (name.toLowerCase().includes(needle)) {
        hits.push({
          name,
          path: display(full),
          size: stat.size,
          modified: stat.mtime.toISOString(),
          isDirectory: stat.isDirectory(),
          owned: isOwned(full)
        });
      }
      if (stat.isDirectory()) walk(full, depth + 1);
    }
  };

  walk(readPath(dir), 0);
  return hits;
}

// --- writing ----------------------------------------------------------------

export function writeText(path: string, content: string): FileEntry {
  const target = safePath(path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content, 'utf8');
  claim(target);

  const stat = statSync(target);
  return {
    name: basename(target),
    path: display(target),
    size: stat.size,
    modified: stat.mtime.toISOString(),
    isDirectory: false,
    owned: true
  };
}

/**
 * Rename in place. Allowed on any file — it is reversible and does not move
 * anything out of reach — but the ledger follows the file so ownership is not
 * lost or accidentally gained.
 */
export function rename(path: string, newName: string): FileEntry {
  const target = safePath(path);
  if (!existsSync(target)) throw new Error(`No such file: ${path}`);
  if (/[\\/]/.test(newName)) {
    throw new Error('A new name cannot contain a path. Use move for that.');
  }

  const destination = join(dirname(target), newName);
  if (existsSync(destination)) throw new Error(`"${newName}" already exists.`);

  const wasOwned = isOwned(target);
  renameSync(target, destination);
  if (wasOwned) {
    release(target);
    claim(destination);
  }

  const stat = statSync(destination);
  return {
    name: newName,
    path: display(destination),
    size: stat.size,
    modified: stat.mtime.toISOString(),
    isDirectory: stat.isDirectory(),
    owned: wasOwned
  };
}

export function move(path: string, destinationDir: string): FileEntry {
  const target = safePath(path);
  if (!existsSync(target)) throw new Error(`No such file: ${path}`);
  requireOwned(target, 'move');

  const dir = safePath(destinationDir);
  mkdirSync(dir, { recursive: true });
  const destination = join(dir, basename(target));
  if (existsSync(destination)) throw new Error(`Something already exists at ${display(destination)}.`);

  renameSync(target, destination);
  release(target);
  claim(destination);

  const stat = statSync(destination);
  return {
    name: basename(destination),
    path: display(destination),
    size: stat.size,
    modified: stat.mtime.toISOString(),
    isDirectory: stat.isDirectory(),
    owned: true
  };
}

export function remove(path: string): { removed: string } {
  const target = safePath(path);
  if (!existsSync(target)) throw new Error(`No such file: ${path}`);
  if (statSync(target).isDirectory()) throw new Error('Folders are not deleted.');
  requireOwned(target, 'delete');

  unlinkSync(target);
  release(target);
  return { removed: display(target) };
}
