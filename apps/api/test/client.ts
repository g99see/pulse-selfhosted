// SPDX-License-Identifier: AGPL-3.0-or-later
import request from 'supertest';
import type { Response } from 'supertest';
import type { Server } from 'node:http';

type HttpServer = Server | string;

function setCookies(response: Response): string[] {
  const raw = response.headers['set-cookie'];
  if (!raw) return [];
  return Array.isArray(raw) ? raw : [raw];
}

/**
 * Мини-клиент для интеграционных тестов: хранит cookie и автоматически
 * подставляет CSRF-заголовок (ТЗ §6), как это делает браузер.
 */
export class TestClient {
  readonly cookies: Record<string, string> = {};

  constructor(
    private readonly server: HttpServer,
    private readonly ip = '10.0.0.1',
  ) {}

  private absorb(response: Response): void {
    for (const cookie of setCookies(response)) {
      const [pair] = cookie.split(';');
      const eq = pair.indexOf('=');
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1);
      if (value === '') delete this.cookies[name];
      else this.cookies[name] = value;
    }
  }

  private header(): string {
    return Object.entries(this.cookies)
      .map(([name, value]) => `${name}=${value}`)
      .join('; ');
  }

  async csrf(): Promise<string> {
    const response = await request(this.server).get('/api/auth/csrf').set('X-Forwarded-For', this.ip);
    this.absorb(response);
    return this.cookies['puls_csrf'] ?? '';
  }

  get(path: string): Promise<Response> {
    return request(this.server)
      .get(path)
      .set('Cookie', this.header())
      .set('X-Forwarded-For', this.ip) as unknown as Promise<Response>;
  }

  async post(path: string, body?: unknown): Promise<Response> {
    const response = (await request(this.server)
      .post(path)
      .set('Cookie', this.header())
      .set('X-Forwarded-For', this.ip)
      .set('x-csrf-token', this.cookies['puls_csrf'] ?? '')
      .send(body)) as Response;
    this.absorb(response);
    return response;
  }

  async put(path: string, body?: unknown): Promise<Response> {
    const response = (await request(this.server)
      .put(path)
      .set('Cookie', this.header())
      .set('X-Forwarded-For', this.ip)
      .set('x-csrf-token', this.cookies['puls_csrf'] ?? '')
      .send(body)) as Response;
    this.absorb(response);
    return response;
  }

  async del(path: string, body?: string | object): Promise<Response> {
    const request_ = request(this.server)
      .delete(path)
      .set('Cookie', this.header())
      .set('X-Forwarded-For', this.ip)
      .set('x-csrf-token', this.cookies['puls_csrf'] ?? '');
    const response = (body === undefined ? await request_ : await request_.send(body)) as Response;
    this.absorb(response);
    return response;
  }

  /** GET бинарного ответа (выгрузка CSV-архива): тело приходит Buffer. */
  async getBinary(path: string): Promise<Response> {
    const response = (await request(this.server)
      .get(path)
      .set('Cookie', this.header())
      .set('X-Forwarded-For', this.ip)
      .buffer(true)
      .parse(binaryParser)) as Response;
    this.absorb(response);
    return response;
  }
}

function binaryParser(response: Response, callback: (error: Error | null, body: Buffer) => void): void {
  const chunks: Buffer[] = [];
  response.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
  response.on('end', () => callback(null, Buffer.concat(chunks)));
}
