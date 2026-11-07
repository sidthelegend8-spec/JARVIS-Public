/**
 * Checks how saved MCP configs merge with the servers the app ships. The
 * public build ships none, so the list is only what the user added, and an
 * entry still flagged built-in (say, copied from another build's mcp.json)
 * does not come back as a server nobody can delete.
 *
 *   npx tsx tools/test-mcp-builtins.ts
 */
import { McpServerConfig, withBuiltins } from '../src/hooks/use-mcp';

let passed = 0;
let failed = 0;

function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    passed++;
    console.log(`  ok   ${label}`);
  } else {
    failed++;
    console.log(`  FAIL ${label}\n         expected ${JSON.stringify(expected)}\n         actual   ${JSON.stringify(actual)}`);
  }
}

const saved: McpServerConfig[] = [
  { id: 'builtin-vesync', label: 'Smart Plug', url: 'http://127.0.0.1:8973/mcp', transport: 'auto', enabled: true, builtin: true },
  { id: 'builtin-google', label: 'Gmail & Calendar', url: 'http://127.0.0.1:8972/mcp', transport: 'auto', enabled: true, builtin: true },
  { id: 'abc', label: 'Flight Tracker', url: 'https://example.com/mcp', transport: 'auto', enabled: false }
];

const merged = withBuiltins(saved);
check('only the user\'s own servers; stale built-ins dropped', merged.map((c) => c.id), ['abc']);
check('the user\'s server keeps its settings', [merged[0].label, merged[0].enabled, merged[0].url],
      ['Flight Tracker', false, 'https://example.com/mcp']);
check('a fresh install starts with no servers', withBuiltins([]), []);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
