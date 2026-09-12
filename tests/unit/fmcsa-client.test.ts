/**
 * The FMCSA client's failure behaviour.
 *
 * Every branch here exists so that a lookup which did not succeed can never be
 * mistaken for one that did. The disabled case matters most: without a web key
 * the platform must say "self-declared", which means the client has to report
 * DISABLED rather than throwing or returning an empty carrier.
 */
import { createFmcsaClient } from '../../src/modules/trust/fmcsa.client';

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

const ACTIVE_PAYLOAD = {
  content: {
    carrier: {
      dotNumber: 1234567,
      legalName: 'NORTHLINE PARTNERS INC',
      mcNumber: 'MC188421',
      allowedToOperate: 'Y',
      statusCode: 'A',
    },
  },
};

describe('createFmcsaClient', () => {
  it('is disabled without a web key and never reaches the network', async () => {
    const fetchImpl = jest.fn();
    const client = createFmcsaClient({ webKey: '', fetchImpl: fetchImpl as unknown as typeof fetch });

    expect(client.enabled).toBe(false);
    await expect(client.lookupByDot('1234567')).resolves.toEqual({ ok: false, reason: 'DISABLED' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('treats whitespace as no key', () => {
    expect(createFmcsaClient({ webKey: '   ' }).enabled).toBe(false);
  });

  it('returns the mapped carrier on a hit', async () => {
    const fetchImpl = jest.fn(async () => jsonResponse(ACTIVE_PAYLOAD));
    const client = createFmcsaClient({ webKey: 'key', fetchImpl: fetchImpl as unknown as typeof fetch });

    const res = await client.lookupByDot('USDOT 1234567');
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.carrier.status).toBe('ACTIVE');
      expect(res.carrier.legalName).toBe('NORTHLINE PARTNERS INC');
    }
    // The key and the normalized DOT both have to reach the URL.
    const url = String((fetchImpl.mock.calls[0] as unknown[])[0]);
    expect(url).toContain('/carriers/1234567');
    expect(url).toContain('webKey=key');
  });

  it('rejects an unusable DOT before spending a request', async () => {
    const fetchImpl = jest.fn();
    const client = createFmcsaClient({ webKey: 'key', fetchImpl: fetchImpl as unknown as typeof fetch });

    const res = await client.lookupByDot('not-a-number');
    expect(res).toEqual({ ok: false, reason: 'NOT_FOUND', detail: 'invalid USDOT number' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('reads a 404 as "no such carrier", not as an outage', async () => {
    const fetchImpl = jest.fn(async () => jsonResponse({}, 404));
    const client = createFmcsaClient({ webKey: 'key', fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(client.lookupByDot('123')).resolves.toEqual({ ok: false, reason: 'NOT_FOUND' });
  });

  it('classifies an upstream error without throwing', async () => {
    const fetchImpl = jest.fn(async () => jsonResponse({}, 503));
    const client = createFmcsaClient({ webKey: 'key', fetchImpl: fetchImpl as unknown as typeof fetch });

    const res = await client.lookupByDot('1234567');
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toBe('UPSTREAM_ERROR');
      expect(res.detail).toContain('503');
    }
  });

  it('survives a network throw', async () => {
    const fetchImpl = jest.fn(async () => {
      throw new Error('socket hang up');
    });
    const client = createFmcsaClient({ webKey: 'key', fetchImpl: fetchImpl as unknown as typeof fetch });

    const res = await client.lookupByDot('1234567');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('UPSTREAM_ERROR');
  });

  it('times out rather than hanging a request', async () => {
    const fetchImpl = jest.fn(
      async (_url: unknown, init?: { signal?: AbortSignal }) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const err = new Error('aborted');
            err.name = 'AbortError';
            reject(err);
          });
        }),
    );
    const client = createFmcsaClient({
      webKey: 'key',
      timeoutMs: 10,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const res = await client.lookupByDot('1234567');
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toBe('UPSTREAM_ERROR');
      expect(res.detail).toMatch(/timed out/i);
    }
  });

  it('does not invent a carrier from a payload with no record', async () => {
    const fetchImpl = jest.fn(async () => jsonResponse({ content: [] }));
    const client = createFmcsaClient({ webKey: 'key', fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(client.lookupByDot('1234567')).resolves.toEqual({ ok: false, reason: 'NOT_FOUND' });
  });
});
