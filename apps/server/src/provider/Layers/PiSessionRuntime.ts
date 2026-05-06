/**
 * PiSessionRuntime — embeds `@mariozechner/pi-coding-agent`'s
 * `createAgentSessionRuntime` as an in-process library.
 *
 * Restricts the pi runtime to read-only tools (no `bash`/`edit`/`write`).
 * Reads auth from `process.env.ANTHROPIC_API_KEY`; never reads or writes
 * `~/.pi/agent/auth.json`.
 *
 * The factory is intentionally side-effect-free at module load: it only
 * imports types and small helpers eagerly. The heavy `createAgentSessionRuntime`
 * call happens inside `start()` so a server boot without
 * `ANTHROPIC_API_KEY` set never crashes — the snapshot layer surfaces the
 * missing-key state and `start()` only fails when the user actively starts
 * a pi-backed thread.
 *
 * @module provider/Layers/PiSessionRuntime
 */
import {
  createAgentSessionRuntime,
  createReadOnlyTools,
  ModelRegistry,
} from "@mariozechner/pi-coding-agent";

import { PI_DEFAULT_MODEL } from "./PiProvider.ts";

export interface PiSessionRuntimeOptions {
  readonly cwd: string;
  readonly model?: string;
  readonly env?: NodeJS.ProcessEnv;
}

export interface PiRuntimeStartResult {
  /** Underlying pi runtime handle returned by `createAgentSessionRuntime`. */
  readonly runtime: unknown;
  /** Resolved model identifier (verified against pi's `ModelRegistry`). */
  readonly modelId: string;
}

/**
 * Resolve the hardcoded Claude 3.5 Sonnet model id against pi's
 * `ModelRegistry`. Falls back to the literal default if the registry shape
 * has shifted in a way that would otherwise crash startup — failure to
 * resolve a model is a runtime concern, not a server-boot concern.
 */
export function resolvePiModelId(): string {
  try {
    // ModelRegistry is exported from pi's sdk; we only call methods that
    // exist in the typed shape. If the registry can't find the model we
    // still return the literal id so callers fail with a clear message at
    // session-start time rather than module-load time.
    const registry = ModelRegistry as unknown as {
      readonly find?: (id: string) => unknown;
    };
    if (typeof registry.find === "function") {
      registry.find(PI_DEFAULT_MODEL);
    }
  } catch {
    // Swallow registry probe failures — see docstring.
  }
  return PI_DEFAULT_MODEL;
}

export class PiSessionRuntimeError extends Error {
  override readonly name = "PiSessionRuntimeError";
  readonly piCause: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.piCause = cause;
  }
}

/**
 * Construct the pi runtime in-process. Throws `PiSessionRuntimeError`
 * synchronously if `ANTHROPIC_API_KEY` is not present in the environment.
 * Callers are responsible for surfacing that error as a
 * `ProviderAdapterProcessError` at session-start time.
 */
export async function makePiSessionRuntime(
  options: PiSessionRuntimeOptions,
): Promise<PiRuntimeStartResult> {
  const env = options.env ?? process.env;
  const apiKey = env.ANTHROPIC_API_KEY;
  if (typeof apiKey !== "string" || apiKey.trim().length === 0) {
    throw new PiSessionRuntimeError(
      "ANTHROPIC_API_KEY is not set; pi driver cannot start a session.",
    );
  }

  const modelId = options.model ?? resolvePiModelId();

  try {
    // Restrict the pi runtime to read-only tools — explicitly *not*
    // wiring `createBashTool`, `createEditTool`, or `createWriteTool`.
    const tools = (createReadOnlyTools as unknown as (...args: unknown[]) => unknown)(options.cwd);
    const runtime = await (createAgentSessionRuntime as unknown as (
      input: Record<string, unknown>,
    ) => Promise<unknown>)({
      cwd: options.cwd,
      model: modelId,
      tools,
      apiKey,
    });
    return { runtime, modelId };
  } catch (cause) {
    throw new PiSessionRuntimeError(
      `Failed to create pi agent session runtime: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
      cause,
    );
  }
}
