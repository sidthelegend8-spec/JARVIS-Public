import express from 'express';
import dotenv from 'dotenv';
import os from 'os';
import path from 'path';
import { McpManager, McpServerConfig } from './server/mcp-manager';
import { ApiManager, ApiToolConfig } from './server/api-manager';
import { findProvider, publicProviders } from './server/api-providers';
import { mem0Add, mem0Delete, mem0Search, mem0Ping } from './server/mem0-client';
import { web, getLog, clearLog } from './server/computer-use';
import { research, ResearchError, ResearchStore } from './server/research';
import * as files from './server/files-manager';
import { buildPdf } from './server/pdf-writer';
import { launchApp, installedApps } from './server/app-launcher';

dotenv.config();

const app = express();
app.use(express.json({ limit: '1mb' }));

const PORT = Number(process.env.PORT) || 3000;

// Gemini is reached directly from the renderer over its own WebSocket, so no
// proxying is needed for it. MCP is different: the protocol clients are
// Node-side and remote servers rarely send CORS headers, so every MCP call is
// brokered here.
//
// This server also exists (rather than loading the UI from file://) because
// Chromium treats file:// as an opaque origin and refuses getUserMedia there.
// http://127.0.0.1 is a trustworthy origin, so the microphone works.

const mcp = new McpManager();
const apis = new ApiManager();

// Everything the model can call, from either source. The renderer asks for
// these once per session and dispatches back through /api/tools/call.
app.get('/api/tools/declarations', (_req, res) => {
    res.json({ declarations: [...mcp.declarations(), ...apis.declarations()] });
});

/**
 * Who each linked tool belongs to.
 *
 * Kept separate from the declarations rather than folded into them: those go
 * straight to Gemini as function declarations, which rejects any field it does
 * not recognise. The approval prompt needs a human name for the server or API,
 * so it asks here instead.
 */
app.get('/api/tools/sources', (_req, res) => {
    const sources: Record<
        string,
        { kind: 'MCP' | 'API'; title: string; source: string; description: string }
    > = {};

    for (const server of mcp.list()) {
        if (server.status !== 'connected') continue;
        for (const tool of server.tools) {
            sources[tool.qualifiedName] = {
                kind: 'MCP',
                title: tool.name,
                source: server.label,
                description: tool.description
            };
        }
    }
    for (const entry of apis.list()) {
        sources[entry.qualifiedName] = {
            kind: 'API',
            title: entry.label,
            source: entry.provider,
            description: entry.description
        };
    }

    res.json({ sources });
});

app.post('/api/tools/call', async (req, res) => {
    const { name, args } = req.body || {};
    if (!name) return res.status(400).json({ error: 'name is required' });

    try {
        if (mcp.isMcpTool(name)) return res.json(await mcp.callTool(name, args || {}));
        if (apis.isApiTool(name)) return res.json(await apis.call(name, args || {}));
        return res.status(404).json({ error: `Unknown tool: ${name}` });
    } catch (e: any) {
        console.error(`Tool call ${name} failed:`, e);
        res.status(500).json({ error: e?.message || 'Tool call failed' });
    }
});

// The renderer owns the API list; the server mirrors the enabled entries so it
// can answer declaration and call requests without a round trip.
app.post('/api/apis/sync', (req, res) => {
    const { tools } = req.body || {};
    if (!Array.isArray(tools)) return res.status(400).json({ error: 'tools must be an array' });
    res.json({ count: apis.sync(tools as ApiToolConfig[]) });
});

app.get('/api/apis/providers', (_req, res) => {
    res.json({ providers: publicProviders() });
});

/** Run a provider immediately with a supplied key. Powers the test button. */
app.post('/api/apis/test', async (req, res) => {
    const { provider: providerId, apiKey, args } = req.body || {};
    const provider = findProvider(providerId);
    if (!provider) return res.status(400).json({ error: 'Unknown provider' });
    if (provider.requiresKey && !apiKey?.trim()) {
        return res.status(400).json({ error: 'This provider needs an API key' });
    }

    try {
        res.json(await apis.execute(provider, apiKey, args || {}));
    } catch (e: any) {
        res.status(500).json({ error: e?.message || 'Request failed' });
    }
});

