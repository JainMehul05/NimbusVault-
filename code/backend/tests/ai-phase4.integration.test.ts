import request from 'supertest';
import { createCanvas } from '@napi-rs/canvas';
import app from '@app';
import { prisma } from '@/database/prisma';
import { config } from '@/config/index';
import { aiIndexingService } from '@/modules/ai/indexing.service';
import { extractDocument } from '@/modules/ai/extraction';
import { vectorStore } from '@/modules/ai/vector-store';
import { resetProvidersForTesting, setProvidersForTesting, type EmbeddingProvider } from '@/modules/ai/providers';
import { RecordingGenerationDouble } from './ai-doubles';
import { auth, cleanupUsers, createUser, share, upload, type TestUser } from './helpers';

const EMAILS = ['p4-alice@example.com', 'p4-bob@example.com'];

/** 384-dimension bag-of-words, so the real HNSW index applies. */
class Embedder384 implements EmbeddingProvider {
  readonly name = 'test-double';
  readonly model = 'bow';
  readonly dimensions = 384;
  readonly modelId = 'test:bow@384';
  readonly sendsDataExternally = false;
  async embed(texts: string[]) {
    return texts.map((t) => {
      const v = new Array(384).fill(0.0001);
      for (const w of t.toLowerCase().match(/[a-z]{3,}/g) ?? []) v[[...w].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 384, 7)] += 1;
      const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
      return v.map((x) => x / n);
    });
  }
}

let alice: TestUser;
let bob: TestUser;
let gen: RecordingGenerationDouble;

beforeEach(async () => {
  await cleanupUsers(EMAILS);
  alice = await createUser(EMAILS[0]);
  bob = await createUser(EMAILS[1]);
  gen = new RecordingGenerationDouble();
  setProvidersForTesting({ embedding: new Embedder384(), generation: gen });
});
afterEach(() => {
  jest.restoreAllMocks();
});
afterAll(async () => {
  resetProvidersForTesting();
  await cleanupUsers(EMAILS);
});

const search = (u: TestUser, query: string) => request(app).post('/api/v1/ai/search').set(auth(u)).send({ query });

describe('HNSW search path', () => {
  const original = config.ai.embedding.annThreshold;
  afterEach(() => {
    config.ai.embedding.annThreshold = original;
  });

  it('returns the same results as exact search and enforces the same permissions', async () => {
    const topics = ['penguins antarctica ice', 'volcano lava eruption', 'guitar music chords', 'bread baking flour', 'satellite orbit launch'];
    for (const [i, t] of topics.entries()) await upload(alice, `a${i}.txt`, `${t} `.repeat(10));
    const secret = await upload(bob, 'secret.txt', 'penguins antarctica ice secret '.repeat(10));
    await aiIndexingService.drain();

    const exact = (await search(alice, 'penguins in antarctica').expect(200)).body.data.results;
    const sql = jest.spyOn(prisma, '$transaction');
    config.ai.embedding.annThreshold = 0;
    const ann = (await search(alice, 'penguins in antarctica').expect(200)).body.data.results;
    expect(sql).toHaveBeenCalled(); // the ANN path runs inside a transaction
    expect(ann.map((r: { fileId: string }) => r.fileId)).toEqual(exact.map((r: { fileId: string }) => r.fileId));
    expect(ann[0].filename).toBe('a0.txt');
    expect(JSON.stringify(ann)).not.toContain(secret);

    await share(bob, 'FILE', secret, alice, 'VIEWER');
    expect(JSON.stringify((await search(alice, 'penguins in antarctica')).body)).toContain(secret);
    await request(app).delete(`/api/v1/sharing/FILE/${secret}/${alice.id}`).set(auth(bob)).expect(200);
    expect(JSON.stringify((await search(alice, 'penguins in antarctica')).body)).not.toContain(secret);
  });

  it('has an index the planner can use for this expression', async () => {
    const vec = `[${new Array(384).fill(0.1).join(',')}]`;
    const plan = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET LOCAL enable_seqscan = off');
      await tx.$executeRawUnsafe('SET LOCAL enable_sort = off');
      return tx.$queryRawUnsafe<Array<{ 'QUERY PLAN': string }>>(
        `EXPLAIN SELECT "id" FROM "document_chunks" c WHERE c."embeddingModel" LIKE '%@384' ORDER BY (c."embedding"::vector(384) <=> '${vec}'::vector(384)) LIMIT 5`
      );
    });
    expect(plan.map((p) => p['QUERY PLAN']).join('\n')).toContain('document_chunks_embedding_384_hnsw');
  });

  it('is not used for other dimensions', async () => {
    config.ai.embedding.annThreshold = 0;
    await expect(vectorStore.search({ userId: alice.id, queryVector: [1, 0, 0], modelId: 'x@3', limit: 3, minScore: 0 })).resolves.toEqual([]);
  });
});

