import "server-only";
import { env } from "@/lib/env";

export function explorerBase(): string {
  return env().EXPLORER_BASE_URL.replace(/\/$/, "");
}

export function explorerAddressUrl(address: string): string {
  return `${explorerBase()}/address/${address}`;
}

export function explorerTxUrl(hash: string): string {
  return `${explorerBase()}/tx/${hash}`;
}
