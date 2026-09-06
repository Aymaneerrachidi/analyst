"use client";
import { useMemo, useSyncExternalStore } from "react";
import { emptyTracking, parseTracking, type TrackingState } from "./tracking-model";

export const TRACKING_KEY = "analyst:tracking:v1";
const event = "analyst:tracking";
function subscribe(callback: () => void) {
  window.addEventListener("storage", callback); window.addEventListener(event, callback);
  return () => { window.removeEventListener("storage", callback); window.removeEventListener(event, callback); };
}
function snapshot() { try { return localStorage.getItem(TRACKING_KEY) ?? ""; } catch { return ""; } }
export function readTracking() { return typeof window === "undefined" ? emptyTracking() : parseTracking(snapshot()); }
export function updateTracking(update: (state: TrackingState) => TrackingState): boolean {
  try { localStorage.setItem(TRACKING_KEY, JSON.stringify(update(readTracking()))); window.dispatchEvent(new Event(event)); return true; } catch { return false; }
}
export function useTracking() {
  const raw = useSyncExternalStore(subscribe, snapshot, () => "");
  return useMemo(() => parseTracking(raw), [raw]);
}
