"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

// The floating cards (Files, the assistant): not modal, the page stays usable
// behind them. Drag one by its header, or focus the header and move it with
// the arrow keys (Shift for bigger steps). It stays inside the window and
// remembers where it was left.

const MARGIN = 16;
const STEP = 16;
// The open sidebar's width (16rem) and a margin: a new card opens next to it.
const BESIDE_SIDEBAR = 16 * 16 + MARGIN;

export interface Point {
  x: number;
  y: number;
}

function readPosition(key: string): Point | null {
  try {
    const raw = window.localStorage.getItem(key);
    const p = raw ? (JSON.parse(raw) as Point) : null;
    return p && Number.isFinite(p.x) && Number.isFinite(p.y) ? p : null;
  } catch {
    return null;
  }
}

function savePosition(key: string, p: Point) {
  try {
    window.localStorage.setItem(key, JSON.stringify(p));
  } catch {
    // A private window or blocked storage: the card just opens in its default spot next time.
  }
}

/** Keep the whole card on screen. */
function clamp(p: Point, card: HTMLElement): Point {
  const maxX = Math.max(MARGIN, window.innerWidth - card.offsetWidth - MARGIN);
  const maxY = Math.max(MARGIN, window.innerHeight - card.offsetHeight - MARGIN);
  return { x: Math.min(Math.max(p.x, MARGIN), maxX), y: Math.min(Math.max(p.y, MARGIN), maxY) };
}

/**
 * Position and drag handling for a floating card. `pinned` stops dragging
 * (the assistant's focus mode centres the card instead); the position is kept
 * for when it is unpinned.
 */
export function useFloatingCard({ storageKey, side, pinned = false }: { storageKey: string; side: "left" | "right"; pinned?: boolean }) {
  const card = useRef<HTMLDivElement>(null);
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  const [pos, setPos] = useState<Point | null>(null);

  // First placement: where it was left, else next to the sidebar.
  useLayoutEffect(() => {
    const el = card.current;
    if (!el) return;
    const fallback = { x: side === "right" ? window.innerWidth - el.offsetWidth - BESIDE_SIDEBAR : BESIDE_SIDEBAR, y: 64 };
    setPos(clamp(readPosition(storageKey) ?? fallback, el));
  }, [side, storageKey]);

  // While pinned the card has another size: clamping to it would move the kept spot.
  useEffect(() => {
    if (pinned) return;
    const onResize = () => card.current && setPos((p) => (p ? clamp(p, card.current!) : p));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [pinned]);

  const move = useCallback((next: Point) => {
    if (!card.current) return;
    const p = clamp(next, card.current);
    setPos(p);
    return p;
  }, []);

  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (pinned || e.button !== 0 || (e.target as HTMLElement).closest("button") || !pos) return;
    drag.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (drag.current) move({ x: e.clientX - drag.current.dx, y: e.clientY - drag.current.dy });
  }
  function onPointerUp() {
    if (!drag.current) return;
    drag.current = null;
    if (pos) savePosition(storageKey, pos);
  }
  function onKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
    if (pinned || e.target !== e.currentTarget) return;
    const step = e.shiftKey ? STEP * 4 : STEP;
    const delta: Record<string, Point> = {
      ArrowLeft: { x: -step, y: 0 },
      ArrowRight: { x: step, y: 0 },
      ArrowUp: { x: 0, y: -step },
      ArrowDown: { x: 0, y: step },
    };
    const d = delta[e.key];
    if (!d || !pos) return;
    e.preventDefault();
    const p = move({ x: pos.x + d.x, y: pos.y + d.y });
    if (p) savePosition(storageKey, p);
  }

  return {
    card,
    pos,
    /** Spread on the card's header: the drag handle. */
    handle: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp, onKeyDown },
  };
}
