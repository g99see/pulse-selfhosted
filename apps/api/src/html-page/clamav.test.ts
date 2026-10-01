// SPDX-License-Identifier: AGPL-3.0-or-later
// Unit-тесты антивирусного адаптера (ТЗ §3.8): noop-заглушка при пустом
// CLAMAV_HOST и TCP-клиент clamd (INSTREAM) против фейкового сервера.
import { createServer, type Server, type Socket } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ClamAvInstreamScanner,
  NoopClamAvScanner,
  createClamAvScanner,
} from './clamav';

/** Фейковый clamd: читает INSTREAM и отвечает заданной строкой. */
function startFakeClamd(response: string): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const server = createServer((socket: Socket) => {
      let buffer = Buffer.alloc(0);
      socket.on('data', (chunk: Buffer) => {
        buffer = Buffer.concat([buffer, chunk]);
        const headerEnd = buffer.indexOf(0);
        if (headerEnd === -1) return;
        let offset = headerEnd + 1;
        // Разбираем чанки [4 байта длины][данные], пока не встретим нулевую длину.
        for (;;) {
          if (buffer.length < offset + 4) return;
          const size = buffer.readUInt32BE(offset);
          offset += 4;
          if (size === 0) {
            socket.write(response);
            socket.end();
            return;
          }
          if (buffer.length < offset + size) return;
          offset += size;
        }
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      resolve({ server, port });
    });
  });
}

const servers: Server[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.close();
});

describe('createClamAvScanner', () => {
  it('без CLAMAV_HOST отдаёт noop-заглушку', () => {
    expect(createClamAvScanner(undefined)).toBeInstanceOf(NoopClamAvScanner);
    expect(createClamAvScanner('')).toBeInstanceOf(NoopClamAvScanner);
  });

  it('с адресом возвращает TCP-клиент clamd', () => {
    expect(createClamAvScanner('clamav:3310')).toBeInstanceOf(ClamAvInstreamScanner);
  });
});

describe('NoopClamAvScanner', () => {
  it('никогда не находит угроз', async () => {
    const scanner = new NoopClamAvScanner();
    expect(await scanner.scan(Buffer.from('<html></html>'))).toEqual({ infected: false });
  });
});

describe('ClamAvInstreamScanner', () => {
  it('чистый ответ stream: OK — угроз нет', async () => {
    const { server, port } = await startFakeClamd('stream: OK\0');
    servers.push(server);
    const scanner = new ClamAvInstreamScanner('127.0.0.1', port);
    expect(await scanner.scan(Buffer.from('<h1>ok</h1>'))).toEqual({ infected: false });
  });

  it('ответ FOUND — угроза с сигнатурой', async () => {
    const { server, port } = await startFakeClamd('stream: Eicar-Test-Signature FOUND\0');
    servers.push(server);
    const scanner = new ClamAvInstreamScanner('127.0.0.1', port);
    expect(await scanner.scan(Buffer.from('X5O!P%@AP'))).toEqual({
      infected: true,
      signature: 'Eicar-Test-Signature',
    });
  });
});
