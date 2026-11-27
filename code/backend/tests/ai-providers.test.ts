import http from 'http';
import type { AddressInfo } from 'net';
import { AnthropicGenerationProvider, OpenAICompatibleGenerationProvider } from '@/modules/ai/providers/generation';
import { OpenAICompatibleEmbeddingProvider } from '@/modules/ai/providers/embeddings';
import { isLocalUrl } from '@/modules/ai/providers/http';
import { AiProviderError } from '@/modules/ai/providers';
import { zipWithinLimit } from '@/modules/ai/zip-guard';
import { deflateRawSync } from 'zlib';

/** A real HTTP server standing in for the hosted API: exercises the actual wire protocol. */
let server: http.Server;
let base: string;
let handler: (req: http.IncomingMessage, body: any, res: http.ServerResponse) => void;
let last: { url?: string; headers: http.IncomingHttpHeaders; body: any };

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const body = JSON.parse(raw || '{}');
      last = { url: req.url, headers: req.headers, body };
      handler(req, body, res);
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => {
  server.closeAllConnections();
  return new Promise((r) => server.close(r));
});

const json = (status: number, body: unknown) => (_: unknown, __: unknown, res: http.ServerResponse) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};
const req = { system: 'SYS', messages: [{ role: 'user' as const, content: 'CONFIDENTIAL document text' }], maxTokens: 100 };
const anthropic = (timeout = 2000) => new AnthropicGenerationProvider('claude-haiku-5-5', base, 'sk-secret-key', timeout);
const openai = (timeout = 2000) => new OpenAICompatibleGenerationProvider('gpt-4o-mini', base, 'sk-secret-key', timeout);
const failure = async (p: Promise<unknown>): Promise<AiProviderError> => {
  const err = await p.then(() => null, (e) => e);
  expect(err).toBeInstanceOf(AiProviderError);
  expect(err.message).not.toMatch(/CONFIDENTIAL|sk-secret/);
  return err;
};

describe('Anthropic provider', () => {
  it('sends a request current models accept and reads only text blocks', async () => {
    handler = json(200, { model: 'claude-haiku-5-5', stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: 'hidden' }, { type: 'text', text: 'An' }, { type: 'text', text: 'swer' }], usage: { input_tokens: 5, output_tokens: 2 } });
    const out = await anthropic().generate({ ...req, temperature: 0 });
    expect(out).toMatchObject({ text: 'Answer', model: 'claude-haiku-5-5', truncated: false, usage: { inputTokens: 5, outputTokens: 2 } });
    expect(last.url).toBe('/v1/messages');
    expect(last.headers['x-api-key']).toBe('sk-secret-key');
    expect(last.headers['anthropic-version']).toBe('2023-06-01');
    expect(last.body).toMatchObject({ model: 'claude-haiku-5-5', system: 'SYS' });
    expect(last.body.max_tokens).toBeGreaterThan(req.maxTokens); // room for thinking
    for (const removed of ['temperature', 'top_p', 'top_k']) expect(last.body).not.toHaveProperty(removed);
  });

  it('reports refusals and empty or malformed replies', async () => {
    handler = json(200, { stop_reason: 'refusal', content: [] });
    expect(await failure(anthropic().generate(req))).toMatchObject({ retryable: false });
    handler = json(200, { stop_reason: 'end_turn', content: [] });
    expect((await failure(anthropic().generate(req))).message).toMatch(/no text/);
    handler = json(200, {});
    await failure(anthropic().generate(req));
    handler = json(200, { content: 'oops' });
    await failure(anthropic().generate(req));
  });

  it('flags truncated replies', async () => {
    handler = json(200, { stop_reason: 'max_tokens', content: [{ type: 'text', text: 'partial' }] });
    expect((await anthropic().generate(req)).truncated).toBe(true);
  });
});

