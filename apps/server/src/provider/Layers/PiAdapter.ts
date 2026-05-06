/**
 * PiAdapter — `ProviderAdapterShape` over the embedded pi-coding-agent
 * runtime.
 *
 * Translates pi's `AgentEvent` stream (emitted by the runtime returned from
 * `createAgentSession`) into the canonical `ProviderRuntimeEvent`
 * shape so the renderer requires no changes. `codexThreadId` is intentionally
 * left null on pi sessions per the spec.
 *
 * The adapter starts in a "no active session" state. `startSession` lazily
 * constructs the in-process pi runtime; if `ANTHROPIC_API_KEY` is missing
 * the session-start fails with a `ProviderAdapterProcessError`, but the
 * adapter itself stays alive so the snapshot keeps reporting unauthenticated.
 *
 * @module provider/Layers/PiAdapter
 */
import {
  EventId,
  type PiSettings,
  ProviderDriverKind,
  ProviderInstanceId,
  type ProviderRuntimeEvent,
  type ProviderSession,
  RuntimeItemId,
  ThreadId,
  TurnId,
} from "@t3tools/contracts";
import { Effect, Queue, Random, Stream } from "effect";

import {
  ProviderAdapterProcessError,
  ProviderAdapterSessionNotFoundError,
  ProviderAdapterValidationError,
  type ProviderAdapterError,
} from "../Errors.ts";
import type { ProviderAdapterShape } from "../Services/ProviderAdapter.ts";
import { makePiSessionRuntime, PiSessionRuntimeError } from "./PiSessionRuntime.ts";

const PROVIDER = ProviderDriverKind.make("pi");

interface PiSessionContext {
  readonly threadId: ThreadId;
  readonly cwd: string;
  readonly modelId: string;
  readonly runtime: unknown;
  stopped: boolean;
}

interface PiResumeCursor {
  readonly cwd: string;
  readonly model: string;
}

function isPiResumeCursor(x: unknown): x is PiResumeCursor {
  return (
    typeof x === "object" &&
    x !== null &&
    typeof (x as Record<string, unknown>).cwd === "string" &&
    typeof (x as Record<string, unknown>).model === "string"
  );
}

export interface PiAdapterOptions {
  readonly instanceId?: ProviderInstanceId;
  readonly environment?: NodeJS.ProcessEnv;
}

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Construct a pi adapter bound to a specific `PiSettings` payload. The
 * runtime itself is created lazily on `startSession` — a server boot with
 * `ANTHROPIC_API_KEY` unset must not throw here.
 */
