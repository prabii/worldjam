import { useEffect, useState } from 'react';
import { create } from 'zustand';

import { openDeviceLibrary } from '../data/deviceLibrary';
import type { SqlLibrary } from '../data/repos';

/**
 * The one Library instance, plus a change counter. Screens re-query when the
 * counter moves, so any save/rename/delete anywhere refreshes every list
 * without a global cache to keep coherent.
 */
const useVersion = create<{ version: number; bump(): void }>((set) => ({
  version: 0,
  bump: () => set((s) => ({ version: s.version + 1 })),
}));

let libraryPromise: Promise<SqlLibrary> | null = null;

export function getLibrary(): Promise<SqlLibrary> {
  if (!libraryPromise) {
    libraryPromise = openDeviceLibrary().catch((err) => {
      libraryPromise = null;
      throw err;
    });
  }
  return libraryPromise;
}

export function notifyLibraryChanged(): void {
  useVersion.getState().bump();
}

export function useLibraryVersion(): number {
  return useVersion((s) => s.version);
}

/**
 * Runs `query` against the library and re-runs it whenever the library
 * changes or `deps` change. Errors surface as `error` rather than throwing
 * into render.
 */
export function useLibraryQuery<T>(query: (lib: SqlLibrary) => Promise<T>, deps: unknown[]): {
  data: T | null;
  error: string | null;
  loading: boolean;
} {
  const version = useLibraryVersion();
  const [state, setState] = useState<{ data: T | null; error: string | null; loading: boolean }>({
    data: null,
    error: null,
    loading: true,
  });
  useEffect(() => {
    let live = true;
    setState((s) => ({ ...s, loading: true }));
    getLibrary()
      .then(query)
      .then((data) => live && setState({ data, error: null, loading: false }))
      .catch((err) => live && setState({ data: null, error: err instanceof Error ? err.message : String(err), loading: false }));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, ...deps]);
  return state;
}
