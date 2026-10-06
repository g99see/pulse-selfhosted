// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Минимальный клиент Discord Gateway поверх встроенного WebSocket Node 22+
 * (без зависимостей). Принимает личные сообщения боту и slash-команду /link,
 * шлёт heartbeat, при обрыве переподключается с нарастающей паузой. В тестах
 * и при DISCORD_API_FAKE=1 не стартует.
 */
import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { DISCORD_API, type DiscordApi } from './discord-api';
import { parseInteractionCreate, parseMessageCreate } from './discord-events';
import { DiscordService } from './discord.service';

const GATEWAY_URL = 'wss://gateway.discord.gg/?v=10&encoding=json';
/** Intent DIRECT_MESSAGES: содержимое личных сообщений доступно без привилегий. */
const INTENT_DIRECT_MESSAGES = 1 << 12;
const MAX_RECONNECT_DELAY_MS = 60_000;

interface GatewayPayload {
  op: number;
  d?: unknown;
  s?: number | null;
  t?: string | null;
}

@Injectable()
export class DiscordGateway implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DiscordGateway.name);
  private readonly token = process.env.DISCORD_BOT_TOKEN ?? '';
  private readonly autoStart =
    process.env.NODE_ENV !== 'test' && process.env.DISCORD_API_FAKE !== '1';

  private socket: WebSocket | null = null;
  private heartbeat: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private sequence: number | null = null;
  private ackReceived = true;
  private stopped = false;
  private failures = 0;

  constructor(
    private readonly service: DiscordService,
    @Inject(DISCORD_API) private readonly api: DiscordApi,
  ) {}

  onModuleInit(): void {
    if (!this.autoStart || this.token.length === 0) return;
    this.logger.log('Discord-бот: подключение к Gateway');
    void this.api.registerCommands().catch((error: unknown) => {
      this.logger.warn(
        `Не удалось зарегистрировать /link: ${error instanceof Error ? error.message : 'unknown'}`,
      );
    });
    this.connect();
  }

  onModuleDestroy(): void {
    this.stopped = true;
    this.clearTimers();
    this.socket?.close(1000);
    this.socket = null;
  }

  private connect(): void {
    if (this.stopped) return;
    try {
      const socket = new WebSocket(GATEWAY_URL);
      this.socket = socket;
      socket.onmessage = (event) => this.onMessage(String(event.data));
      socket.onclose = () => this.onClose();
      socket.onerror = () => undefined; // onclose сработает следом
    } catch (error) {
      this.logger.warn(`Gateway: ${error instanceof Error ? error.message : 'unknown'}`);
      this.scheduleReconnect();
    }
  }

  private onMessage(raw: string): void {
    let payload: GatewayPayload;
    try {
      payload = JSON.parse(raw) as GatewayPayload;
    } catch {
      return;
    }
    if (typeof payload.s === 'number') this.sequence = payload.s;

    switch (payload.op) {
      case 10: {
        // HELLO: запускаем heartbeat и представляемся.
        const interval = (payload.d as { heartbeat_interval?: number } | undefined)
          ?.heartbeat_interval;
        this.startHeartbeat(typeof interval === 'number' ? interval : 41_250);
        this.send({
          op: 2,
          d: {
            token: this.token,
            intents: INTENT_DIRECT_MESSAGES,
            properties: { os: 'linux', browser: 'puls', device: 'puls' },
          },
        });
        return;
      }
      case 11:
        this.ackReceived = true;
        return;
      case 1:
        this.send({ op: 1, d: this.sequence });
        return;
      case 7:
      case 9:
        // RECONNECT / INVALID_SESSION: проще всего начать заново.
        this.socket?.close(4000);
        return;
      case 0:
        this.onDispatch(payload);
        return;
      default:
        return;
    }
  }

  private onDispatch(payload: GatewayPayload): void {
    if (payload.t === 'READY') this.failures = 0;

    const event =
      payload.t === 'MESSAGE_CREATE'
        ? parseMessageCreate(payload.d)
        : payload.t === 'INTERACTION_CREATE'
          ? parseInteractionCreate(payload.d)
          : null;
    if (!event) return;

    void this.service.handleEvent(event).catch((error: unknown) => {
      this.logger.warn(
        `Ошибка обработки события Discord: ${error instanceof Error ? error.message : 'unknown'}`,
      );
    });
  }

  private startHeartbeat(intervalMs: number): void {
    this.clearTimers();
    this.ackReceived = true;
    this.heartbeat = setInterval(() => {
      if (!this.ackReceived) {
        // Сервер не ответил на прошлый heartbeat — соединение «зависло».
        this.socket?.close(4000);
        return;
      }
      this.ackReceived = false;
      this.send({ op: 1, d: this.sequence });
    }, intervalMs);
    this.heartbeat.unref?.();
  }

  private send(payload: GatewayPayload): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(payload));
  }

  private onClose(): void {
    this.clearTimers();
    this.socket = null;
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    this.failures += 1;
    const delay = Math.min(MAX_RECONNECT_DELAY_MS, 2_000 * 2 ** Math.min(this.failures, 5));
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
    this.reconnectTimer.unref?.();
  }

  private clearTimers(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }
}
