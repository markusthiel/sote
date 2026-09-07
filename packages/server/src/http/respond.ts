/** SOTE — HTTP-Kleinkram, an einer Stelle. */

import type { ServerResponse } from 'node:http';

export function json(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
    'cache-control': 'no-store',
  });
  res.end(text);
}

/**
 * Ein Fehler nennt seinen Grund, und der Grund ist maschinenlesbar.
 *
 * SONEs Lehre aus ADR-0086: jede Ablehnung nennt ihren Grund. Eine
 * Oberfläche, die „ging nicht" anzeigt, kann nicht sagen, was zu tun ist.
 */
export function fail(
  res: ServerResponse,
  status: number,
  code: string,
  message: string,
): void {
  json(res, status, { error: { code, message } });
}

export async function readJson(
  req: import('node:http').IncomingMessage,
  limitBytes = 64 * 1024,
): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    size += buf.length;
    if (size > limitBytes) throw new Error('Anfrage zu groß');
    chunks.push(buf);
  }
  if (size === 0) return undefined;
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export function cookie(header: string | undefined, name: string): string | undefined {
  if (header === undefined) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return undefined;
}
