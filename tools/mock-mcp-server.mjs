/**
 * Minimal MCP server used to exercise the MCP tab without depending on a
 * third-party service. Stateless Streamable HTTP, a handful of trivial tools.
 *
 *   node tools/mock-mcp-server.mjs [port]
 *
 * Then add http://127.0.0.1:<port>/mcp in the MCP tab.
 */
import express from 'express';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

const PORT = Number(process.argv[2]) || 8931;

function buildServer() {
  const server = new McpServer({ name: 'jarvis-mock', version: '1.0.0' });

  server.registerTool(
    'add_numbers',
    {
      description: 'Adds two numbers together and returns the sum.',
      inputSchema: { a: z.number().describe('First number'), b: z.number().describe('Second number') }
    },
    async ({ a, b }) => ({ content: [{ type: 'text', text: `${a} + ${b} = ${a + b}` }] })
  );

  server.registerTool(
    'reverse_text',
    {
      description: 'Reverses the characters of the supplied text.',
      inputSchema: { text: z.string().describe('Text to reverse') }
    },
    async ({ text }) => ({ content: [{ type: 'text', text: [...text].reverse().join('') }] })
  );

  server.registerTool(
    'get_secret_word',
    {
      description: 'Returns the mock server secret word, for verifying tool calls end to end.',
      inputSchema: {}
    },
    async () => ({ content: [{ type: 'text', text: 'the secret word is tungsten' }] })
  );

  server.registerTool(
    'always_fails',
    {
      description: 'Always returns an error. Used to check error handling.',
      inputSchema: {}
    },
    async () => ({ isError: true, content: [{ type: 'text', text: 'Intentional failure.' }] })
  );

  return server;
}

const app = express();
app.use(express.json());

// Stateless mode: a fresh server+transport per request, so there is no session
// state to manage in a fixture.
app.post('/mcp', async (req, res) => {
  const server = buildServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

  res.on('close', () => {
    transport.close();
    server.close();
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (e) {
    console.error('mock mcp error:', e);
    if (!res.headersSent) res.status(500).json({ error: String(e) });
  }
});

// Stateless Streamable HTTP has no server-initiated stream to open.
app.get('/mcp', (_req, res) => res.status(405).json({ error: 'Method not allowed' }));

app.listen(PORT, '127.0.0.1', () => {
  console.log(`Mock MCP server on http://127.0.0.1:${PORT}/mcp`);
});
