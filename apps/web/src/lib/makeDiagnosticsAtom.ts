import { useAtomValue } from "@effect/atom-react";
import { Cause, Effect, Option } from "effect";
import { AsyncResult, Atom } from "effect/unstable/reactivity";
import { useCallback } from "react";

import { appAtomRegistry } from "../rpc/atomRegistry";

export interface DiagnosticsState<T> {
  readonly data: T | null;
  readonly error: string | null;
  readonly isPending: boolean;
  readonly refresh: () => void;
}

interface DiagnosticsAtomOptions<T> {
  readonly fetch: () => Promise<T>;
  readonly staleTimeMs: number;
  readonly idleTtlMs: number;
  readonly label: string;
  readonly errorFallback: string;
}

interface DiagnosticsAtomResult<T> {
  readonly atom: Atom.Atom<AsyncResult.AsyncResult<T, unknown>>;
  readonly refresh: () => void;
  readonly useHook: () => DiagnosticsState<T>;
}

export function makeDiagnosticsAtom<T>(
  options: DiagnosticsAtomOptions<T>,
): DiagnosticsAtomResult<T> {
  const atom = Atom.make(Effect.promise(options.fetch)).pipe(
    Atom.swr({
      staleTime: options.staleTimeMs,
      revalidateOnMount: true,
    }),
    Atom.setIdleTTL(options.idleTtlMs),
    Atom.withLabel(options.label),
  );

  function formatError(error: unknown): string {
    return error instanceof Error ? error.message : options.errorFallback;
  }

  function readError(result: AsyncResult.AsyncResult<T, unknown>): string | null {
    if (result._tag !== "Failure") {
      return null;
    }
    const squashed = Cause.squash(result.cause);
    return formatError(squashed);
  }

  function refresh(): void {
    appAtomRegistry.refresh(atom);
  }

  function useHook(): DiagnosticsState<T> {
    const result = useAtomValue(atom);
    const data = Option.getOrNull(AsyncResult.value(result));
    const stableRefresh = useCallback(() => {
      refresh();
    }, []);

    return {
      data,
      error: readError(result),
      isPending: result.waiting,
      refresh: stableRefresh,
    };
  }

  return { atom, refresh, useHook };
}