app.get('/api/mcp/state', (_req, res) => {
    res.json({ servers: mcp.list() });
});

app.get('/api/mcp/declarations', (_req, res) => {
    res.json({ declarations: mcp.declarations() });
});

app.post('/api/mcp/connect', async (req, res) => {
    const { id, label, url, transport, headers } = req.body || {};

    if (!id || typeof id !== 'string') {
        return res.status(400).json({ error: 'id is required' });
    }
    if (!url || typeof url !== 'string') {
        return res.status(400).json({ error: 'url is required' });
    }
    try {
        const parsed = new URL(url);
        if (!/^https?:$/.test(parsed.protocol)) {
            return res.status(400).json({ error: 'url must be http or https' });
        }
    } catch {
        return res.status(400).json({ error: 'url is not valid' });
    }

    const config: McpServerConfig = { id, label: label || id, url, transport, headers };
    const state = await mcp.connect(config);
    // A failed handshake is reported in the payload, not as an HTTP error: the
    // request itself succeeded and the UI wants the reason to display.
    res.json({ server: state });
});

app.post('/api/mcp/disconnect', async (req, res) => {
    const { id } = req.body || {};
    if (!id) return res.status(400).json({ error: 'id is required' });
    await mcp.disconnect(id);
    res.json({ ok: true });
});

app.post('/api/mcp/call', async (req, res) => {
    const { name, args } = req.body || {};
    if (!name) return res.status(400).json({ error: 'name is required' });
    if (!mcp.isMcpTool(name)) return res.status(404).json({ error: `Unknown MCP tool: ${name}` });

    try {
        const result = await mcp.callTool(name, args || {});
        res.json(result);
    } catch (e: any) {
        console.error('MCP call failed:', e);
        res.status(500).json({ error: e?.message || 'MCP tool call failed' });
    }
});

// mem0 is proxied for the same reasons as everything else: the key stays out
// of the renderer and CORS is not a factor. Failures here are reported but
// never fatal — the local memory store is authoritative.
const MEM0_USER = 'jarvis-local';

app.post('/api/mem0/ping', async (req, res) => {
    const { apiKey } = req.body || {};
    if (!apiKey) return res.status(400).json({ error: 'apiKey is required' });
    try {
        await mem0Ping(apiKey);
        res.json({ ok: true });
    } catch (e: any) {
        res.status(502).json({ ok: false, error: e?.message || 'mem0 unreachable' });
    }
});

app.post('/api/mem0/add', async (req, res) => {
    const { apiKey, messages, metadata } = req.body || {};
    if (!apiKey) return res.status(400).json({ error: 'apiKey is required' });
    if (!Array.isArray(messages) || messages.length === 0) {
        return res.status(400).json({ error: 'messages must be a non-empty array' });
    }
    try {
        res.json({ ok: true, result: await mem0Add(apiKey, MEM0_USER, messages, metadata) });
    } catch (e: any) {
        console.error('mem0 add failed:', e);
        res.status(502).json({ ok: false, error: e?.message || 'mem0 add failed' });
    }
});

app.post('/api/mem0/search', async (req, res) => {
    const { apiKey, query, topK } = req.body || {};
    if (!apiKey) return res.status(400).json({ error: 'apiKey is required' });
    if (!query) return res.status(400).json({ error: 'query is required' });
    try {
        res.json({ ok: true, results: await mem0Search(apiKey, MEM0_USER, query, topK || 8) });
    } catch (e: any) {
        console.error('mem0 search failed:', e);
        // Reported as an empty result set so recall degrades to local-only
        // rather than breaking the caller.
        res.status(200).json({ ok: false, results: [], error: e?.message || 'mem0 search failed' });
    }
});

app.post('/api/mem0/delete', async (req, res) => {
    const { apiKey, memoryId } = req.body || {};
    if (!apiKey || !memoryId) return res.status(400).json({ error: 'apiKey and memoryId are required' });
    try {
        await mem0Delete(apiKey, memoryId);
        res.json({ ok: true });
    } catch (e: any) {
        console.error('mem0 delete failed:', e);
        res.status(502).json({ ok: false, error: e?.message || 'mem0 delete failed' });
    }
});

