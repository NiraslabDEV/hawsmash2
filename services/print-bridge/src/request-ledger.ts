import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export interface RequestLedger {
  has(requestId: string): boolean;
  record(requestId: string): Promise<void>;
}

export class MemoryRequestLedger implements RequestLedger {
  protected readonly seen = new Set<string>();

  has(requestId: string): boolean {
    return this.seen.has(requestId);
  }

  async record(requestId: string): Promise<void> {
    this.seen.add(requestId);
  }
}

export class FileRequestLedger extends MemoryRequestLedger {
  constructor(private readonly filePath: string) {
    super();
  }

  async initialize(): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    try {
      const contents = await readFile(this.filePath, 'utf8');
      for (const requestId of contents.split(/\r?\n/)) {
        if (requestId) this.seen.add(requestId);
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') throw error;
    }
  }

  override async record(requestId: string): Promise<void> {
    if (this.has(requestId)) return;
    await appendFile(this.filePath, `${requestId}\n`, 'utf8');
    await super.record(requestId);
  }
}
