"use client";
import { useMemo, useSyncExternalStore } from "react";
import { emptyTracking, parseTracking, type TrackingState } from "./tracking-model";
import { savePreferences } from './preference-sync';

export const TRACKING_KEY = "analyst:tracking:v1";
const event = "analyst:tracking";
function subscribe(callback: () => void) {
  window.addEventListener("storage", callback); window.addEventListener(event, callback);
  return () => { window.removeEventListener("storage", callback); window.removeEventListener(event, callback); };
}
function snapshot() { try { return localStorage.getItem(TRACKING_KEY) ?? ""; } catch { return ""; } }
export function readTracking() { return typeof window === "undefined" ? emptyTracking() : parseTracking(snapshot()); }
export function updateTracking(update: (state: TrackingState) => TrackingState): boolean {
  try {
    const previous = readTracking(), next = update(previous);
    localStorage.setItem(TRACKING_KEY, JSON.stringify(next)); window.dispatchEvent(new Event(event));
    if (JSON.stringify(previous.following) !== JSON.stringify(next.following) || JSON.stringify(previous.rules) !== JSON.stringify(next.rules)) void savePreferences({ follows: next.following.map(t => t.id), rules: next.rules });
    return true;
  } catch { return false; }
}
export function useTracking() {
  const raw = useSyncExternalStore(subscribe, snapshot, () => "");
  return useMemo(() => parseTracking(raw), [raw]);
}