// --- Research ---------------------------------------------------------------
// The Research tab: sources and a summary from the user's own Gemini key, kept
// in the profile folder so earlier research can be reopened (server/research.ts).

const researchStore = new ResearchStore(
    path.join(process.env.JARVIS_DATA_DIR || path.join(os.homedir(), '.jarvis-public'), 'research')
);

app.post('/api/research', async (req, res) => {
    const { topic, key } = req.body || {};
    try {
        const item = await research(String(topic || ''), String(key || ''));
        researchStore.save(item);
        res.json({ research: item });
    } catch (e: any) {
        const known = e instanceof ResearchError;
        if (!known) console.error('Research failed:', e);
        res.status(known ? 400 : 500).json({ error: known ? e.message : 'Research failed. Try again in a moment.' });
    }
});

app.get('/api/research', (_req, res) => res.json({ research: researchStore.list() }));

app.get('/api/research/:id', (req, res) => {
    const item = researchStore.load(req.params.id);
    if (item) res.json({ research: item });
    else res.status(404).json({ error: 'No such research' });
});

app.delete('/api/research/:id', (req, res) => res.json({ ok: researchStore.remove(req.params.id) }));

// --- Computer Use -----------------------------------------------------------
// Browser actions run here through Playwright.

const ok = (res: any, payload: unknown) => res.json({ ok: true, ...(payload as object) });
const fail = (res: any, e: any) =>
    res.status(200).json({ ok: false, error: e?.message || 'Action failed' });

app.get('/api/computer/status', async (_req, res) => {
    res.json({
        web: { open: web.isOpen(), sites: web.knownSites(), profile: web.getActiveProfile() },
        desktop: { available: false, detail: 'Desktop control is not part of this build.' }
    });
});

app.get('/api/computer/profiles', (_req, res) => {
    try {
        res.json({ profiles: web.listProfiles(), active: web.getActiveProfile() });
    } catch (e: any) {
        res.status(500).json({ error: e?.message || 'Could not read browser profiles' });
    }
});

// POST alias so the assistant's tool layer can reach it uniformly.
app.post('/api/computer/profiles/list', (_req, res) => {
    try {
        res.json({ ok: true, profiles: web.listProfiles(), active: web.getActiveProfile() });
    } catch (e: any) {
        res.status(200).json({ ok: false, error: e?.message || 'Could not read browser profiles' });
    }
});

app.post('/api/computer/profile', async (req, res) => {
    const { browser: browserName, directory } = req.body || {};
    if (!browserName || !directory) {
        return res.status(400).json({ error: 'browser and directory are required' });
    }
    try {
        res.json({ ok: true, profile: await web.useProfile(browserName, directory) });
    } catch (e: any) {
        res.status(200).json({ ok: false, error: e?.message || 'Could not select that profile' });
    }
});

app.post('/api/computer/profile/clear', async (_req, res) => {
    await web.clearProfile();
    res.json({ ok: true });
});

app.get('/api/computer/log', (req, res) => {
    res.json({ entries: getLog(Number(req.query.limit) || 100) });
});

app.post('/api/computer/log/clear', (_req, res) => {
    clearLog();
    res.json({ ok: true });
});

app.post('/api/computer/web/open', async (req, res) => {
    try { ok(res, await web.openUrl(req.body?.url)); } catch (e) { fail(res, e); }
});

app.post('/api/computer/web/search', async (req, res) => {
    const { site, query } = req.body || {};
    if (!site || !query) return res.status(400).json({ error: 'site and query are required' });
    try { ok(res, await web.searchSite(site, query)); } catch (e) { fail(res, e); }
});

app.post('/api/computer/web/click', async (req, res) => {
    try { ok(res, await web.clickTarget(req.body?.target)); } catch (e) { fail(res, e); }
});

app.post('/api/computer/web/fill', async (req, res) => {
    const { field, value, submit } = req.body || {};
    try { ok(res, await web.fillField(field, value, Boolean(submit))); } catch (e) { fail(res, e); }
});

app.post('/api/computer/web/read', async (req, res) => {
    try { ok(res, await web.readPage(req.body?.maxChars)); } catch (e) { fail(res, e); }
});

