"use client";

import { useState } from "react";
import { apiSend } from "@/lib/client/fetcher";
import { toast } from "@/lib/client/toast";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const REASONS = [
  { value: "spam", label: "Spam" },
  { value: "scam", label: "Scam or phishing" },
  { value: "harassment", label: "Harassment" },
  { value: "misinformation", label: "Misleading" },
  { value: "other", label: "Something else" },
] as const;

export function ReportDialog({
  open,
  onOpenChange,
  targetType,
  targetId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  targetType: "post" | "comment";
  targetId: string;
}) {
  const [reason, setReason] = useState<(typeof REASONS)[number]["value"]>("spam");
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      await apiSend("/api/reports", "POST", { targetType, targetId, reason, details: details.trim() || undefined });
      toast("Thanks. We’ll take a look.", "positive");
      onOpenChange(false);
      setDetails("");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not send report", "negative");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Report this" description="Reports are anonymous and reviewed by moderators.">
        <div className="space-y-1.5" role="radiogroup" aria-label="Reason">
          {REASONS.map((r) => (
            <button
              key={r.value}
              type="button"
              role="radio"
              aria-checked={reason === r.value}
              onClick={() => setReason(r.value)}
              className={cn(
                "flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-sm transition-colors",
                reason === r.value ? "border-neon/50 bg-neon/10 text-primary" : "border-border bg-surface text-secondary hover:border-border-hover",
              )}
            >
              {r.label}
            </button>
          ))}
        </div>
        <textarea
          value={details}
          onChange={(e) => setDetails(e.target.value)}
          maxLength={300}
          rows={2}
          placeholder="Anything else? (optional)"
          className="mt-3 w-full resize-none rounded-lg border border-border bg-surface px-3 py-2 text-sm text-primary outline-none placeholder:text-muted focus:border-border-hover"
        />
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} disabled={busy}>
            {busy ? "Sending…" : "Send report"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
