const {
  app,
  BrowserWindow,
  session,
  shell,
  ipcMain,
  safeStorage,
  dialog,
  desktopCapturer,
  screen
} = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const net = require('net');

// Its own profile folder, apart from any other JARVIS build on the same PC, so this
// build never reads anyone else's keys, chats or memories.
app.setName('JARVIS-Public');
app.setPath('userData', path.join(app.getPath('appData'), 'JARVIS-Public'));

const isDev = !app.isPackaged;
const rootDir = isDev ? path.join(__dirname, '..') : process.resourcesPath;
const serverEntry = path.join(rootDir, 'dist-server', 'server.cjs');
const chatsFile = path.join(app.getPath('userData'), 'chats.json');
// Plain JSON like chats: memories are the substrate other tooling will want to
// read, and encrypting them would protect nothing from a process running as
// this user.
const memoriesFile = path.join(app.getPath('userData'), 'memories.json');

let serverProcess = null;
let isQuitting = false;
let mainWindow = null;
// A voice assistant has to be able to speak before anyone clicks: Chromium
// otherwise refuses audio until a user gesture.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

/**
 * Only one copy of J.A.R.V.I.S. may run.
 *
 * Each window keeps the whole config in memory and writes the entire list back
 * on every change. Two copies open at once therefore quietly overwrite each
 * other: whichever saves last wins, and everything the other one added is gone
 * at the next restart. That is precisely how a set of saved links or skills
 * disappears while MCP servers — untouched in that session — appear to survive.
 */
const isPrimaryInstance = app.requestSingleInstanceLock();
if (!isPrimaryInstance) {
  app.quit();
}

/** Ask the OS for an unused port so a busy 3000 never blocks startup. */
function findFreePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

function waitForPort(port, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const socket = net.connect(port, '127.0.0.1');
      socket.once('connect', () => {
        socket.destroy();
        resolve();
      });
      socket.once('error', () => {
        socket.destroy();
        if (Date.now() > deadline) reject(new Error('Server did not start in time'));
        else setTimeout(attempt, 200);
      });
    };
    attempt();
  });
}

