import type { SqlExecutor, SqlValue } from '../../contracts/library';

// sql.js ships without types; only the surface used here is described.
interface SqlJsStatement {
  bind(params: SqlValue[]): void;
  step(): boolean;
  getAsObject(): Record<string, SqlValue>;
  free(): void;
}
interface SqlJsDatabase {
  run(sql: string, params?: SqlValue[]): void;
  exec(sql: string): void;
  prepare(sql: string): SqlJsStatement;
  getRowsModified(): number;
}

/** In-memory SQLite (sql.js / WASM) behind the same SqlExecutor the phone uses. */
export async function openSqlJs(): Promise<SqlExecutor> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const init = require('sql.js') as () => Promise<{ Database: new () => SqlJsDatabase }>;
  const SQL = await init();
  const db = new SQL.Database();
  let depth = 0;

  const all = <T>(sql: string, params: SqlValue[] = []): T[] => {
    const st = db.prepare(sql);
    try {
      st.bind(params);
      const rows: T[] = [];
      while (st.step()) rows.push(st.getAsObject() as T);
      return rows;
    } finally {
      st.free();
    }
  };

  return {
    exec: async (sql) => db.exec(sql),
    run: async (sql, params = []) => {
      db.run(sql, params);
      return { changes: db.getRowsModified() };
    },
    all: async (sql, params) => all(sql, params),
    get: async <T>(sql: string, params?: SqlValue[]) => all<T>(sql, params)[0] ?? null,
    transaction: async <T>(fn: () => Promise<T>): Promise<T> => {
      if (depth > 0) return fn();
      depth++;
      db.exec('BEGIN');
      try {
        const out = await fn();
        db.exec('COMMIT');
        return out;
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      } finally {
        depth--;
      }
    },
  };
}
