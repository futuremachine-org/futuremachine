import { existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

let madeDbDir = false;
export function randomDatabasePath(): string {
  const dbDir = 'db';
  if (!madeDbDir) {
    madeDbDir = true;
    mkdirSync(dbDir, { recursive: true });
  }

  return join(dbDir, `dbPath${Math.random()}.db`);
}

export function cleanupDbFiles(dbPath: string) {
  for (const path of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
    if (existsSync(path)) {
      unlinkSync(path);
    }
  }
}

export function sleep(ms: number) {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(() => resolve(), ms);
  return promise;
}

export async function forceGarbageCollection() {
  // This seems to work deterministically.
  global.gc!();
  await sleep(0);
  // The WeakRef gets gc here.
  global.gc!();
  // The FinalizationRegistry callback gets called here.
  await sleep(0);

  // Do it a few more times to be certain:
  for (let i = 0; i < 10; i++) {
    global.gc!();
    await sleep(0);
  }
}
