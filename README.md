<p align="center">
  <a href="https://github.com/futuremachine-org/futuremachine">
    <img src="https://raw.githubusercontent.com/futuremachine-org/futuremachine/main/assets/logo.svg" width="400" alt="FutureMachine Logo">
  </a>
</p>

<div align="center">

# FutureMachine

**A TypeScript library for Futures, persistent Promises that survive process**
**restarts and can be resolved by ID.**

</div>

---

## Packages

| Package | Version | Description |
| :--- | :--- | :--- |
| [`@futuremachine/core`](./packages/core) | [![npm version](https://img.shields.io/npm/v/@futuremachine/core.svg?style=flat-square)](https://www.npmjs.com/package/@futuremachine/core) | The core FutureMachine engine. |
| [`@futuremachine/db-sqlite-node`](./packages/db-sqlite-node) |  | A node:sqlite implementation of the FutureDatabase. |
| [`@futuremachine/db-conformance-tests`](./packages/db-tests) |  | Utilities for testing database adapters. |

## Quick start

To see FutureMachine in action, try this two-part "Hello World." On the first
run, we define a logger Method and attach it to a Future. Even after the process
exits, the database remembers this 'reaction.' On the second run, we resolve the
Future with "world", triggering the original logic to print "Hello world!"

### 1. Install

```sh
npm i @futuremachine/core @futuremachine/db-sqlite-node
```

### 2. Implementation

```ts
// hello_world.ts
import fs from 'node:fs';

import { createMethodMachine, type FutureId } from '@futuremachine/core';
import { SQLFutureDatabase } from '@futuremachine/db-sqlite-node';

const idFile = './savedFutureId';
const db = new SQLFutureDatabase('test.db');

// Build your FutureMachine.
const { methods } = createMethodMachine(db);
const logger = methods.create('logger', (str: string) => {
  console.log(`Hello ${str}!`);
});
const futureMachine = methods.build();

if (!fs.existsSync(idFile)) {
  // First run.
  console.log(
    'Creating a Future, adding a reaction, and saving its id to disk.'
  );

  const { future, id } = futureMachine.withResolvers<string>();
  future.next(logger);

  fs.writeFileSync(idFile, id);
} else {
  // Second run.
  console.log('Reading the FutureId from disk and resolving its Future.');

  const id = fs.readFileSync(idFile, 'utf8') as FutureId<string>;
  fs.unlinkSync(idFile);

  futureMachine.resolveFutureById(id, 'world');
}

await db.close();

```

### 3. Run

```sh
> npx tsx hello_world.ts
Creating a Future, adding a reaction, and saving its id to disk.

> npx tsx hello_world.ts
Reading the FutureId from disk and resolving its Future.
Hello world!
```
