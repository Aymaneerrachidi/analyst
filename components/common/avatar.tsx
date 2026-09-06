/* eslint-disable @next/next/no-img-element */
"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

const sizeClass = {
  xs: "h-5 w-5 text-[9px]",
  sm: "h-7 w-7 text-[11px]",
  md: "h-9 w-9 text-xs",
  lg: "h-14 w-14 text-lg",
  xl: "h-20 w-20 text-2xl",
} as const;

type Size = keyof typeof sizeClass;

export function TraderAvatar({ name, id, avatar, size = "md", className }: { name: string; id: string; avatar?: string | null; size?: Size; className?: string }) {
  return <AvatarImage label={name} identity={id} source={avatar} kind="trader" size={size} className={className} />;
}

export function TokenAvatar({ symbol, address, image, size = "md", className }: { symbol: string; address: string; image?: string | null; size?: Size; className?: string }) {
  return <AvatarImage label={symbol} identity={address} source={image} kind="token" size={size} className={className} />;
}

function AvatarImage({ label, source, kind, size, className }: { label: string; identity: string; source?: string | null; kind: "trader" | "token"; size: Size; className?: string }) {
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const safeSource = source && (/^https?:\/\//i.test(source) || /^\/(?!\/)/.test(source)) ? source : null;
  const fallback = !safeSource || failedSource === safeSource;
  if (fallback) return null;
  const src = safeSource.startsWith("https:") ? `/api/image?src=${encodeURIComponent(safeSource)}` : safeSource;
  return (
    <span className={cn("relative inline-flex shrink-0 overflow-hidden rounded-full bg-elevated outline outline-1 outline-white/10", sizeClass[size], className)} title={label}>
      <img src={src} alt="" width={64} height={64} className="h-full w-full object-cover" style={{ opacity: 0 }} ref={(node) => { if (node?.complete && node.naturalWidth) node.style.opacity = "1"; }} onLoad={(event) => { event.currentTarget.style.opacity = "1"; }} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailedSource(safeSource)} data-avatar-kind={kind} />
    </span>
  );
}
