/**
 * PiSessionRuntime — embeds `@mariozechner/pi-coding-agent` as an in-process
 * library using its public `createAgentSession` API.
 *
 * - Auth: reads `ANTHROPIC_API_KEY` from the merged provider-instance
 *   environment (no file I/O to `~/.pi/agent/auth.json`).
 * - Tools: restricted to the read-only built-in subset (read, grep, find, ls).
 * - Model: auto-selected by pi from the authenticated provider.
 *
 * @module provider/Layers/PiSessionRuntime
 */
import {
  createAgentSession,
  AuthStorage,
  ModelRegistry,
} from "@mariozechner/pi-coding-agent";

export interface PiSessionRuntimeOptions {
  readonly cwd: string;
  readonly model?: string;
  readonly env?: NodeJS.ProcessEnv;
}

export interface PiRuntimeStartResult {
  readonly runtime: unknown;
  readonly modelId: string;
}

export class PiSessionRuntimeError extends Error {
  override readonly name = "PiSessionRuntimeError";
  readonly piCause: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.piCause = cause;
  }
}

const READ_ONLY_TOOLS = ["read", "grep", "find", "ls"];

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

  try {
    const authStorage = AuthStorage.inMemory();
    authStorage.setRuntimeApiKey("anthropic", apiKey);

    const modelRegistry = ModelRegistry.inMemory(authStorage);

    const { session } = await createAgentSession({
      cwd: options.cwd,
      authStorage,
      modelRegistry,
      tools: READ_ONLY_TOOLS,
    });

    const modelId = options.model ?? "claude-sonnet-4-5";
    return { runtime: session, modelId };
  } catch (cause) {
    throw new PiSessionRuntimeError(
      `Failed to create pi agent session: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
      cause,
    );
  }
}
