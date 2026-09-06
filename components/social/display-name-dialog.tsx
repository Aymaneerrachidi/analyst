"use client";

import { useState, type FormEvent } from "react";
import { useGuest } from "@/lib/client/guest";
import { toast } from "@/lib/client/toast";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { InlineNotice } from "@/components/ui/states";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone?: (name: string) => void;
  mode?: "first" | "edit";
}

/** Lightweight identity: a display name stored locally and against the anonymous visitor. No password, no email. */
export function DisplayNameDialog({ open, onOpenChange, onDone, mode = "first" }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={mode === "edit" ? "Change display name" : "Choose a display name"}
        description={mode === "edit" ? "Shown next to your posts and comments." : "No account, no password. This is just how you’ll appear."}
      >
        {/* Mounted only while open, so the form starts fresh every time. */}
        <NameForm mode={mode} onOpenChange={onOpenChange} onDone={onDone} />
      </DialogContent>
    </Dialog>
  );
}

function NameForm({ mode, onOpenChange, onDone }: Omit<Props, "open">) {
  const { guest, setDisplayName } = useGuest();
  const [value, setValue] = useState(() => (mode === "edit" && guest ? guest.displayName : ""));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const saved = await setDisplayName(value);
      toast(`You’re posting as ${saved.displayName}`, "positive");
      onOpenChange(false);
      onDone?.(saved.displayName);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save that name.");
    } finally {
      setBusy(false);
    }
  };

  const skip = () => {
    onOpenChange(false);
    if (guest) onDone?.(guest.displayName);
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      <input
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="gyro"
        maxLength={24}
        className="h-11 w-full rounded-lg border border-border bg-surface px-3 text-[15px] text-primary outline-none transition-colors placeholder:text-muted focus:border-border-hover"
        aria-label="Display name"
      />
      {error && <InlineNotice tone="negative">{error}</InlineNotice>}
      <div className="flex items-center justify-between gap-2 pt-1">
        {mode === "first" ? (
          <button type="button" onClick={skip} className="text-sm text-muted transition-colors hover:text-primary">
            Continue as {guest?.displayName ?? "anon"}
          </button>
        ) : (
          <span />
        )}
        <Button type="submit" variant="primary" disabled={busy || value.trim().length < 2}>
          {busy ? "Saving…" : "Continue"}
        </Button>
      </div>
    </form>
  );
}
