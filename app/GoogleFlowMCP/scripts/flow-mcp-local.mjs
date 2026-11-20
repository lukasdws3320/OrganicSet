#!/usr/bin/env node
import { readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const flags = process.argv.slice(2);
if (flags.includes('--help')) {
 console.log('flow-mcp-local [--api] [--read-only]\nFixed-action Flow Control MCP stdio by default; --experimental uses unvalidated Playwright adapter; --api serves experimental REST API/panel. Reads private ~/.config/google-flow-mcp/connection.json and reuses the existing Browser Harness daemon only; never opens a Chrome debugging connection.');
 process.exit(0);
}
if (flags.some(flag => !['--api','--read-only','--experimental'].includes(flag))) { console.error('Unknown flag; see --help.'); process.exit(1); }
try {
 const configPath = process.env.FLOW_MCP_CONFIG ?? join(homedir(), '.config', 'google-flow-mcp', 'connection.json');
 const permissions = statSync(configPath).mode & 0o777;
 if (permissions & 0o077) throw new Error('Connection configuration must be private (chmod 600).');
 const config = JSON.parse(readFileSync(configPath, 'utf8'));
 if (!/^[A-Fa-f0-9]{32}$/.test(config.targetId ?? '')) throw new Error('A verified Chrome targetId is required in the private connection configuration.');
 if (!Number.isInteger(config.apiPort) || config.apiPort < 1024 || config.apiPort > 65535) throw new Error('Invalid API port in connection configuration.');
 if (config.readOnly !== undefined && typeof config.readOnly !== 'boolean') throw new Error('readOnly must be a boolean.');
 if (config.transport !== 'harness-ipc') throw new Error('Only the existing Harness IPC transport is enabled.');
 const root = dirname(dirname(fileURLToPath(import.meta.url)));
 Object.assign(process.env, {
   FLOW_MCP_TARGET_ID: config.targetId,
   FLOW_MCP_HARNESS_SOCKET: config.harnessSocket ?? join(homedir(), ".config", "browser-harness", "runtime", process.platform === "win32" ? "bu-default.port" : "bu-default.sock"),
   BH_REQUIRE_EXISTING_DAEMON: "1",
   FLOW_MCP_PORT: String(config.apiPort),
   FLOW_MCP_HOME: config.stateDir ?? join(homedir(), '.config', 'google-flow-mcp', 'state'),
   FLOW_MCP_OUTPUT: config.outputDir ?? join(homedir(), 'Downloads', 'GoogleFlowMCP'),
   FLOW_CONTROL_READ_ONLY: flags.includes("--read-only") || config.controlReadOnly === true ? "1" : "0",
   FLOW_MCP_READ_ONLY: flags.includes('--read-only') || config.readOnly !== false ? '1' : '0',
 });
 process.chdir(root);
 await import(flags.includes('--api') ? '../dist/api.js' : flags.includes('--experimental') ? '../dist/index.js' : '../dist/control.js');
} catch {
 console.error('GoogleFlowMCP could not start safely. Check the private connection file (chmod 600), exact Flow target, build, existing Harness daemon and loopback API port. No replacement browser or account was opened.');
 process.exit(1);
}