app.post('/api/computer/web/describe', async (_req, res) => {
    try { ok(res, await web.describePage()); } catch (e) { fail(res, e); }
});

app.post('/api/computer/web/scroll', async (req, res) => {
    const { direction = 'down', amount } = req.body || {};
    try { ok(res, await web.scrollPage(direction, amount)); } catch (e) { fail(res, e); }
});

app.post('/api/computer/web/press', async (req, res) => {
    try { ok(res, await web.pressKeys(req.body?.keys)); } catch (e) { fail(res, e); }
});

app.post('/api/computer/web/close', async (_req, res) => {
    try { await web.closeBrowser(); res.json({ ok: true }); } catch (e) { fail(res, e); }
});

// --- Files ------------------------------------------------------------------
// Confined to a workspace directory. Creating and reading are open; moving and
// deleting are refused unless J.A.R.V.I.S. created the file itself.

const fileRoute = (handler: (body: any) => unknown) => async (req: any, res: any) => {
    try {
        res.json({ ok: true, ...(handler(req.body || {}) as object) });
    } catch (e: any) {
        res.status(200).json({ ok: false, error: e?.message || 'File operation failed' });
    }
};

app.get('/api/files/workspace', (_req, res) => {
    res.json({ workspace: files.workspace() });
});

app.post('/api/files/list', fileRoute((b) => files.list(b.dir || '.')));
app.post('/api/files/read', fileRoute((b) => files.read(b.path)));
app.post('/api/files/search', fileRoute((b) => ({ results: files.search(b.query, b.dir || '.') })));
app.post('/api/files/write', fileRoute((b) => ({ file: files.writeText(b.path, b.content ?? '') })));
app.post('/api/files/rename', fileRoute((b) => ({ file: files.rename(b.path, b.newName) })));
app.post('/api/files/move', fileRoute((b) => ({ file: files.move(b.path, b.destination) })));
app.post('/api/files/delete', fileRoute((b) => files.remove(b.path)));

app.post('/api/files/pdf', (req, res) => {
    const { path: target, title, content } = req.body || {};
    if (!target || !content) {
        return res.status(400).json({ error: 'path and content are required' });
    }
    try {
        // Documents land in Downloads unless a folder was named, since that is
        // where the user will look for them.
        const named = /\.pdf$/i.test(target) ? target : `${target}.pdf`;
        const name = /[\\/]/.test(named) ? named : require('path').join(files.PDF_DIR, named);
        const absolute = files.writePath(name);
        // Written through the file manager so the PDF is recorded as created
        // by J.A.R.V.I.S. and can therefore be moved or deleted later.
        const placeholder = files.writeText(name, '');
        require('fs').writeFileSync(absolute, buildPdf(String(content), title));
        const stat = require('fs').statSync(absolute);
        res.json({ ok: true, file: { ...placeholder, size: stat.size } });
    } catch (e: any) {
        res.status(200).json({ ok: false, error: e?.message || 'Could not write the PDF' });
    }
});

// --- Applications -----------------------------------------------------------

app.get('/api/apps', (_req, res) => res.json({ apps: installedApps() }));

app.post('/api/apps/launch', (req, res) => {
    try {
        res.json({ ok: true, ...launchApp(String(req.body?.name || '')) });
    } catch (e: any) {
        res.status(200).json({ ok: false, error: e?.message || 'Could not launch that app' });
    }
});

async function startServer() {
    if (process.env.NODE_ENV !== 'production') {
        // Imported lazily and marked external at bundle time: the packaged app
        // serves prebuilt assets and must not carry the Vite toolchain.
        const { createServer: createViteServer } = await import('vite');
        const vite = await createViteServer({
            server: { middlewareMode: true },
            appType: 'spa'
        });
        app.use(vite.middlewares);
    } else {
        // DIST_DIR is set by the Electron main process. Relative paths would
        // resolve against an unpredictable cwd once packaged.
        app.use(express.static(process.env.DIST_DIR || 'dist'));
    }

    app.listen(PORT, '127.0.0.1', () => {
        console.log(`Server running on port ${PORT}`);
    });
}

const shutdown = () => {
    void mcp.closeAll().finally(() => process.exit(0));
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

startServer();
