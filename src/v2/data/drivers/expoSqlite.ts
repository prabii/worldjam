import * as SQLite from 'expo-sqlite';

import type { SqlExecutor, SqlValue } from '../../contracts/library';

/**
 * SqlExecutor over expo-sqlite (the phone). Transactions are serialised with a
 * promise chain because expo-sqlite's transaction helper does not isolate
 * concurrent callers on one connection.
 */
export async function openExpoSqlite(name = 'worldjam-v2.db'): Promise<SqlExecutor> {
  const db = await SQLite.openDatabaseAsync(name);
  await db.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = OFF;');
  let chain: Promise<unknown> = Promise.resolve();
  let inTx = false;

  const exec: SqlExecutor = {
    exec: (sql) => db.execAsync(sql),
    run: async (sql, params: SqlValue[] = []) => {
      const r = await db.runAsync(sql, params);
      return { changes: r.changes };
    },
    all: <T>(sql: string, params: SqlValue[] = []) => db.getAllAsync<T>(sql, params),
    get: <T>(sql: string, params: SqlValue[] = []) => db.getFirstAsync<T>(sql, params),
    transaction: <T>(fn: () => Promise<T>): Promise<T> => {
      // A transaction started inside another simply joins it.
      if (inTx) return fn();
      const run = chain.then(async () => {
        inTx = true;
        await db.execAsync('BEGIN');
        try {
          const out = await fn();
          await db.execAsync('COMMIT');
          return out;
        } catch (err) {
          await db.execAsync('ROLLBACK').catch(() => {});
          throw err;
        } finally {
          inTx = false;
        }
      });
      chain = run.catch(() => {});
      return run;
    },
  };
  return exec;
}