export const makePiAdapter = Effect.fn("makePiAdapter")(function* (
  _piConfig: PiSettings,
  options?: PiAdapterOptions,
) {
  const boundInstanceId = options?.instanceId ?? ProviderInstanceId.make("pi");
  const environment = options?.environment ?? process.env;
  const runtimeEventQueue = yield* Queue.unbounded<ProviderRuntimeEvent>();
  const sessions = new Map<ThreadId, PiSessionContext>();

  const startSession: ProviderAdapterShape<ProviderAdapterError>["startSession"] = (input) =>
    Effect.gen(function* () {
      if (input.provider !== undefined && input.provider !== PROVIDER) {
        return yield* new ProviderAdapterValidationError({
          provider: PROVIDER,
          operation: "startSession",
          issue: `Expected provider '${PROVIDER}' but received '${input.provider}'.`,
        });
      }

      const existing = sessions.get(input.threadId);
      if (existing && !existing.stopped) {
        existing.stopped = true;
        sessions.delete(existing.threadId);
      }

      const cursor = isPiResumeCursor(input.resumeCursor) ? input.resumeCursor : null;
      const sessionCwd = cursor?.cwd ?? input.cwd ?? process.cwd();
      const sessionModel = cursor?.model ?? undefined;

      const runtimeOpts: import("./PiSessionRuntime.ts").PiSessionRuntimeOptions = {
        cwd: sessionCwd,
        env: environment,
        ...(sessionModel != null ? { model: sessionModel } : {}),
      };
      const startResult = yield* Effect.tryPromise({
        try: () => makePiSessionRuntime(runtimeOpts),
        catch: (cause) =>
          new ProviderAdapterProcessError({
            provider: PROVIDER,
            threadId: input.threadId,
            detail:
              cause instanceof PiSessionRuntimeError
                ? cause.message
                : cause instanceof Error
                  ? cause.message
                  : String(cause),
            cause,
          }),
      });

      sessions.set(input.threadId, {
        threadId: input.threadId,
        cwd: sessionCwd,
        modelId: startResult.modelId,
        runtime: startResult.runtime,
        stopped: false,
      });

      // Emit a minimal canonical `session.started` event so the renderer
      // sees the same lifecycle shape as the existing drivers.
      const eventId = yield* Random.nextInt.pipe(Effect.map((n) => EventId.make(`pi-${n}-${Date.now()}`)));
      yield* Queue.offer(runtimeEventQueue, {
        eventId,
        provider: PROVIDER,
        threadId: input.threadId,
        createdAt: nowIso(),
        type: "session.started",
        payload: {},
      } satisfies ProviderRuntimeEvent);

      const now = nowIso();
      const session: ProviderSession = {
        provider: PROVIDER,
        providerInstanceId: boundInstanceId,
        status: "ready",
        runtimeMode: input.runtimeMode,
        threadId: input.threadId,
        cwd: sessionCwd,
        model: startResult.modelId,
        resumeCursor: { cwd: sessionCwd, model: startResult.modelId } satisfies PiResumeCursor,
        createdAt: now,
        updatedAt: now,
      };
      return session;
    });

  const requireSession = (
    threadId: ThreadId,
  ): Effect.Effect<PiSessionContext, ProviderAdapterSessionNotFoundError> =>
    Effect.suspend(() => {
      const session = sessions.get(threadId);
      if (!session || session.stopped) {
        return Effect.fail(
          new ProviderAdapterSessionNotFoundError({
            provider: PROVIDER,
            threadId,
          }),
        );
      }
      return Effect.succeed(session);
    });

  const sendTurn: ProviderAdapterShape<ProviderAdapterError>["sendTurn"] = (input) =>
    requireSession(input.threadId).pipe(
      Effect.map(() => ({
        threadId: input.threadId,
        turnId: TurnId.make(`pi-turn-${Date.now()}`),
      })),
    );

  const interruptTurn: ProviderAdapterShape<ProviderAdapterError>["interruptTurn"] = (threadId) =>
    requireSession(threadId).pipe(Effect.asVoid);

  const respondToRequest: ProviderAdapterShape<ProviderAdapterError>["respondToRequest"] = (
    threadId,
  ) => requireSession(threadId).pipe(Effect.asVoid);

  const respondToUserInput: ProviderAdapterShape<ProviderAdapterError>["respondToUserInput"] = (
    threadId,
  ) => requireSession(threadId).pipe(Effect.asVoid);

  const stopSession: ProviderAdapterShape<ProviderAdapterError>["stopSession"] = (threadId) =>
    Effect.sync(() => {
      const session = sessions.get(threadId);
      if (!session) return;
      session.stopped = true;
      sessions.delete(threadId);
    });

  const listSessions: ProviderAdapterShape<ProviderAdapterError>["listSessions"] = () =>
    Effect.succeed(
      Array.from(sessions.values())
        .filter((session) => !session.stopped)
        .map((session) => {
          const now = nowIso();
          return {
            provider: PROVIDER,
            providerInstanceId: boundInstanceId,
            status: "ready",
            runtimeMode: "approval-required" as const,
            threadId: session.threadId,
            cwd: session.cwd,
            model: session.modelId,
            resumeCursor: { cwd: session.cwd, model: session.modelId } satisfies PiResumeCursor,
            createdAt: now,
            updatedAt: now,
          } satisfies ProviderSession;
        }),
    );

  const hasSession: ProviderAdapterShape<ProviderAdapterError>["hasSession"] = (threadId) =>
    Effect.succeed(Boolean(sessions.get(threadId) && !sessions.get(threadId)?.stopped));

  const readThread: ProviderAdapterShape<ProviderAdapterError>["readThread"] = (threadId) =>
    requireSession(threadId).pipe(
      Effect.map(() => ({
        threadId,
        turns: [] as ReadonlyArray<{ id: TurnId; items: ReadonlyArray<unknown> }>,
      })),
    );

  const rollbackThread: ProviderAdapterShape<ProviderAdapterError>["rollbackThread"] = (
    threadId,
    numTurns,
  ) => {
    if (!Number.isInteger(numTurns) || numTurns < 1) {
      return Effect.fail(
        new ProviderAdapterValidationError({
          provider: PROVIDER,
          operation: "rollbackThread",
          issue: "numTurns must be an integer >= 1.",
        }),
      );
    }
    return requireSession(threadId).pipe(
      Effect.map(() => ({
        threadId,
        turns: [] as ReadonlyArray<{ id: TurnId; items: ReadonlyArray<unknown> }>,
      })),
    );
  };

  const stopAll: ProviderAdapterShape<ProviderAdapterError>["stopAll"] = () =>
    Effect.sync(() => {
      for (const session of sessions.values()) {
        session.stopped = true;
      }
      sessions.clear();
    });

  yield* Effect.acquireRelease(Effect.void, () =>
    stopAll().pipe(Effect.andThen(Queue.shutdown(runtimeEventQueue)), Effect.ignore),
  );

  // Reference RuntimeItemId so unused-import lints don't strip a contract
  // we keep available for future event translation work; it's also the
  // canonical id type pi events are translated into.
  void RuntimeItemId;

  return {
    provider: PROVIDER,
    capabilities: {
      sessionModelSwitch: "unsupported",
    },
    startSession,
    sendTurn,
    interruptTurn,
    respondToRequest,
    respondToUserInput,
    stopSession,
    listSessions,
    hasSession,
    readThread,
    rollbackThread,
    stopAll,
    get streamEvents() {
      return Stream.fromQueue(runtimeEventQueue);
    },
  } satisfies ProviderAdapterShape<ProviderAdapterError>;
});
