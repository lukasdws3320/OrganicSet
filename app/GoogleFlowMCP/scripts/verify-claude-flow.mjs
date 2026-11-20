#!/usr/bin/env node
/** Test Claude's configured MCP launcher with a generic preparation-only transaction. */
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const { values } = parseArgs({ options: { plan: { type: 'string' }, 'shot-number': { type: 'string' }, output: { type: 'string' } } });
if (!values.plan || !values.output) throw Error('Use --plan /absolute/plano.json --output /absolute/report.json [--shot-number N]');
const config = JSON.parse(readFileSync(join(homedir(), '.claude.json'), 'utf8')).mcpServers?.['google-flow'];
if (!config?.command) throw Error('Claude google-flow server is not configured');
const client = new Client({ name: 'flow-portability-check', version: '1.0.0' });
const transport = new StdioClientTransport({ command: config.command, args: config.args || [], env: { ...process.env, ...(config.env || {}) }, stderr: 'pipe' });
try {
  await client.connect(transport);
  const tools = (await client.listTools()).tools.map(t => t.name);
  if (!tools.includes('flow_execute_shot')) throw Error('Configured Claude launcher does not expose the current generic workflow');
  const result = await client.callTool({ name: 'flow_execute_shot', arguments: { plan: resolve(values.plan), ...(values['shot-number'] ? { shot_number: Number(values['shot-number']) } : {}), submit: false } });
  const text = result.content.find(c => c.type === 'text')?.text;
  const prepared = text ? JSON.parse(text) : null;
  if (result.isError || prepared?.error || prepared?.status !== 'ready' || prepared.willSubmit !== false || !prepared.promptAndReferencesMatch || !prepared.settingsMatch || !prepared.referenceProofs?.length)
    throw Error(prepared?.error || 'MCP did not confirm the complete preparation-only workflow');
  const report = { verifiedAt: new Date().toISOString(), method: 'Actual google-flow launcher from Claude configuration, MCP stdio client', tools, paidGenerationRequested: false, prepared };
  const output = resolve(values.output); mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ report: output, expert: prepared.expert, reference: prepared.reference, shot: prepared.label, status: prepared.status, willSubmit: prepared.willSubmit, exactImageVerified: prepared.referenceProofs.length > 0, voiceMention: prepared.voiceMentions, voiceTimbreVerified: prepared.voiceTimbreVerified }));
} finally { await client.close(); }
