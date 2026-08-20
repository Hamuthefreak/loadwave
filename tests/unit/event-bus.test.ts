import { EventBus } from '../../src/events/event-bus';

describe('EventBus', () => {
  it('invokes subscribed handlers with the payload', async () => {
    const bus = new EventBus();
    const seen: number[] = [];
    bus.subscribe<{ v: number }>('Sample', async (payload) => {
      seen.push(payload.v);
    });
    await bus.publish('Sample', { v: 42 });
    await new Promise((r) => setTimeout(r, 0));
    expect(seen).toEqual([42]);
  });

  it('isolates handler errors so publish never throws', async () => {
    const bus = new EventBus();
    bus.subscribe('Flaky', async () => {
      throw new Error('boom');
    });
    bus.subscribe<{ ok: boolean }>('Flaky', async (payload) => {
      expect(payload.ok).toBe(true);
    });
    await expect(bus.publish('Flaky', { ok: true })).resolves.toBeUndefined();
    await new Promise((r) => setTimeout(r, 0));
  });

  it('supports unsubscribing', async () => {
    const bus = new EventBus();
    let calls = 0;
    const off = bus.subscribe('Evt', () => {
      calls += 1;
    });
    await bus.publish('Evt', {});
    off();
    await bus.publish('Evt', {});
    await new Promise((r) => setTimeout(r, 0));
    expect(calls).toBe(1);
  });

  it('reports the subscriber count per event', async () => {
    const bus = new EventBus();
    bus.subscribe('A', () => undefined);
    bus.subscribe('A', () => undefined);
    bus.subscribe('B', () => undefined);
    expect(bus.subscriberCount('A')).toBe(2);
    expect(bus.subscriberCount('B')).toBe(1);
    expect(bus.subscriberCount('Nope')).toBe(0);
  });
});
