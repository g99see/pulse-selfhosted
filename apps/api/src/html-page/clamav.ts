// SPDX-License-Identifier: AGPL-3.0-or-later
import { Logger } from '@nestjs/common';
import { createConnection } from 'node:net';

/** Результат антивирусной проверки файла (ТЗ §3.8). */
export interface ClamAvScanResult {
  /** Найдена ли угроза. */
  infected: boolean;
  /** Имя сигнатуры, если угроза найдена. */
  signature?: string;
}

/**
 * Антивирусный адаптер (ТЗ §3.8). Реализации: noop-заглушка (по умолчанию,
 * когда CLAMAV_HOST не задан) и TCP-клиент clamd (INSTREAM).
 */
export interface ClamAvScanner {
  scan(content: Buffer): Promise<ClamAvScanResult>;
}

/** Инъекционный токен сканера — подменяется в тестах. */
export const CLAMAV_SCANNER = Symbol('CLAMAV_SCANNER');

/**
 * Заглушка: проверка отключена. Пишет понятный лог один раз при создании,
 * чтобы владелец инстанса понимал, что антивирус не работает.
 */
export class NoopClamAvScanner implements ClamAvScanner {
  constructor(private readonly logger: Logger = new Logger('ClamAv')) {
    this.logger.warn(
      'CLAMAV_HOST не задан — антивирусная проверка HTML отключена (заглушка noop). ' +
        'Укажите CLAMAV_HOST=host:3310, чтобы включить ClamAV.',
    );
  }

  async scan(_content?: Buffer): Promise<ClamAvScanResult> {
    return { infected: false };
  }
}

/**
 * Клиент clamd по протоколу INSTREAM: без внешних библиотек, поверх TCP.
 * Формат: чанки [4 байта длины][данные], завершение — нулевая длина. Ответ
 * вида «stream: OK» или «stream: <сигнатура> FOUND».
 */
export class ClamAvInstreamScanner implements ClamAvScanner {
  constructor(
    private readonly host: string,
    private readonly port = 3310,
    private readonly timeoutMs = 10_000,
  ) {}

  scan(content: Buffer): Promise<ClamAvScanResult> {
    return new Promise<ClamAvScanResult>((resolve, reject) => {
      const socket = createConnection({ host: this.host, port: this.port });
      let response = '';
      let settled = false;

      const fail = (error: Error): void => {
        if (settled) return;
        settled = true;
        socket.destroy();
        reject(error);
      };

      socket.setTimeout(this.timeoutMs, () => fail(new Error('ClamAV: таймаут ответа')));
      socket.on('error', fail);
      socket.on('data', (chunk: Buffer) => {
        response += chunk.toString('utf8');
      });
      socket.on('end', () => {
        if (settled) return;
        settled = true;
        const text = response.replace(/\0/g, '').trim();
        if (/\bFOUND\b/.test(text)) {
          const signature = text.split(':').slice(1).join(':').replace(/\s*FOUND.*$/, '').trim();
          resolve({ infected: true, signature: signature || undefined });
        } else {
          resolve({ infected: false });
        }
      });

      socket.on('connect', () => {
        socket.write('zINSTREAM\0');
        const size = Buffer.alloc(4);
        size.writeUInt32BE(content.length, 0);
        socket.write(size);
        socket.write(content);
        socket.write(Buffer.alloc(4)); // нулевая длина — конец потока
      });
    });
  }
}

/** Собирает сканер по CLAMAV_HOST: пусто — заглушка, иначе TCP-клиент clamd. */
export function createClamAvScanner(host?: string): ClamAvScanner {
  const value = host?.trim();
  if (!value) return new NoopClamAvScanner();
  const [hostname, port] = value.split(':');
  return new ClamAvInstreamScanner(hostname, port ? Number(port) : 3310);
}
