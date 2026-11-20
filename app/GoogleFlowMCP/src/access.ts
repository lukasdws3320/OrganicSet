import { createHash } from "node:crypto";

export const READ_ONLY = process.env.FLOW_MCP_READ_ONLY !== "0";
const READ_METHODS = new Set(["status", "wait", "assets", "characters", "techniques", "voices", "outputs"]);
export const isReadMethod = (name: string): boolean => READ_METHODS.has(name);

// Enforced below both transports, including a read-only client attached to a writable owner.
export function protectCore<T extends object>(core: T, readOnly = READ_ONLY): T {
  return new Proxy(core, {
    get(target, key, receiver) {
      const value = Reflect.get(target, key, receiver);
      if (typeof value !== "function") return value;
      if (readOnly && !isReadMethod(String(key))) return async () => { throw new Error("Flow bridge is read-only; this action is disabled during validation."); };
      return value.bind(target);
    },
  });
}

export function bridgeIdentity(target = process.env.FLOW_MCP_TARGET_ID ?? "", readOnly = READ_ONLY) {
  return {name: "flow-mcp", local_bridge: "GoogleFlowMCP", target: createHash("sha256").update(target).digest("hex"), read_only: readOnly};
}
export function compatibleBridge(ours: ReturnType<typeof bridgeIdentity>, other: unknown): boolean {
  if (!other || typeof other !== "object") return false;
  const o = other as Record<string, unknown>;
  return o.name === ours.name && o.local_bridge === ours.local_bridge && o.target === ours.target && o.read_only === ours.read_only;
}
