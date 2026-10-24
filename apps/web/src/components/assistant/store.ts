"use client";

import { useSyncExternalStore } from "react";

// Whether the floating assistant card is open, and what it should show when
// it opens. Kept outside React so the sidebar entry, "Ask the assistant" on
// record pages and the card itself (mounted once in the app layout) share it
// without a provider. It lives as long as the tab: moving between pages keeps
// the card, its chat and its focus as they were.

export type CaseType = "recommendation" | "action" | "finding" | "meeting" | "document";

/** What opening asks for: a chat, or a new chat about a project and maybe one of its records. */
export type OpenRequest = { chatId: string } | { projectId: string; case?: { type: CaseType; id: string } } | null;

interface State {
  open: boolean;
  /** Bumped on every open() with a request, so the card acts on it even when it is open already. */
  seq: number;
  request: OpenRequest;
}

let state: State = { open: false, seq: 0, request: null };
const listeners = new Set<() => void>();

function set(next: Partial<State>) {
  state = { ...state, ...next };
  for (const l of listeners) l();
}

export const assistant = {
  open(request: OpenRequest = null) {
    set(request ? { open: true, request, seq: state.seq + 1 } : { open: true, request: null });
  },
  close() {
    set({ open: false });
  },
  toggle() {
    set({ open: !state.open, request: null });
  },
};

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

const serverState: State = { open: false, seq: 0, request: null };

export function useAssistant() {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => serverState,
  );
}
