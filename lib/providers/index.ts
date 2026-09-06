import "server-only";
import { env } from "@/lib/env";
import type { DataProvider } from "./types";
import { mockProvider } from "./mock";
import { kolhoodProvider } from "./kolhood";

/** Selects the active provider from DATA_PROVIDER. Mock and live providers are never mixed. */
export function getProvider(): DataProvider {
  return env().DATA_PROVIDER === "kolhood" ? kolhoodProvider : mockProvider;
}

export type { DataProvider } from "./types";
