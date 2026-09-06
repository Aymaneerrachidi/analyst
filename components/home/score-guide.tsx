"use client";

import { useRef } from "react";
import Link from "next/link";
import { ArrowUpRightIcon, PlusIcon } from "@phosphor-icons/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";

gsap.registerPlugin(useGSAP, ScrollTrigger);

const FACTORS = [
  { title: "Who is buying?", body: "Trader quality (30%) considers the performance of tracked buyers. Breadth (20%) measures how many distinct traders are participating." },
  { title: "How much conviction?", body: "Net accumulation (25%) weighs buys against sells. Conviction (15%) looks at position size relative to a trader’s usual activity." },
  { title: "Is activity building?", body: "Momentum (10%) compares activity across the selected window. Open any Analyst Score to inspect its five components. The score describes observed activity; it does not predict a token’s price." },
];

export function ScoreGuide() {
  const scope = useRef<HTMLElement>(null);
  useGSAP(() => {
    const media = gsap.matchMedia();
    media.add("(prefers-reduced-motion: no-preference)", () => {
      gsap.fromTo(".score-word", { opacity: 0.4 }, {
        opacity: 1, stagger: 0.1, ease: "none",
        scrollTrigger: { trigger: scope.current, start: "top 88%", end: "top 45%", scrub: 0.6 },
      });
    });
    return () => media.revert();
  }, { scope });

  return (
    <section ref={scope} className="section-space grid gap-8 border-y border-border py-12 md:grid-cols-2 md:gap-16 md:py-16" aria-labelledby="score-guide-title">
      <div>
        <p className="mb-4 text-xs font-medium text-neon">The Analyst Score</p>
        <h2 id="score-guide-title" className="max-w-lg text-balance text-3xl font-medium leading-[1.12] tracking-[-0.04em] md:text-[42px]">
          {"More context. Less guesswork.".split(" ").map((word, i) => <span key={i} className="score-word inline-block">{word}&nbsp;</span>)}
        </h2>
        <p className="mt-5 max-w-sm text-sm leading-relaxed text-secondary">Five signals. One explainable score. Understand the activity behind a token before forming your own view.</p>
        <Link href="/tokens" className="mt-6 inline-flex min-h-11 items-center gap-2 text-sm font-medium text-neon hover:underline">Explore token scores <ArrowUpRightIcon className="h-4 w-4" /></Link>
      </div>
      <div className="divide-y divide-border border-t border-border">
        {FACTORS.map((factor) => (
          <details key={factor.title} className="group">
            <summary className="flex min-h-[72px] items-center justify-between gap-5 py-5 text-base font-medium transition-colors hover:text-neon">
              {factor.title}<PlusIcon className="detail-plus h-5 w-5 shrink-0 text-muted transition-transform duration-200" />
            </summary>
            <p className="pb-6 pr-8 text-sm leading-relaxed text-secondary">{factor.body}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
