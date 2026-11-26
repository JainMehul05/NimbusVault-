import { randomUUID } from 'crypto';
import { prisma } from '@/database/prisma';
import { createUser, cleanupUsers, share } from './helpers';
import { intelligence } from '@common/intelligence';
import { localIntelligence, requestStop } from '@modules/ai/local-intelligence';
import request from 'supertest';
import app from '@app';
import { auth } from './helpers';
import { authorizationService } from '@common/authorization';

jest.mock('@common/intelligence', () => ({
  ...jest.requireActual('@common/intelligence'),
  intelligence: jest.fn(),
}));
const call = jest.mocked(intelligence);
const emails=['boundary-a@example.test','boundary-b@example.test'];
let a:Awaited<ReturnType<typeof createUser>>;
let b:Awaited<ReturnType<typeof createUser>>;
let fileId:string;
const source=()=>({file_id:fileId,chunk_id:1,passage:'Aurora produces 73 megawatt hours.',similarity:0.9,citation:1});
afterEach(()=>jest.restoreAllMocks());
beforeEach(async()=>{
  await cleanupUsers(emails);
  a=await createUser(emails[0]);b=await createUser(emails[1]);fileId=randomUUID();
  await prisma.file.create({data:{id:fileId,filename:'aurora.txt',ownerId:a.id,sizeBytes:35n,mimeType:'text/plain',category:'document',s3Key:`cloudvault/files/${fileId}/aurora.txt`,status:'READY',aiStatus:'INDEXED'}});
  call.mockReset();
});
afterAll(()=>cleanupUsers(emails));

it('derives scope on the server even if another user submits an object ID',async()=>{
  call.mockResolvedValue({sources:[]});
  const result=await localIntelligence.search(b.id,'Aurora',{limit:8,fileIds:[fileId]});
  expect(call.mock.calls[0][3]).toEqual([]);
  expect(result.results).toEqual([]);
});
it('withholds a forged unauthorized source returned by the adapter',async()=>{
  call.mockResolvedValue({sources:[source()]});
  expect((await localIntelligence.search(b.id,'Aurora',{limit:8})).results).toEqual([]);
});
it('includes a current share and excludes it after revocation',async()=>{
  await share(a,'FILE',fileId,b,'VIEWER');
  call.mockResolvedValue({sources:[source()]});
  expect((await localIntelligence.search(b.id,'Aurora',{limit:8})).results).toHaveLength(1);
  await prisma.permission.deleteMany({where:{resourceId:fileId,granteeUserId:b.id}});
  expect((await localIntelligence.search(b.id,'Aurora',{limit:8})).results).toEqual([]);
});
it('withholds the entire generated answer when permission is revoked during generation',async()=>{
  await share(a,'FILE',fileId,b,'VIEWER');
  call.mockImplementation(async()=>{
    await prisma.permission.deleteMany({where:{resourceId:fileId,granteeUserId:b.id}});
    return {mode:'generated',answer:'Aurora produces 73 megawatt hours. [1]',model:'qwen2.5:3b',sources:[source()]};
  });
  await expect(localIntelligence.ask(b.id,'What does Aurora produce?',{topK:8})).rejects.toMatchObject({statusCode:404});
});
it('excludes trashed files from trusted scope before retrieval',async()=>{
  await prisma.file.update({where:{id:fileId},data:{deletedAt:new Date()}});
  call.mockResolvedValue({sources:[]});
  await localIntelligence.search(a.id,'Aurora',{limit:8});
  expect(call.mock.calls[0][3]).toEqual([]);
});
it('aggregates dashboard statistics only for the authenticated owner',async()=>{
  await prisma.file.create({data:{filename:'other-private.png',ownerId:b.id,sizeBytes:999n,mimeType:'image/png',category:'image',s3Key:`test/${randomUUID()}`,status:'READY',aiStatus:'UNSUPPORTED'}});
  const response=await request(app).get('/api/v1/files/statistics').set(auth(a));
  expect(response.status).toBe(200);
  expect(response.body.data).toMatchObject({totalFiles:1,totalBytes:'35',indexedFiles:1});
  expect(response.body.data.types).toEqual([{category:'document',count:1,bytes:'35'}]);
});
it('honors a Stop that arrives before the corresponding ask request',async()=>{
  const requestId=randomUUID();
  await requestStop(a.id,requestId);
  await expect(localIntelligence.ask(a.id,'What does Aurora produce?',{topK:8,requestId})).rejects.toMatchObject({statusCode:499});
  expect(call).not.toHaveBeenCalled();
});
it('uses current authorized filenames after a logical rename',async()=>{
  await prisma.file.update({where:{id:fileId},data:{filename:'renamed-policy.txt'}});
  call.mockResolvedValue({sources:[source()]});
  const result=await localIntelligence.search(a.id,'renamed',{limit:8,mode:'filename'});
  expect(call.mock.calls[0][1]).toMatchObject({filenames:{[fileId]:'renamed-policy.txt'}});
  expect(result.results[0].filename).toBe('renamed-policy.txt');
});
it('enforces nested folder scope and denies a private folder',async()=>{
  const root=await prisma.folder.create({data:{name:'Scope root',ownerId:a.id,depth:0}});
  const child=await prisma.folder.create({data:{name:'Scope child',ownerId:a.id,parentFolderId:root.id,depth:1}});
  await prisma.file.update({where:{id:fileId},data:{folderId:child.id}});
  call.mockResolvedValue({sources:[source()]});
  expect((await localIntelligence.search(a.id,'Aurora',{limit:8,folderId:root.id})).results).toHaveLength(1);
  expect(call.mock.calls[0][3]).toEqual([fileId]);
  await expect(localIntelligence.search(b.id,'Aurora',{limit:8,folderId:root.id})).rejects.toMatchObject({statusCode:404});
});
it('applies document category filters before retrieval and groups file results',async()=>{
  call.mockResolvedValue({sources:[]});
  await localIntelligence.search(a.id,'Aurora',{limit:8,category:'image'});
  expect(call.mock.calls[0][3]).toEqual([]);
  call.mockResolvedValue({sources:[source(),{...source(),chunk_id:2}]});
  expect((await localIntelligence.search(a.id,'Aurora',{limit:8})).resultCount).toBe(1);
});
it('does not hide database failures as empty source results',async()=>{
  call.mockResolvedValue({sources:[source()]});
  jest.spyOn(authorizationService,'authorizeFileAccess').mockRejectedValue(new Error('database unavailable'));
  await expect(localIntelligence.search(a.id,'Aurora',{limit:8})).rejects.toThrow('database unavailable');
});
it('requires document write permission even for administrator cloud reconciliation',async()=>{
  await prisma.user.update({where:{id:b.id},data:{role:'admin'}});
  await share(a,'FILE',fileId,b,'VIEWER');
  call.mockResolvedValue({completed:1});
  const result=await request(app).post('/api/v1/ai/cloud/complete').set(auth(b)).send({fileId});
  expect(result.status).toBe(403);
  expect(call).not.toHaveBeenCalled();
});
it('rejects oversized all-document scopes before the private HTTP header is built',async()=>{
  await prisma.file.createMany({data:Array.from({length:250},()=>({id:randomUUID(),filename:'limit.txt',ownerId:a.id,sizeBytes:1n,mimeType:'text/plain',category:'document' as const,s3Key:`test/${randomUUID()}`,status:'READY' as const,aiStatus:'INDEXED' as const}))});
  await expect(localIntelligence.search(a.id,'policy',{limit:8})).rejects.toMatchObject({statusCode:400});
  expect(call).not.toHaveBeenCalled();
});
