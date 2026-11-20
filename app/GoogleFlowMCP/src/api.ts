#!/usr/bin/env node
import { LocalCore } from "./core.js";
import { READ_ONLY, protectCore } from "./access.js";
import { PORT, startServer } from "./server.js";
const role = await startServer(protectCore(new LocalCore()));
console.error(`GoogleFlowMCP API ${role} at http://127.0.0.1:${PORT} (${READ_ONLY ? "read-only" : "generation enabled"})`);
if (role !== "owner") process.exit(0);
