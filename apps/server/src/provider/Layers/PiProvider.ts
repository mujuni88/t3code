/**
 * PiProvider — snapshot helpers for the pi-coding-agent driver.
 *
 * The pi driver embeds `@mariozechner/pi-coding-agent` in-process, so there
 * is no CLI binary to probe. The snapshot is computed purely from process
 * state (presence of `ANTHROPIC_API_KEY`) and `PiSettings.enabled`.
 *
 * @module provider/Layers/PiProvider
 */
import {
  ProviderDriverKind,
  type PiSettings,
  type ServerProviderModel,
} from "@t3tools/contracts";
import { Effect } from "effect";

import {
  buildServerProvider,
  type ServerProviderDraft,
} from "../providerSnapshot.ts";

const PROVIDER = ProviderDriverKind.make("pi");

const PI_PRESENTATION = {
  displayName: "Pi",
  showInteractionModeToggle: false,
} as const;

export const PI_DEFAULT_MODEL = "claude-sonnet-4-5";

const PI_MODEL: ServerProviderModel = {
  slug: PI_DEFAULT_MODEL,
  name: "Claude Sonnet 4.5 (pi)",
  isCustom: false,
  capabilities: { optionDescriptors: [] },
};

export const makePendingPiProvider = (settings: PiSettings): ServerProviderDraft => {
  const checkedAt = new Date().toISOString();
  const probe = settings.enabled
    ? {
        installed: true,
        version: null,
        status: "ready" as const,
        auth: { status: "unknown" } as const,
      }
    : {
        installed: true,
        version: null,
        status: "warning" as const,
        auth: { status: "unknown" } as const,
        message: "Pi driver is disabled in T3 Code settings.",
      };
  return buildServerProvider({
    presentation: PI_PRESENTATION,
    enabled: settings.enabled,
    checkedAt,
    models: [PI_MODEL],
    probe,
  });
};

/**
 * Probe pi driver readiness. Reads `ANTHROPIC_API_KEY` from `process.env`
 * (without touching `~/.pi/agent/auth.json`) and reports an unauthenticated
 * snapshot when the variable is missing instead of crashing.
 */
export const checkPiProviderStatus = (
  settings: PiSettings,
  env: NodeJS.ProcessEnv,
): Effect.Effect<ServerProviderDraft> =>
  Effect.sync(() => {
    const checkedAt = new Date().toISOString();
    const apiKey = env.ANTHROPIC_API_KEY;
    const hasKey = typeof apiKey === "string" && apiKey.trim().length > 0;

    if (!settings.enabled) {
      return buildServerProvider({
        driver: PROVIDER,
        presentation: PI_PRESENTATION,
        enabled: false,
        checkedAt,
        models: [PI_MODEL],
        probe: {
          installed: true,
          version: null,
          status: "warning",
          auth: { status: "unknown" },
          message: "Pi driver is disabled in T3 Code settings.",
        },
      });
    }

    if (!hasKey) {
      return buildServerProvider({
        driver: PROVIDER,
        presentation: PI_PRESENTATION,
        enabled: true,
        checkedAt,
        models: [PI_MODEL],
        probe: {
          installed: true,
          version: null,
          status: "warning",
          auth: { status: "unauthenticated" },
          message:
            "ANTHROPIC_API_KEY is not set in this environment. Pi sessions cannot start until it is configured.",
        },
      });
    }

    return buildServerProvider({
      driver: PROVIDER,
      presentation: PI_PRESENTATION,
      enabled: true,
      checkedAt,
      models: [PI_MODEL],
      probe: {
        installed: true,
        version: null,
        status: "ready",
        auth: { status: "authenticated" },
      },
    });
  });
