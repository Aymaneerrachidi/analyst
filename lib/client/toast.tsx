"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useSyncExternalStore } from "react";
import { cn } from "@/lib/utils";

type Tone = "neutral" | "positive" | "negative";
interface ToastItem {
  id: number;
  message: string;
  tone: Tone;
}

let items: ToastItem[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
function emit() {
  for (const l of listeners) l();
}

export function toast(message: string, tone: Tone = "neutral") {
  const id = nextId++;
  items = [...items, { id, message, tone }];
  emit();
  window.setTimeout(() => {
    items = items.filter((t) => t.id !== id);
    emit();
  }, 3200);
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

const EMPTY: ToastItem[] = [];

export function Toaster() {
  const list = useSyncExternalStore(subscribe, () => items, () => EMPTY);
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-20 z-[60] flex flex-col items-center gap-2 px-4 md:bottom-6" aria-live="polite">
      <AnimatePresence>
        {list.map((t) => (
          <motion.div
            key={t.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.18 }}
            className={cn(
              "pointer-events-auto rounded-lg border px-3.5 py-2 text-[13px] shadow-xl shadow-black/50",
              t.tone === "neutral" && "border-border bg-elevated text-primary",
              t.tone === "positive" && "border-neon/30 bg-elevated text-neon",
              t.tone === "negative" && "border-negative/30 bg-elevated text-negative",
            )}
          >
            {t.message}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
