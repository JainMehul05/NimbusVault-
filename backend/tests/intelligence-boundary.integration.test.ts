import { randomUUID } from 'crypto';
import { prisma } from '@/database/prisma';
import { createUser, cleanupUsers, share } from './helpers';
import { intelligence } from '@common/intelligence';
import { localIntelligence } from '@modules/ai/local-intelligence';

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
