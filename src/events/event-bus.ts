import { EventEmitter } from 'node:events';
import type { Logger } from 'pino';
import type { DomainEvent } from './domain-events';

export type EventHandler<Payload> = (payload: Payload, event: DomainEvent<Payload>) => Promise<void> | void;

interface Listener {
  name: string;
  handler: EventHandler<unknown>;
}

/**
 * Minimal in-process domain event bus.
 *
 * `publish` awaits all handlers so tests are deterministic; callers that want
 * fire-and-forget semantics use `dispatch`/`void publish(...)`. Handler errors
 * are isolated and logged so one subscriber never affects the request flow.
 */
export class EventBus {
  private emitter = new EventEmitter();
  private listenerCount = new Map<string, number>();

  constructor(private readonly logger?: Logger) {}

  subscribe<Payload>(name: string, handler: EventHandler<Payload>): () => void {
    const listener: Listener = { name, handler: handler as EventHandler<unknown> };
    const wrapper = async (event: DomainEvent<unknown>): Promise<void> => {
      await this.invoke(listener, event);
    };
    this.emitter.on(name, wrapper);
    this.listenerCount.set(name, (this.listenerCount.get(name) ?? 0) + 1);
    return () => {
      this.emitter.off(name, wrapper);
      const c = this.listenerCount.get(name) ?? 0;
      this.listenerCount.set(name, Math.max(0, c - 1));
    };
  }

  async publish<Payload>(name: string, payload: Payload): Promise<void> {
    const event: DomainEvent<Payload> = { name, payload, occurredAt: new Date() };
    const wrappers = this.emitter.listeners(name);
    if (wrappers.length === 0) {
      this.logger?.warn({ name }, 'domain event published with no subscribers');
      return;
    }
    const tasks = wrappers.map((w) =>
      (w as (e: DomainEvent<Payload>) => Promise<void>)(event).catch(undefined),
    );
    await Promise.all(tasks);
  }

  subscriberCount(name: string): number {
    return this.listenerCount.get(name) ?? 0;
  }

  private async invoke(listener: Listener, event: DomainEvent<unknown>): Promise<void> {
    try {
      await listener.handler(event.payload, event);
    } catch (err) {
      this.logger?.error({ err, event: event.name }, 'event handler failed');
    }
  }
}
