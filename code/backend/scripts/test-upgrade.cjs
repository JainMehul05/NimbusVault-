/**
 * Proves that an existing database upgrades without losing data:
 *   node scripts/test-upgrade.cjs <url of an EMPTY database whose name contains "test">
 * Applies the migrations before phase-5 hardening, inserts representative legacy rows,
 * applies hardening plus all later migrations, and checks everything survived.
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const url = process.argv[2];
if (!url || (!/test/i.test(new URL(url).pathname) && process.env.ALLOW_DESTRUCTIVE_TESTS !== 'true')) {
  console.error('Give the URL of an empty database whose name contains "test"');
  process.exit(1);
}
process.env.DATABASE_URL = url;
const root = path.join(__dirname, '..');
const migrations = path.join(root, 'prisma/migrations');
const folders = fs.readdirSync(migrations).filter((f) => fs.statSync(path.join(migrations, f)).isDirectory()).sort();
// The fixtures intentionally predate the constraints/data repairs introduced by hardening.
// Adding a newer migration must not silently move that fixture baseline forward.
const hardening = '20261125000000_phase5_hardening';
const baselineIndex = folders.indexOf(hardening);
if (baselineIndex < 1) throw new Error('Expected the pre-hardening upgrade baseline');
const pending = folders.slice(baselineIndex);

const deploy = (schema) => {
  const cli = require.resolve('prisma/build/index.js');
  const r = spawnSync(process.execPath, [cli, 'migrate', 'deploy', '--schema', schema], { stdio: 'inherit', env: process.env });
  if (r.status !== 0) process.exit(r.status ?? 1);
};
const assert = (ok, message) => {
  if (!ok) throw new Error(`FAILED: ${message}`);
  console.log(`ok - ${message}`);
};

(async () => {
  // A copy with the exact legacy migration baseline required by these fixtures.
  const old = fs.mkdtempSync(path.join(os.tmpdir(), 'nv-upgrade-'));
  fs.cpSync(path.join(root, 'prisma'), old, { recursive: true });
  for (const migration of pending) fs.rmSync(path.join(old, 'migrations', migration), { recursive: true });
  deploy(path.join(old, 'schema.prisma'));

  const { PrismaClient } = require('@prisma/client');
  const db = new PrismaClient();
  const sql = (q) => db.$executeRawUnsafe(q);
  await sql(`INSERT INTO users (id, name, email, "passwordHash", "storageUsedBytes", "updatedAt") VALUES ('u1','A','Mixed@Case.com','x',100,now()), ('u2','B','b@b.com','x',-5,now())`);
  await sql(`INSERT INTO folders (id, name, "ownerId", "parentFolderId", "deletedAt", "createdAt", "updatedAt") VALUES
    ('f1','Docs','u1',NULL,NULL,'2026-01-01',now()), ('f2-duplicate','Docs','u1',NULL,NULL,'2026-01-02',now()),
    ('f3','Sub','u1','f1',now(),now(),now()), ('f4','Docs','u2',NULL,NULL,now(),now())`);
  await sql(`INSERT INTO files (id, filename, "sizeBytes", "mimeType", category, "ownerId", "folderId", "s3Key", status) VALUES ('file1','a.txt',100,'text/plain','document','u1','f1','k1','READY')`);
  await sql(`INSERT INTO share_links (id, "fileId", "createdBy", token, permission) VALUES ('s1','file1','u1','$2b$04$hash','VIEW')`);
  await sql(`INSERT INTO permissions (id, "resourceType", "resourceId", "granteeUserId", level, "grantedBy") VALUES ('p1','FOLDER','f1','u2','EDITOR','u1')`);
  await sql(`INSERT INTO activity_logs ("userId", action, "createdAt") VALUES ('u1','file_upload',now())`);
  await sql(`INSERT INTO refresh_tokens (id, "userId", "tokenHash", "tokenFamily", "expiresAt") VALUES ('r1','u1','$2b$04$legacy','fam',now() + interval '1 day')`);
  await sql(`INSERT INTO document_indexes ("fileId", "updatedAt") VALUES ('file1', now())`);
  await sql(`INSERT INTO document_chunks (id, "fileId", generation, "chunkIndex", content, "charStart", "charEnd", "tokenEstimate", "embeddingModel", embedding) VALUES
    ('c1','file1',1,0,'x',0,1,1,'local:m@384', ('[' || array_to_string(array_fill(0.1::float, ARRAY[384]), ',') || ']')::vector),
    ('c2','file1',1,1,'y',0,1,1,'openai:m@3', '[1,2,3]'::vector)`);
  const tables = ['users', 'folders', 'files', 'share_links', 'permissions', 'activity_logs', 'refresh_tokens', 'document_indexes', 'document_chunks'];
  const counts = async () => Object.fromEntries(await Promise.all(tables.map(async (t) => [t, Number((await db.$queryRawUnsafe(`SELECT COUNT(*) AS n FROM ${t}`))[0].n)])));
  const before = await counts();

  deploy(path.join(root, 'prisma/schema.prisma'));

  assert(JSON.stringify(await counts()) === JSON.stringify(before), 'every row survived the upgrade');
  assert((await db.user.findUnique({ where: { id: 'u1' } })).externalAiConsent === false, 'legacy users remain opted out of external AI after upgrade');
  const names = (await db.folder.findMany({ where: { ownerId: 'u1', parentFolderId: null }, orderBy: { createdAt: 'asc' } })).map((f) => f.name);
  assert(names[0] === 'Docs' && names[1] === 'Docs (f2-dupli)', 'duplicate top-level folders were renamed, not removed');
  assert((await db.user.findUnique({ where: { id: 'u2' } })).storageUsedBytes === 0n, 'negative storage usage was corrected');
  assert((await db.user.findUnique({ where: { id: 'u1' } })).storageUsedBytes === 100n, 'valid storage usage was kept');
  await db.folder.create({ data: { name: 'Sub', ownerId: 'u1', parentFolderId: 'f1' } });
  assert(true, 'the name of a deleted folder can be reused');
  const clash = await db.folder.create({ data: { name: 'Docs', ownerId: 'u1' } }).then(() => false, () => true);
  assert(clash, 'duplicate live folder names are refused by the database');
  const again = spawnSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'status', '--schema', path.join(root, 'prisma/schema.prisma')], { env: process.env });
  assert(again.status === 0, 'migration history is consistent');
  await db.$disconnect();
  fs.rmSync(old, { recursive: true, force: true });
  console.log('Upgrade test passed');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
