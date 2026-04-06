import { type FutureDatabase, GetFutureDatabase } from '@futuremachine/core';
import { SQLFutureDatabaseImpl } from './sql_future_database_impl.js';

export class SQLFutureDatabase implements FutureDatabase {
  private impl: SQLFutureDatabaseImpl;

  constructor(databasePath: string) {
    this.impl = new SQLFutureDatabaseImpl(databasePath);
  }

  public [GetFutureDatabase](): SQLFutureDatabaseImpl {
    return this.impl;
  }

  public close(): Promise<void> {
    return this.impl.close();
  }

  public flush(): Promise<void> {
    return this.impl.flush();
  }

  public gc(): Promise<void> {
    return this.impl.gc();
  }
}
