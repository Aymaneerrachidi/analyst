import "server-only";
import { env } from "@/lib/env";
import type { DataProvider } from "./types";
import { mockProvider } from "./mock";
import { kolhoodProvider } from "./kolhood";

const workerOwned = async (): Promise<never> => { throw new Error("Chain ingestion is owned by the continuous worker; legacy import is disabled"); };
const chainProvider: DataProvider = {
  name: "chain", isMock: false,
  fetchTraders: workerOwned, fetchLeaderboard: workerOwned, fetchTrades: workerOwned,
  fetchTraderProfile: workerOwned, fetchTokenActivity: workerOwned,
};

/** Selects the active provider from DATA_PROVIDER. Mock and live providers are never mixed. */
export function getProvider(): DataProvider {
  const source = env().DATA_PROVIDER;
  return source === "chain" ? chainProvider : source === "kolhood" ? kolhoodProvider : mockProvider;
}

export type { DataProvider } from "./types";
