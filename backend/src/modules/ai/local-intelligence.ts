import { randomUUID } from 'crypto';
import type { FileCategory } from '@prisma/client';
import prisma from '@database/prisma';
import { authorizationService } from '@common/authorization';
import { intelligence } from '@common/intelligence';
import { AppError } from '@common/errors';
import type { SearchResult, AnswerResult } from './rag.service';
export const activeRequests = new Map<string,string>();
const pendingStops=new Map<string,number>();
export async function requestStop(userId:string,requestId:string) {
  const active=activeRequests.get(requestId);
  if(active && active!==userId) throw AppError.notFound('Active request not found');
  if(active===userId) return intelligence('/api/ai/cancel',{request_id:requestId},userId);
  for(const [key,until] of pendingStops) if(until<Date.now()) pendingStops.delete(key);
  if(pendingStops.size>=128) pendingStops.delete(pendingStops.keys().next().value!);
  pendingStops.set(`${userId}:${requestId}`,Date.now()+30000);
  return {cancellation_requested:true};
}
interface EvidenceSource { file_id:string;chunk_id:number;passage:string;similarity:number;citation?:number }
interface LocalAnswer { mode:'generated'|'extractive'|'insufficient';answer:string;model:string|null;sources:EvidenceSource[];warning?:string;conversation_id?:string;timings?:Record<string,unknown> }

export async function allowedScope(userId: string, selected?: string[], filters?:{folderId?:string;category?:FileCategory}) {
  const ids = await authorizationService.listAccessibleFileIds(userId, selected);
  let folderIds:string[]|undefined;
  if(filters?.folderId){
    await authorizationService.authorizeFolderAccess({userId,isAuthenticated:true},filters.folderId,'read');
    const descendants=await prisma.$queryRaw<Array<{id:string}>>`WITH RECURSIVE sub(id) AS (SELECT id FROM folders WHERE id=${filters.folderId} AND "deletedAt" IS NULL UNION SELECT f.id FROM folders f JOIN sub ON f."parentFolderId"=sub.id WHERE f."deletedAt" IS NULL) SELECT id FROM sub`;
    folderIds=descendants.map(f=>f.id);
  }
  const files = await prisma.file.findMany({where:{id:{in:ids},status:'READY',aiStatus:'INDEXED',deletedAt:null,...(folderIds?{folderId:{in:folderIds}}:{}),...(filters?.category?{category:filters.category}: {})}});
  return files.map(f=>f.id);
}
async function mapSources(userId:string,sources:EvidenceSource[]):Promise<SearchResult[]> {
  const result:SearchResult[]=[];
  for(const s of sources) {
    try {
      const access=await authorizationService.authorizeFileAccess({userId,isAuthenticated:true},s.file_id,'read');
      const file=access.file!;
      if(file.aiStatus!=='INDEXED'||file.status!=='READY') continue;
      result.push({chunkId:String(s.chunk_id),fileId:file.id,filename:file.filename,mimeType:file.mimeType,folderId:access.isOwner?file.folderId:null,chunkIndex:Number(s.chunk_id),pageStart:null,pageEnd:null,snippet:s.passage,score:s.similarity,permission:access.effectiveLevel});
    } catch { /* A revoked/deleted source is withheld. */ }
  }
  return result;
}
export async function mapAnswer(userId:string,result:LocalAnswer):Promise<AnswerResult> {
  const sources=result.sources||[];
  const mapped=await mapSources(userId,sources);
  if(mapped.length!==sources.length) throw AppError.notFound('Access changed while preparing the answer. Start a new question.');
  return {status:result.mode==='insufficient'?'insufficient_evidence':'answered',answer:result.answer?.replace(/\[(\d+)\]/g,'[S$1]'),citations:mapped.map((s,i)=>({...s,ref:`S${sources[i].citation}`})),sourcesConsidered:sources.length,model:result.mode==='generated'?result.model:'Extractive fallback',...{mode:result.mode,warning:result.warning,conversationId:result.conversation_id,timings:result.timings,retrievalBackend:'local'}};
}
export async function localHistory(userId:string,id:string) {
  const scope=await allowedScope(userId);
  const history=await intelligence<{file_ids:string[];exchanges:Array<{question:string;response:LocalAnswer}>}>(`/api/ai/conversations/${id}`,undefined,userId,scope);
  const current=await allowedScope(userId);
  if(!history.file_ids.every(key=>current.includes(key))) throw AppError.notFound('History unavailable after access change');
  for(const exchange of history.exchanges) {
    for(const source of exchange.response.sources || []) {
      const resolved=await intelligence<{id:number}>('/passage/resolve',{file_id:source.file_id,passage:source.passage});
      source.chunk_id=resolved.id;
    }
  }
  return {exchanges:await Promise.all(history.exchanges.map(async e=>({question:e.question,response:await mapAnswer(userId,e.response)})))};
}
export const localIntelligence = {
  async search(userId:string,query:string,options:{limit:number;fileIds?:string[];mode?:string;folderId?:string;category?:FileCategory}) {
    const started=performance.now();
    const scope=await allowedScope(userId,options.fileIds,options);
    const names=options.mode==='filename' ? await prisma.file.findMany({where:{id:{in:scope}},select:{id:true,filename:true}}) : [];
    const result=await intelligence<{sources:EvidenceSource[]}>('/api/ai/search',{query,...options,...(options.mode==='filename'?{filenames:Object.fromEntries(names.map(f=>[f.id,f.filename]))}:{})},userId,scope);
    const mapped=await mapSources(userId,result.sources);
    const results=mapped.filter((row,index)=>mapped.findIndex(other=>other.fileId===row.fileId)===index);
    return {results,model:'sentence-transformers/all-MiniLM-L6-v2',retrievalBackend:'local',awsCalls:0,retrievalMs:Math.round(performance.now()-started),resultCount:results.length};
  },
  async ask(userId:string,question:string,options:{fileIds?:string[];topK:number;conversationId?:string;requestId?:string;folderId?:string}):Promise<AnswerResult> {
    const scope=await allowedScope(userId,options.fileIds,options);
    const requestId=options.requestId||randomUUID();
    const pending=pendingStops.get(`${userId}:${requestId}`);
    pendingStops.delete(`${userId}:${requestId}`);
    if(pending && pending>Date.now()) throw new AppError('Generation interrupted',499,'AI_CANCELLED');
    if(activeRequests.has(requestId)) throw AppError.conflict('Request already running');
    activeRequests.set(requestId,userId);
    let result:LocalAnswer;
    try { result=await intelligence<LocalAnswer>('/api/ai/ask',{question,file_ids:scope,conversation_id:options.conversationId,request_id:requestId},userId,scope); }
    finally { activeRequests.delete(requestId); }
    return mapAnswer(userId,result);
  },
};
