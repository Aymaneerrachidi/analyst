"use client";

import { useId, useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";

gsap.registerPlugin(useGSAP, ScrollTrigger);

/** Original interlocking links, used as an illustration rather than a market chart. */
export function ChainArtwork() {
  const scope = useRef<HTMLDivElement>(null);
  const id = useId().replace(/:/g, "");
  useGSAP(() => {
    const media = gsap.matchMedia();
    media.add("(prefers-reduced-motion: no-preference)", () => {
      gsap.fromTo(".chain-object", { scale: 0.94, y: 10 }, {
        scale: 1.04, y: -12, ease: "none",
        scrollTrigger: { trigger: scope.current, start: "top 90%", end: "bottom top", scrub: 1.2 },
      });
      gsap.to(".chain-signal", { opacity: 0.25, duration: 2, repeat: -1, yoyo: true, ease: "sine.inOut" });
    });
    return () => media.revert();
  }, { scope });

  return (
    <div ref={scope} className="hero-artwork relative mx-auto w-full max-w-[490px] select-none" aria-hidden="true">
      <svg viewBox="0 0 500 380" className="h-auto w-full overflow-visible">
        <defs>
          <linearGradient id={`${id}-lime`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#f1ffad" />
            <stop offset="0.3" stopColor="#ccff00" />
            <stop offset="0.65" stopColor="#9ab923" />
            <stop offset="1" stopColor="#e0ff6b" />
          </linearGradient>
          <linearGradient id={`${id}-metal`} x1="0" y1="0" x2="1" y2="0.7">
            <stop offset="0" stopColor="#819064" />
            <stop offset="0.25" stopColor="#dce5c1" />
            <stop offset="0.55" stopColor="#48523a" />
            <stop offset="0.82" stopColor="#a1ad88" />
            <stop offset="1" stopColor="#e1e7ce" />
          </linearGradient>
        </defs>
        <g fill="none" stroke="#37432c" strokeWidth="0.7">
          {[138, 165, 192, 219].map((r) => <ellipse key={r} cx="260" cy="197" rx={r} ry={r * 0.62} transform="rotate(-27 260 197)" opacity={r === 219 ? 0.35 : 0.65} />)}
          <path d="M30 282 465 66M68 337 429 105M49 106 443 295" strokeDasharray="2 6" opacity="0.5" />
        </g>
        <g className="chain-object" style={{ transformOrigin: "50% 50%" }}>
          <g transform="translate(252 182) rotate(39) skewX(-8) scale(1 .83)">
            <rect x="-65" y="-168" width="130" height="221" rx="65" fill="none" stroke="#334012" strokeWidth="29" transform="translate(14 16)" />
            <rect x="-65" y="-168" width="130" height="221" rx="65" fill="none" stroke={`url(#${id}-lime)`} strokeWidth="28" />
            <rect x="-76" y="-180" width="152" height="244" rx="76" fill="none" stroke="#e5ff8e" strokeOpacity="0.65" strokeWidth="1" />
            <rect x="-65" y="-12" width="130" height="221" rx="65" fill="none" stroke="#30362a" strokeWidth="29" transform="translate(14 16)" />
            <rect x="-65" y="-12" width="130" height="221" rx="65" fill="none" stroke={`url(#${id}-metal)`} strokeWidth="28" />
            <rect x="-76" y="-24" width="152" height="244" rx="76" fill="none" stroke="#c3cdb0" strokeOpacity="0.55" strokeWidth="1" />
            <path d="M-65-35V-12A65 65 0 0 0 0 53" fill="none" stroke="#17200d" strokeWidth="39" />
            <path d="M-65-42V-12A65 65 0 0 0 0 53" fill="none" stroke={`url(#${id}-lime)`} strokeWidth="28" />
          </g>
        </g>
        <g fill="#ccff00">
          <circle className="chain-signal" cx="85" cy="256" r="3" />
          <circle className="chain-signal" cx="425" cy="102" r="3" />
          <circle cx="392" cy="287" r="2" opacity="0.6" />
        </g>
      </svg>
    </div>
  );
}