describe('job resilience', () => {
  it('abandons a document that keeps crashing the worker', async () => {
    const id = await upload(alice, 'crash.txt', 'some text here');
    await prisma.aiJob.updateMany({ where: { fileId: id }, data: { status: 'RUNNING', attempts: 3, lockedBy: 'dead', lockedAt: new Date(Date.now() - 3600_000) } });
    await aiIndexingService.recoverStaleJobs();
    expect((await prisma.aiJob.findFirstOrThrow({ where: { fileId: id } })).status).toBe('FAILED');
    expect((await prisma.file.findUniqueOrThrow({ where: { id } })).aiStatus).toBe('FAILED');
    // ...but the user can still retry explicitly.
    await request(app).post(`/api/v1/ai/files/${id}/index`).set(auth(alice)).expect(202);
    expect(await aiIndexingService.drain()).toContain('succeeded');
  });

  it('a renewed lock protects a long job from being re-queued', async () => {
    const id = await upload(alice, 'long.txt', 'some text here');
    const job = (await aiIndexingService.claimNextJob('w1'))!;
    await prisma.aiJob.update({ where: { id: job.id }, data: { lockedAt: new Date(Date.now() - 3600_000) } });
    await aiIndexingService.renewLock(job);
    expect(await aiIndexingService.recoverStaleJobs()).toBe(0);
    expect(await aiIndexingService.processJob(job)).toBe('succeeded');
    expect(id).toBe(job.fileId);
  });

  it('claims each job once across competing workers', async () => {
    for (let i = 0; i < 4; i++) await upload(alice, `j${i}.txt`, 'text content');
    const claimed = await Promise.all(Array.from({ length: 8 }, (_, i) => aiIndexingService.claimNextJob(`w${i}`)));
    const ids = claimed.filter(Boolean).map((j) => j!.id);
    expect(ids).toHaveLength(4);
    expect(new Set(ids).size).toBe(4);
  });

  it('re-indexes a restored file', async () => {
    const id = await upload(alice, 'r.txt', 'restorable penguin text');
    await aiIndexingService.drain();
    await request(app).delete(`/api/v1/files/${id}`).set(auth(alice));
    expect(await prisma.documentChunk.count({ where: { fileId: id } })).toBe(0);
    await request(app).post(`/api/v1/trash/files/${id}/restore`).set(auth(alice)).expect(200);
    await aiIndexingService.drain();
    expect((await search(alice, 'penguin')).body.data.results[0].fileId).toBe(id);
  });
});

describe('answers', () => {
  it('withholds an answer when access to a source is revoked while it is being written', async () => {
    const id = await upload(alice, 'plan.txt', 'the secret launch code is penguin');
    await aiIndexingService.drain();
    await share(alice, 'FILE', id, bob, 'VIEWER');
    gen.requests = [];
    const generate = gen.generate.bind(gen);
    jest.spyOn(gen, 'generate').mockImplementation(async (r) => {
      await request(app).delete(`/api/v1/sharing/FILE/${id}/${bob.id}`).set(auth(alice)).expect(200);
      return generate(r);
    });
    const res = await request(app).post('/api/v1/ai/ask').set(auth(bob)).send({ question: 'What is the launch code?' }).expect(409);
    expect(res.body.error.code).toBe('SOURCES_CHANGED');
    expect(JSON.stringify(res.body)).not.toContain('penguin');
  });
});

describe('OCR', () => {
  /** A PDF whose only content is a JPEG picture of text, like a scanner produces. */
  function scannedPdf(lines: string[]): Buffer {
    const canvas = createCanvas(1200, 400);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, 1200, 400);
    ctx.fillStyle = 'black';
    ctx.font = '48px Arial, DejaVu Sans, Liberation Sans, sans-serif';
    lines.forEach((l, i) => ctx.fillText(l, 60, 110 + i * 100));
    const jpeg = canvas.toBuffer('image/jpeg');
    const content = Buffer.from('q 600 0 0 200 0 0 cm /Im0 Do Q');
    const objects: Buffer[] = [
      Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'),
      Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
      Buffer.from('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 200] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>'),
      Buffer.concat([Buffer.from(`<< /Type /XObject /Subtype /Image /Width 1200 /Height 400 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`), jpeg, Buffer.from('\nendstream')]),
      Buffer.concat([Buffer.from(`<< /Length ${content.length} >>\nstream\n`), content, Buffer.from('\nendstream')]),
    ];
    const out: Buffer[] = [Buffer.from('%PDF-1.4\n')];
    const offsets: number[] = [];
    let at = out[0].length;
    objects.forEach((o, i) => {
      offsets.push(at);
      const b = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`), o, Buffer.from('\nendobj\n')]);
      out.push(b);
      at += b.length;
    });
    out.push(Buffer.from(`xref\n0 6\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer << /Size 6 /Root 1 0 R >>\nstartxref\n${at}\n%%EOF`));
    return Buffer.concat(out);
  }

  const limits = { maxBytes: 10_000_000, maxChars: 100_000, maxPdfPages: 10 };
  const ocr = { enabled: true, maxPages: 3, language: 'eng', dataPath: '', pageTimeoutMs: 60_000 };

  it('reads a scanned PDF locally when enabled, and says OCR is required when not', async () => {
    const pdf = scannedPdf(['Quarterly revenue report', 'Total amount 4821 dollars']);
    await expect(extractDocument(pdf, 'application/pdf', limits)).rejects.toMatchObject({ code: 'OCR_REQUIRED' });
    const result = await extractDocument(pdf, 'application/pdf', { ...limits, ocr });
    expect(result.extractor).toBe('tesseract-ocr');
    expect(result.text).toMatch(/Quarterly revenue report/i);
    expect(result.text).toMatch(/4821/);
    expect(result.pages).toEqual([expect.objectContaining({ page: 1, start: 0 })]);
  }, 120_000);

  it('still reports OCR_REQUIRED when a scan has no readable text', async () => {
    await expect(extractDocument(scannedPdf([]), 'application/pdf', { ...limits, ocr })).rejects.toMatchObject({ code: 'OCR_REQUIRED' });
  }, 120_000);
});
