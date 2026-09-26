import { create } from 'zustand';

/**
 * Transient feedback for the studio.
 *
 * One toast at a time, newest wins. On a phone a stack of three toasts covers
 * the thing the user is looking at, and during a jam the latest event is the
 * only one that matters. A progress toast ("Gemma is arranging… 4s") updates
 * in place instead of re-animating every second.
 */

export type ToastKind = 'info' | 'success' | 'error' | 'ai' | 'progress';

export interface Toast {
  id: number;
  message: string;
  kind: ToastKind;
}

interface ToastState {
  current: Toast | null;
  show: (message: string, kind?: ToastKind) => void;
  hide: (id?: number) => void;
}

let nextId = 1;

export const useToast = create<ToastState>((set, get) => ({
  current: null,
  show: (message, kind = kindFor(message)) => {
    const cur = get().current;
    // Progress updating progress keeps its id, so the host does not replay the
    // entrance animation on every tick.
    const id = cur && cur.kind === 'progress' && kind === 'progress' ? cur.id : nextId++;
    set({ current: { id, message, kind } });
  },
  hide: (id) => {
    const cur = get().current;
    if (!cur || (id != null && cur.id !== id)) return;
    set({ current: null });
  },
}));

/** Fire-and-forget helper for callers outside React. */
export function toast(message: string, kind?: ToastKind): void {
  useToast.getState().show(message, kind);
}

/** How long each kind stays up, ms. Progress stays until replaced. */
export const TOAST_MS: Record<ToastKind, number> = {
  info: 2400,
  success: 2800,
  ai: 3600,
  error: 4800,
  progress: 30000,
};

/**
 * Classifies a store status message, so existing status strings become
 * properly styled toasts without every call site being rewritten.
 */
export function kindFor(message: string): ToastKind {
  const m = message.toLowerCase();
  if (/(fail|could not|couldn't|denied|unavailable|error|too short|limit reached)/.test(m)) {
    return 'error';
  }
  if (m.startsWith('gemma arranged') || m.startsWith('gemma ')) {
    return m.endsWith('…') || /…\s*\d+s$/.test(m) ? 'progress' : 'ai';
  }
  if (m.endsWith('…') || /…\s*\d+s$/.test(m)) return 'progress';
  if (m.startsWith('rule-based')) return 'success';
  if (/^(saved|opened|captured|timing|lyrics|jam deleted|track cleared)/.test(m)) {
    return 'success';
  }
  return 'info';
}
