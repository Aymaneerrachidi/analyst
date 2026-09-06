"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { apiGet, apiSend } from "./fetcher";
import type { GuestPublic } from "@/lib/types";

const STORAGE_KEY = "analyst.guest";

type GuestState = { guest: GuestPublic | null; loaded: boolean };

let state: GuestState = { guest: null, loaded: false };
const listeners = new Set<() => void>();
let fetchPromise: Promise<void> | null = null;

function emit() {
  for (const l of listeners) l();
}

function readStorage(): GuestPublic | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as GuestPublic;
    return parsed && typeof parsed.id === "string" && typeof parsed.displayName === "string" ? parsed : null;
  } catch {
    return null;
  }
}

function writeStorage(guest: GuestPublic | null) {
  try {
    if (guest) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(guest));
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // storage may be unavailable
  }
}

function setGuest(guest: GuestPublic | null) {
  state = { guest, loaded: true };
  writeStorage(guest);
  emit();
}

function ensureLoaded() {
  if (state.loaded || fetchPromise) return;
  const cached = readStorage();
  if (cached) {
    state = { guest: cached, loaded: true };
    emit();
  }
  fetchPromise = apiGet<{ guest: GuestPublic | null }>("/api/me")
    .then((res) => {
      // Server is authoritative: the cookie may have been cleared or never issued.
      setGuest(res.guest);
    })
    .catch(() => {
      state = { guest: state.guest, loaded: true };
      emit();
    })
    .finally(() => {
      fetchPromise = null;
    });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const serverSnapshot: GuestState = { guest: null, loaded: false };

/** Anonymous visitor identity. No account: an HttpOnly cookie plus a locally cached display name. */
export function useGuest() {
  const snapshot = useSyncExternalStore(subscribe, () => state, () => serverSnapshot);
  useEffect(() => {
    ensureLoaded();
  }, []);

  const setDisplayName = useCallback(async (displayName: string) => {
    const res = await apiSend<{ guest: GuestPublic }>("/api/me", "POST", { displayName });
    setGuest(res.guest);
    return res.guest;
  }, []);

  /** Called after any write so a freshly issued identity is reflected locally. */
  const refresh = useCallback(async () => {
    const res = await apiGet<{ guest: GuestPublic | null }>("/api/me");
    setGuest(res.guest);
    return res.guest;
  }, []);

  const isAnonymousName = !snapshot.guest || /^anon-[0-9A-F]{4}$/.test(snapshot.guest.displayName);

  return { guest: snapshot.guest, loaded: snapshot.loaded, needsName: isAnonymousName, setDisplayName, refresh };
}
