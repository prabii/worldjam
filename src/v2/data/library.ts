import type { SqlExecutor } from '../contracts/library';
import { migrate } from './schema';
import { createRepositories, type SqlLibrary } from './repos';

/** Runs migrations, then returns the repositories over `db`. */
export async function openLibrary(db: SqlExecutor): Promise<SqlLibrary> {
  await migrate(db);
  return createRepositories(db);
}
