import { createHash, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { PrintPayload } from './types';
import type { RequestLedger } from './request-ledger';

const MAX_BODY_BYTES = 1024 * 1024;
const REQUEST_ID_PATTERN = /^[a-z0-9._:-]{8,200}$/i;

export interface LocalPrintRequest {
  requestId: string;
  station: 'kitchen' | 'counter' | 'bar';
  kind: 'order' | 'receipt' | 'cash_close' | 'test';
  payload: PrintPayload;
}

interface LocalServerOptions {
  token: string;
  storeId: string;
  allowedOrigins: string[];
  ledger: RequestLedger;
  print(request: LocalPrintRequest): Promise<boolean>;
  drawer(requestId: string): Promise<boolean>;
}

function json(response: ServerResponse, status: number, body: Record<string, unknown>): void {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}

function tokenMatches(header: string | undefined, expected: string): boolean {
  const supplied = header?.startsWith('Bearer ') ? header.slice(7) : '';
  const suppliedHash = createHash('sha256').update(supplied).digest();
  const expectedHash = createHash('sha256').update(expected).digest();
  return timingSafeEqual(suppliedHash, expectedHash);
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new Error('body_too_large');
    chunks.push(buffer);
  }
  const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid_json');
  return parsed as Record<string, unknown>;
}

function validRequestId(value: unknown): value is string {
  return typeof value === 'string' && REQUEST_ID_PATTERN.test(value);
}

export function createLocalServer(options: LocalServerOptions): Server {
  const inFlight = new Map<string, Promise<boolean>>();

  async function idempotent(
    requestId: string,
    action: () => Promise<boolean>,
  ): Promise<{ ok: boolean; duplicate: boolean }> {
    if (options.ledger.has(requestId)) return { ok: true, duplicate: true };

    const existing = inFlight.get(requestId);
    if (existing) return { ok: await existing, duplicate: true };

    const operation = (async () => {
      const ok = await action();
      if (ok) await options.ledger.record(requestId);
      return ok;
    })();
    inFlight.set(requestId, operation);
    try {
      return { ok: await operation, duplicate: false };
    } finally {
      inFlight.delete(requestId);
    }
  }

  return createServer(async (request, response) => {
    try {
      const origin = request.headers.origin;
      if (origin && !options.allowedOrigins.includes(origin)) {
        json(response, 403, { ok: false, error: 'origin_denied' });
        return;
      }
      if (origin) {
        response.setHeader('Access-Control-Allow-Origin', origin);
        response.setHeader('Vary', 'Origin');
      }
      response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');

      if (request.method === 'OPTIONS') {
        response.writeHead(204);
        response.end();
        return;
      }

      if (!tokenMatches(request.headers.authorization, options.token)) {
        json(response, 401, { ok: false, error: 'unauthorised' });
        return;
      }

      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      if (request.method === 'GET' && url.pathname === '/health') {
        json(response, 200, {
          ok: true,
          storeId: options.storeId,
          uptimeSeconds: Math.floor(process.uptime()),
        });
        return;
      }

      if (request.method === 'POST' && url.pathname === '/print') {
        const body = await readJson(request);
        if (
          !validRequestId(body.requestId) ||
          !['kitchen', 'counter', 'bar'].includes(String(body.station)) ||
          !['order', 'receipt', 'cash_close', 'test'].includes(String(body.kind)) ||
          !body.payload ||
          typeof body.payload !== 'object'
        ) {
          json(response, 400, { ok: false, error: 'invalid_print_request' });
          return;
        }
        const printRequest = body as unknown as LocalPrintRequest;
        const result = await idempotent(printRequest.requestId, () => options.print(printRequest));
        json(response, result.ok ? 200 : 503, result.ok ? result : { ...result, error: 'print_failed' });
        return;
      }

      if (request.method === 'POST' && url.pathname === '/drawer') {
        const body = await readJson(request);
        if (!validRequestId(body.requestId)) {
          json(response, 400, { ok: false, error: 'invalid_drawer_request' });
          return;
        }
        const requestId = body.requestId;
        const result = await idempotent(requestId, () => options.drawer(requestId));
        json(response, result.ok ? 200 : 503, result.ok ? result : { ...result, error: 'drawer_failed' });
        return;
      }

      json(response, 404, { ok: false, error: 'not_found' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'internal_error';
      const status = message === 'body_too_large' ? 413 : message === 'invalid_json' ? 400 : 500;
      json(response, status, { ok: false, error: status === 500 ? 'internal_error' : message });
    }
  });
}