async function startServer() {
  if (!fs.existsSync(serverEntry)) {
    throw new Error(`Server bundle missing at ${serverEntry}. Run "npm run build:all" first.`);
  }

  const port = await findFreePort();

  // ELECTRON_RUN_AS_NODE reuses Electron's bundled Node, so the installed app
  // does not require Node on the user's machine.
  serverProcess = spawn(process.execPath, [serverEntry], {
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      NODE_ENV: 'production',
      PORT: String(port),
      DIST_DIR: path.join(rootDir, 'dist'),
      // Where Computer Use keeps its working browser profiles.
      JARVIS_DATA_DIR: app.getPath('userData')
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  serverProcess.stdout.on('data', (d) => console.log(`[server] ${d.toString().trim()}`));
  serverProcess.stderr.on('data', (d) => console.error(`[server] ${d.toString().trim()}`));
  serverProcess.on('exit', (code) => {
    if (code !== 0 && code !== null) console.error(`Server exited with code ${code}`);
  });

  await waitForPort(port);
  return port;
}

function createWindow(port) {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 640,
    backgroundColor: '#000000',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());

  // navigate_web should reach the user's real browser, not an app window.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  // Keep the app itself pinned to the local server; send anything else outward.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(`http://127.0.0.1:${port}`)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.loadURL(`http://127.0.0.1:${port}`);
}

/**
 * Config storage.
 *
 * Written as plain JSON. safeStorage was used originally, and it lost data:
 * its key lives in Chromium's Local State and, once that no longer matches,
 * every encrypted file becomes permanently unreadable and the app silently
 * starts from empty. Two of the three encrypted files had already reached that
 * state, while everything stored as plain JSON survived untouched.
 *
 * The files sit in the user's own Windows profile, readable only by that user,
 * and configuration that survives is worth more than configuration that is
 * encrypted but gone. Nothing here is ever uploaded.
 */
function readStore(name) {
  const jsonPath = path.join(app.getPath('userData'), `${name}.json`);
  const bakPath = `${jsonPath}.bak`;
  const encPath = path.join(app.getPath('userData'), `${name}.enc`);

  if (fs.existsSync(jsonPath)) {
    try {
      return JSON.parse(fs.readFileSync(jsonPath, 'utf8').replace(/^﻿/, ''));
    } catch (e) {
      console.error(`[store] ${name}.json unreadable:`, e.message);
      try {
        fs.renameSync(jsonPath, `${jsonPath}.corrupt-${Date.now()}`);
      } catch {
        /* leave it */
      }
    }
  }

  // The copy taken before the last write. Reached only when the live file is
  // missing or unparseable, which is exactly when losing everything hurts.
  if (fs.existsSync(bakPath)) {
    try {
      const recovered = JSON.parse(fs.readFileSync(bakPath, 'utf8').replace(/^﻿/, ''));
      console.log(`[store] recovered ${name} from its backup`);
      writeStore(name, recovered);
      return recovered;
    } catch (e) {
      console.error(`[store] ${name}.json.bak unreadable too:`, e.message);
    }
  }

  // Migrate anything still in the old encrypted file.
  if (fs.existsSync(encPath)) {
    const raw = fs.readFileSync(encPath);
    for (const decode of [
      () => (safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(raw) : null),
      () => raw.toString('utf8')
    ]) {
      try {
        const text = decode();
        if (!text) continue;
        const parsed = JSON.parse(text.replace(/^﻿/, ''));
        console.log(`[store] migrated ${name} from encrypted storage`);
        writeStore(name, parsed);
        return parsed;
      } catch {
        /* try the next strategy */
      }
    }
    // Undecryptable: keep the file rather than overwrite it, in case the key
    // ever comes back, but report it plainly.
    console.error(`[store] ${name}.enc could not be decrypted; starting empty`);
  }

  return null;
}

function writeStore(name, data) {
  const jsonPath = path.join(app.getPath('userData'), `${name}.json`);
  const tmpPath = `${jsonPath}.tmp`;
  const bakPath = `${jsonPath}.bak`;
  try {
    // Written to a temporary file then renamed, so an interrupted write cannot
    // leave a truncated config behind.
    fs.writeFileSync(tmpPath, JSON.stringify(data ?? null, null, 2), 'utf8');

    // Keep the previous contents for one generation. It costs a file copy and
    // is the difference between a bad write costing a moment and costing
    // everything the user typed in by hand.
    if (fs.existsSync(jsonPath)) {
      try {
        fs.copyFileSync(jsonPath, bakPath);
      } catch (e) {
        console.error(`[store] could not back up ${name}:`, e.message);
      }
    }

    fs.renameSync(tmpPath, jsonPath);
    return true;
  } catch (e) {
    console.error(`[store] could not write ${name}:`, e.message);
    return false;
  }
}

function registerSettingsIpc() {

  ipcMain.handle('settings:load', () => readStore('settings'));
  ipcMain.handle('settings:save', (_event, settings) => writeStore('settings', settings ?? {}));

  // Chat transcripts live in a file rather than localStorage: the renderer is
  // served from an OS-assigned port, so its origin changes every launch and any
  // origin-scoped storage would be discarded on restart.
  //
  // Stored as plain JSON, unlike settings. API keys are credentials and get
  // encrypted; transcripts are not, and safeStorage would not meaningfully
  // protect them anyway since any process running as this user can decrypt it.
  // Keeping them readable makes the planned memory system far easier to build.
  ipcMain.handle('chats:load', () => {
    if (!fs.existsSync(chatsFile)) return [];
    try {
      // Strip a leading BOM. Plenty of Windows tools (PowerShell's Set-Content
      // among them) write UTF-8 with one, and JSON.parse throws on it.
      const raw = fs.readFileSync(chatsFile, 'utf8').replace(/^﻿/, '');
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      console.error('Could not read chats:', e);
      // Returning [] would let the next save overwrite a file we simply failed
      // to understand. Move it aside so the transcripts are recoverable.
      try {
        const backup = `${chatsFile}.corrupt-${Date.now()}`;
        fs.renameSync(chatsFile, backup);
        console.error(`Unreadable chat history preserved at ${backup}`);
      } catch (renameErr) {
        console.error('Could not preserve unreadable chat history:', renameErr);
      }
      return [];
    }
  });

  ipcMain.handle('mcp:load', () => {
    const stored = readStore('mcp');
    return Array.isArray(stored) ? stored : [];
  });
  ipcMain.handle('mcp:save', (_event, servers) => writeStore('mcp', servers ?? []));

  ipcMain.handle('apis:load', () => {
    const stored = readStore('apis');
    return Array.isArray(stored) ? stored : [];
  });
  ipcMain.handle('apis:save', (_event, tools) => writeStore('apis', tools ?? []));

  // Skills go through readStore/writeStore rather than a bespoke file: the
  // atomic temp-and-rename write is worth having for something the user typed
  // out by hand and would have to retype if a save were ever truncated.
  ipcMain.handle('skills:load', () => {
    const stored = readStore('skills');
    return Array.isArray(stored) ? stored : [];
  });
  ipcMain.handle('skills:save', (_event, skills) => writeStore('skills', skills ?? []));

  ipcMain.handle('memories:load', () => {
    if (!fs.existsSync(memoriesFile)) return [];
    try {
      const raw = fs.readFileSync(memoriesFile, 'utf8').replace(/^﻿/, '');
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      console.error('Could not read memories:', e);
      // Never silently discard: a memory file we failed to parse is moved
      // aside so it can be recovered rather than overwritten on next save.
      try {
        const backup = `${memoriesFile}.corrupt-${Date.now()}`;
        fs.renameSync(memoriesFile, backup);
        console.error(`Unreadable memories preserved at ${backup}`);
      } catch (renameErr) {
        console.error('Could not preserve unreadable memories:', renameErr);
      }
      return [];
    }
  });

  ipcMain.handle('memories:save', (_event, memories) => {
    try {
      fs.writeFileSync(memoriesFile, JSON.stringify(memories ?? [], null, 2), 'utf8');
      return true;
    } catch (e) {
      console.error('Could not write memories:', e);
      return false;
    }
  });

  /**
   * Capture the whole screen, whatever application is in front.
   *
   * Uses Electron's own capturer rather than the Python sidecar, so this works
   * with no extra install and returns in well under a second. The image is
   * handed straight back as base64 and never written to disk — there is no
   * temporary file to clean up, and nothing survives the answer.
   */
  ipcMain.handle('screen:capture', async (_event, options) => {
    // 1280 is plenty for reading a screen and roughly halves both the encode
    // time and the bytes the model has to ingest.
    const maxWidth = Number(options?.maxWidth) || 1280;

    // Capture at display resolution, then scale down: readable for the model
    // without sending a needlessly large image.
    const display = screen.getPrimaryDisplay();
    const { width, height } = display.size;
    const scale = Math.min(1, maxWidth / Math.max(width, 1));

    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: {
        width: Math.round(width * scale),
        height: Math.round(height * scale)
      }
    });

    if (sources.length === 0) throw new Error('No screen available to capture');

    // The primary display, or the first if it cannot be identified.
    const primaryId = String(display.id);
    const source = sources.find((s) => s.display_id === primaryId) || sources[0];
    const thumbnail = source.thumbnail;

    if (thumbnail.isEmpty()) throw new Error('Screen capture came back empty');

    return {
      image: thumbnail.toJPEG(60).toString('base64'),
      mimeType: 'image/jpeg',
      width: thumbnail.getSize().width,
      height: thumbnail.getSize().height
    };
  });

  // Same file as before, now through the shared store: an interrupted write can
  // no longer truncate it, and the previous contents are kept as a backup. The
  // old plain writeFileSync gave neither, and named links are typed by hand and
  // tedious to reconstruct.
  ipcMain.handle('shortcuts:load', () => {
    const stored = readStore('shortcuts');
    return Array.isArray(stored) ? stored : [];
  });
  ipcMain.handle('shortcuts:save', (_event, shortcuts) => writeStore('shortcuts', shortcuts ?? []));

  ipcMain.handle('chats:save', (_event, sessions) => {
    try {
      fs.writeFileSync(chatsFile, JSON.stringify(sessions ?? [], null, 2), 'utf8');
      return true;
    } catch (e) {
      console.error('Could not write chats:', e);
      return false;
    }
  });
}

app.whenReady().then(async () => {
  if (!isPrimaryInstance) return;

  // A second launch raises the window that is already open rather than starting
  // a rival copy.
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  // The renderer needs the microphone; everything else stays denied.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === 'media' || permission === 'audioCapture');
  });
  session.defaultSession.setPermissionCheckHandler((_wc, permission) =>
    permission === 'media' || permission === 'audioCapture'
  );

  registerSettingsIpc();

  try {
    const port = await startServer();
    createWindow(port);
  } catch (e) {
    dialog.showErrorBox('JARVIS failed to start', e.message);
    app.quit();
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0 && mainWindow === null) app.quit();
  });
});

function stopServer() {
  isQuitting = true;
  if (serverProcess && !serverProcess.killed) {
    try {
      serverProcess.kill();
    } catch {
      /* already gone */
    }
  }
  serverProcess = null;
}

app.on('window-all-closed', () => {
  stopServer();
  app.quit();
});

app.on('before-quit', stopServer);
process.on('exit', stopServer);
