/* c8 ignore start */
import { writeFileSync } from 'fs';
import path from 'path';
import type { FutureId } from '../core/future_impl.js';
import {
  type FutureDB,
  type MethodDB,
  ObjectDB,
  ObjectDBType,
  type Reaction,
  type Serializable,
  type SerializableDB,
} from '../database/future_database.js';

export interface Database {
  getFutureIds(): FutureId<Serializable>[];
  getReactions(futureId: FutureId<Serializable>): {
    fulfillReactions: Reaction<SerializableDB>[];
    rejectReactions: Reaction<SerializableDB>[];
  };
}

type DotRecord = (string | { port: string; label: string } | DotRecord)[];

class IdGenerator {
  private idCounter = 0;

  constructor(private prefix: string) {}

  public get() {
    return `${this.prefix}${this.idCounter++}`;
  }
}

class FutureGraph {
  private lines: string[] = [];
  private idGen: IdGenerator = new IdGenerator('n');
  private futureIdMap: Map<string, string> = new Map();

  constructor(private database: Database) {
    this.build();
  }

  public get(): string {
    return this.lines.join('\n');
  }

  private write(line: string) {
    this.lines.push(line);
  }

  private build() {
    this.write('digraph futureDb {');
    for (const futureId of this.database.getFutureIds()) {
      const futureNodeId = this.getFutureNode(futureId);
      const reactions = this.database.getReactions(futureId);
      this.processReactions(futureNodeId, reactions.fulfillReactions, {
        color: 'green',
      });
      this.processReactions(futureNodeId, reactions.rejectReactions, {
        color: 'red',
      });
    }
    this.write(`}`);
  }

  private processReactions(
    futureNodeId: string,
    reactions: Reaction<SerializableDB>[],
    props: Record<string, string>
  ) {
    for (const reaction of reactions) {
      const nextFutureId = this.getFutureNode(reaction.nextFutureDb.getId());

      if (reaction.methodDb) {
        const methodNodeId = this.methodNode(reaction.methodDb);
        this.connect(futureNodeId, methodNodeId, props);
        this.connect(methodNodeId, nextFutureId);
      } else {
        this.connect(futureNodeId, nextFutureId, props);
      }
    }
  }

  private propsToString(props: Record<string, string>) {
    const propEntries = Object.entries(props);
    if (propEntries.length === 0) {
      return '';
    }
    const propsStrings = propEntries.map(
      ([label, value]) => `${label}="${value}"`
    );
    return ` [${propsStrings.join(', ')}]`;
  }

  private createNode(props: Record<string, string>) {
    const id = this.idGen.get();
    this.write(`${id}${this.propsToString(props)};`);
    return id;
  }

  private connect(
    node1: string,
    node2: string,
    props: Record<string, string> = {}
  ) {
    this.write(`${node1} -> ${node2}${this.propsToString(props)};`);
  }

  private getFutureNode(futureId: string) {
    const nodeId = this.futureIdMap.get(futureId);
    if (nodeId) {
      return nodeId;
    }
    const id = this.createNode({
      label: futureId,
    });
    this.futureIdMap.set(futureId, id);
    return id;
  }

  private recordToString(dotRecord: DotRecord): string {
    return `{${dotRecord
      .map((field) => {
        if (typeof field === 'string') {
          return field;
        }
        if (Array.isArray(field)) {
          return this.recordToString(field);
        }
        return `<${field.port}> ${field.label}`;
      })
      .join('|')}}`;
  }

  private createRecord(
    dotRecord: DotRecord,
    otherProps: Record<string, string> = {}
  ) {
    if (dotRecord.length === 0) {
      return this.createNode(otherProps);
    }
    return this.createNode({
      ...otherProps,
      shape: 'record',
      label: this.recordToString(dotRecord),
    });
  }

  private sanitize(value: SerializableDB) {
    const specialChars = ['\\', '"', '|', '<', '>', '{', '}'];
    return specialChars.reduce((acc, specialChar) => {
      return acc.split(specialChar).join('\\' + specialChar);
    }, JSON.stringify(value));
  }

  private methodNode(methodDb: MethodDB): string {
    const fields: DotRecord = [methodDb.getName()];
    const connections: { port: string; node: string }[] = [];

    for (const bounded of methodDb.getBounded()) {
      if (
        bounded instanceof ObjectDB &&
        bounded.getObjectType() === ObjectDBType.Method
      ) {
        const node = this.methodNode(bounded as MethodDB);
        const port = this.idGen.get();
        fields.push({ port, label: '-' });
        connections.push({ node, port });
        continue;
      }

      if (
        bounded instanceof ObjectDB &&
        bounded.getObjectType() === ObjectDBType.Future
      ) {
        const node = this.getFutureNode(
          (bounded as FutureDB<SerializableDB>).getId()
        );
        const port = this.idGen.get();
        fields.push({ port, label: '-' });
        connections.push({ node, port });
        continue;
      }

      fields.push(this.sanitize(bounded));
    }

    const methodNodeId = this.createRecord([fields]);

    for (const { node, port } of connections) {
      this.connect(`${methodNodeId}:${port}`, node, {
        style: 'dashed',
      });
    }

    return methodNodeId;
  }
}

export function exportDatabaseAsDotFile(database: Database, filePath: string) {
  writeFileSync(path.resolve(filePath), new FutureGraph(database).get());
}

/* c8 ignore end */
