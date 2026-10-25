"use client";

import { Particles, ParticlesEffect } from "@animate-ui/react/primitives/effects/particles";
import { useEffect, useState, type ReactNode } from "react";

const key = (id: string) => `selah.verified.${id}`;

/** Called by the consultant's "accept" step, so the burst plays on the refreshed page. */
export function markJustVerified(actionId: string) {
  try {
    sessionStorage.setItem(key(actionId), "1");
  } catch {
    // Storage blocked: no burst, nothing else changes.
  }
}

/**
 * Wraps the status badge on an action page. Right after a consultant accepts
 * the evidence (verified complete is human-verified, the one moment worth
 * marking), a small monochrome burst plays once (Animate UI Particles).
 * Skipped under reduced motion, and never on later visits.
 */
export function VerifiedBurst({ actionId, verified, children }: { actionId: string; verified: boolean; children: ReactNode }) {
  const [play, setPlay] = useState(false);
  useEffect(() => {
    if (!verified) return;
    try {
      if (sessionStorage.getItem(key(actionId))) {
        sessionStorage.removeItem(key(actionId));
        // eslint-disable-next-line react-hooks/set-state-in-effect -- reads browser-only storage after mount
        setPlay(true);
      }
    } catch {
      // Storage blocked: no burst.
    }
  }, [actionId, verified]);
  return (
    <Particles animate={play} className="relative inline-flex">
      {children}
      <ParticlesEffect count={8} radius={28} spread={360} className="size-1 rounded-full bg-success" />
    </Particles>
  );
}
