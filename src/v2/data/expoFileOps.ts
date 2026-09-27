import * as FileSystem from 'expo-file-system';

import type { FileOps } from './mediaStore';

/** FileOps over expo-file-system (the phone). */
export const expoFileOps: FileOps = {
  exists: async (uri) => (await FileSystem.getInfoAsync(uri)).exists,
  size: async (uri) => {
    const info = await FileSystem.getInfoAsync(uri);
    return info.exists && !info.isDirectory ? info.size : 0;
  },
  move: (from, to) => FileSystem.moveAsync({ from, to }),
  remove: (uri) => FileSystem.deleteAsync(uri, { idempotent: true }),
  mkdir: (uri) => FileSystem.makeDirectoryAsync(uri, { intermediates: true }).catch(() => {}),
  list: (dir) => FileSystem.readDirectoryAsync(dir).catch(() => []),
  freeBytes: () => FileSystem.getFreeDiskStorageAsync(),
};
