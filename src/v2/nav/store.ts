import { create } from 'zustand';

/**
 * V2 navigation: four tabs plus a push stack for detail screens. Small on
 * purpose — the app has a handful of screens and no deep links, so a state
 * machine is easier to reason about (and to drive from Android Back) than a
 * navigation library.
 */
export type Tab = 'home' | 'jams' | 'studio' | 'settings';

export type Route =
  /** New capture. `sessionId` set = launched from Studio (asks whether to also save to My Jams). */
  | { name: 'capture'; sessionId?: string }
  | { name: 'captureDetail'; id: string }
  | { name: 'trackDetail'; id: string }
  | { name: 'lyricsEditor'; id?: string; trackId?: string; captureIds?: string[] }
  | { name: 'sourcePicker'; sessionId: string }
  | { name: 'tiles' }
  | { name: 'echo' };

interface NavState {
  tab: Tab;
  stack: Route[];
  setTab(tab: Tab): void;
  push(route: Route): void;
  pop(): void;
  /** Replace the top of the stack (e.g. capture → its detail after saving). */
  replace(route: Route): void;
  /** Handles Android Back; false = let the OS close the app. */
  back(): boolean;
}

export const useNav = create<NavState>((set, get) => ({
  tab: 'home',
  stack: [],
  setTab: (tab) => set({ tab, stack: [] }),
  push: (route) => set((s) => ({ stack: [...s.stack, route] })),
  pop: () => set((s) => ({ stack: s.stack.slice(0, -1) })),
  replace: (route) => set((s) => ({ stack: [...s.stack.slice(0, -1), route] })),
  back: () => {
    const { stack, tab } = get();
    if (stack.length > 0) {
      set({ stack: stack.slice(0, -1) });
      return true;
    }
    if (tab !== 'home') {
      set({ tab: 'home' });
      return true;
    }
    return false;
  },
}));
