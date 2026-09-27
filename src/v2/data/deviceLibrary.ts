import { openExpoSqlite } from './drivers/expoSqlite';
import { openLibrary } from './library';
import type { SqlLibrary } from './repos';

let device: Promise<SqlLibrary> | null = null;

/** The app's library on the phone: one connection for the process. Kept apart from library.ts so Jest never loads expo-sqlite. */
export function openDeviceLibrary(): Promise<SqlLibrary> {
  if (!device) {
    device = openExpoSqlite()
      .then(openLibrary)
      .catch((err) => {
        device = null;
        throw err;
      });
  }
  return device;
}