describe.each([['anthropic', anthropic], ['openai', openai]] as const)('%s failures', (_name, make) => {
  it('does not retry bad credentials, and retries rate limits and outages', async () => {
    handler = json(401, { error: { type: 'authentication_error', message: 'bad key sk-secret-key CONFIDENTIAL' } });
    expect(await failure(make().generate(req))).toMatchObject({ retryable: false, status: 401 });
    for (const [status, retryable] of [[400, false], [403, false], [404, false], [408, true], [429, true], [500, true], [529, true]] as const) {
      handler = json(status, { error: { type: 'some_error' } });
      expect(await failure(make().generate(req))).toMatchObject({ retryable, status });
    }
  });

  it('never repeats free-form error text', async () => {
    handler = json(400, { error: { type: 'CONFIDENTIAL text with spaces', message: 'CONFIDENTIAL' } });
    await failure(make().generate(req));
  });

  it('times out on silence and on a reply that never finishes', async () => {
    handler = () => {};
    expect(await failure(make(150).generate(req))).toMatchObject({ retryable: true, message: expect.stringMatching(/timed out/) });
    handler = (_r, _b, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.write('{"content":');
    };
    expect((await failure(make(150).generate(req))).message).toMatch(/timed out/);
  });

  it('handles non-JSON, redirects and an unreachable host', async () => {
    handler = (_r, _b, res) => res.end('<html>gateway</html>');
    expect((await failure(make().generate(req))).message).toMatch(/invalid response/);
    handler = (_r, _b, res) => {
      res.writeHead(307, { location: 'http://127.0.0.1:1/steal' });
      res.end();
    };
    await failure(make().generate(req));
    const dead = new AnthropicGenerationProvider('m', 'http://127.0.0.1:1', 'k', 500);
    expect(await failure(dead.generate(req))).toMatchObject({ retryable: true });
  });
});

describe('OpenAI-compatible providers', () => {
  it('generates and reports usage', async () => {
    handler = json(200, { model: 'gpt-4o-mini', choices: [{ message: { content: 'Hi' }, finish_reason: 'length' }], usage: { prompt_tokens: 3, completion_tokens: 1 } });
    expect(await openai().generate(req)).toMatchObject({ text: 'Hi', truncated: true, usage: { inputTokens: 3, outputTokens: 1 } });
    expect(last.headers.authorization).toBe('Bearer sk-secret-key');
    handler = json(200, { choices: [] });
    await failure(openai().generate(req));
  });

  it('reorders, normalizes and validates embeddings', async () => {
    const provider = new OpenAICompatibleEmbeddingProvider('m', 2, base, 'k', 2000);
    handler = json(200, { data: [{ index: 1, embedding: [0, 5] }, { index: 0, embedding: [3, 4] }] });
    expect(await provider.embed(['a', 'b'])).toEqual([[0.6, 0.8], [0, 1]]);
    for (const data of [[{ index: 0, embedding: [1] }], [{ index: 0, embedding: [1, null] }], [], 'no']) {
      handler = json(200, { data });
      await failure(provider.embed(['a']));
    }
  });

  it('knows which endpoints keep data on the local network', () => {
    expect(['http://localhost:11434', 'http://127.0.0.1', 'http://[::1]:8080', 'http://10.1.2.3', 'http://192.168.0.4', 'http://172.20.0.1'].every(isLocalUrl)).toBe(true);
    expect(['https://api.openai.com', 'https://api.anthropic.com', 'http://172.32.0.1', 'http://10.evil.com', 'not a url'].some(isLocalUrl)).toBe(false);
  });
});

describe('zip guard', () => {
  const zip = (name: string, content: Buffer, claimed = content.length) => {
    const data = deflateRawSync(content);
    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(claimed, 22);
    local.writeUInt16LE(name.length, 26);
    local.write(name, 30);
    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(claimed, 24);
    central.writeUInt16LE(name.length, 28);
    central.write(name, 46);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(1, 8);
    end.writeUInt16LE(1, 10);
    end.writeUInt32LE(central.length, 12);
    end.writeUInt32LE(local.length + data.length, 16);
    return Buffer.concat([local, data, central, end]);
  };

  it('measures real expansion, ignoring the sizes the archive claims', () => {
    const bomb = zip('word/document.xml', Buffer.alloc(5_000_000), 10);
    expect(bomb.length).toBeLessThan(20_000);
    expect(zipWithinLimit(bomb, 1_000_000)).toBe(false);
    expect(zipWithinLimit(bomb, 10_000_000)).toBe(true);
    expect(zipWithinLimit(zip('a', Buffer.from('hello')), 100)).toBe(true);
    expect(zipWithinLimit(Buffer.from('PK\x03\x04 not really'), 100)).toBe(false);
  });
});
