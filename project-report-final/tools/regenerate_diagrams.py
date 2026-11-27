from pathlib import Path
out=Path(__file__).resolve().parents[1]/'diagram_sources';out.mkdir(exist_ok=True)
STYLE=r'\begin{tikzpicture}[>=Latex,box/.style={draw=navy,fill=navy!4,rounded corners=1pt,align=center,text width=3.25cm,minimum height=1cm,font=\small,inner sep=5pt},line/.style={->,thick,draw=navy},control/.style={->,thick,dashed,draw=slate}]'
def graph(name,nodes,edges,groups=[]):
 if name=='citation_validation':edges=[*edges,('fix','ok','Valid repair',False)]
 if name=='trust':
  positions={'b':(0,3),'e':(0,0),'p':(0,-3.5),'m':(-4.7,-6),'aws':(4.7,-6)}
  nodes=[(key,text,*positions[key]) for key,text,_,_ in nodes]
 s=STYLE+'\n'
 for key,text,x,y in nodes:
  text=text.replace(chr(92),chr(92)*2).replace(chr(92)*2+'_',chr(92)+'_')
  s+=rf'\node[box] ({key}) at ({x},{y}) {{{text}}};'+'\n'
 for a,b,label,optional in edges:
  if label=='Implementation':label='Implement'
  if label=='Independent control':label='Separate control'
  if name=='er_application' and a=='u' and b=='act':
   s+=r'\draw[control] (u.east) -- (2.3,2) -- node[right,font=\tiny,fill=white]{0..1:N} (2.3,-2) -- (act.east);'+'\n'
  elif name=='usecases' and b=='a':
   s+=r'\draw[control] (u.east) -- (7.1,0) -- node[right,font=\scriptsize,align=left]{Additional\\admin role} (7.1,-4) -- (a.east);'+'\n'
  elif name=='citation_validation' and a=='r' and b=='fail':
   s+=r'\draw[control] (r.east) -- (7.1,2) -- node[right,font=\scriptsize]{No evidence} (7.1,-4) -- (fail.east);'+'\n'
  elif name=='deployment' and a=='a' and b=='c':
   s+=r'\draw[control] (a.west) -- (-7.2,0) -- node[left,font=\scriptsize,align=center,text width=1.2cm]{Not yet\\deployed} (-7.2,-4) -- (c.west);'+'\n'
  elif name=='er_intelligence' and a=='f' and b=='out':
   s+=r'\draw[control] (f.east) -- (7.2,2) -- node[right,font=\scriptsize,align=center,text width=1.2cm]{Metadata\\retry} (7.2,-2) -- (out.east);'+'\n'
  elif not label:
   s+=rf'\draw[{"control" if optional else "line"}] ({a}) -- ({b});'+'\n'
  else:
   s+=rf'\draw[{"control" if optional else "line"}] ({a}) -- node[midway,fill=white,font=\scriptsize,align=center,text width=1.35cm,inner sep=1pt] {{{label}}} ({b});'+'\n'
 (out/(name+'.tex')).write_text(s+'\end{tikzpicture}\n')
def chain(name,labels):
 n=[];e=[]
 for i,text in enumerate(labels):
  row=i//3;col=i%3 if row%2==0 else 2-i%3;n.append((f'n{i}',text,col*4.7,-row*2.0))
  if i:e.append((f'n{i-1}',f'n{i}','',False))
 graph(name,n,e)
def sequence(name,actors,messages):
 s=r'\begin{tikzpicture}[>=Latex,font=\small]'+'\n'
 for i,a in enumerate(actors):
  s+=rf'\node[draw=navy,fill=navy!4,align=center,text width=2.3cm,minimum height=.7cm] (a{i}) at ({i*3.5},0) {{{a}}};\draw[dashed,slate] ({i*3.5},-.4)--({i*3.5},{-len(messages)*.82-.7});'+'\n'
 for j,(a,b,text) in enumerate(messages):
  y=-.9-j*.82;s+=rf'\draw[->,thick,navy] ({a*3.5},{y})--node[above,font=\scriptsize,align=center]{{{text}}}({b*3.5},{y});'+'\n'
 (out/(name+'.tex')).write_text(s+'\end{tikzpicture}\n')
graph('system', [('browser','Browser / React',0,2),('api','Express\\Identity and scope',0,0),('pg','PostgreSQL\\Users, files, permissions',-4.7,-2),('ai','Private FastAPI\\MiniLM + SQLite',0,-2),('s3','Private S3\\Original bytes',4.7,-2),('llm','Ollama / Qwen 3B\\Grounded generation',0,-4),('aws','Existing AWS workflow\\Events and metadata',4.7,-4)], [('browser','api','JWT',False),('api','pg','Metadata',False),('api','ai','Token + actor + file IDs',False),('api','s3','Guarded transfer',False),('ai','llm','Evidence context',False),('s3','aws','Native events',True),('ai','aws','Outbound reconciliation',True)])
graph('evolution',[('p','October proposal\\Generic vector DB; EC2 intent',0,0),('i','Implemented platform\\PostgreSQL + SQLite + S3',4.7,0),('l','Verified Linux rehearsal\\CPU inference; isolated fixtures',4.7,-2),('c','EC2 deployment\\Pending approval and acceptance',0,-2)],[('p','i','Implementation',False),('i','l','Portability tests',False),('l','c','Proposed next step',True)])
graph('usecases',[('u','Authenticated user',0,0),('f','Organise files\\Upload, folders, trash',-4.7,-2),('q','Discover and ask\\Scoped search and RAG',0,-2),('s','Control sharing\\People and links',4.7,-2),('a','Administrator\\Read-only cloud diagnostics',0,-4)],[('u','f','',False),('u','q','',False),('u','s','',False),('q','a','Separate admin privilege',True)])
sequence('authentication',['Browser','Express','PostgreSQL'],[(0,1,'Credentials over authorised origin'),(1,2,'User and password hash lookup'),(2,1,'Stored verifier and account state'),(1,2,'Session / hashed refresh token'),(1,0,'Access token + HttpOnly cookie'),(0,1,'Refresh with CSRF header'),(1,2,'Rotate family or reject reuse'),(1,0,'New token; revoked sessions denied')])
sequence('upload',['Browser','Express','S3 / private adapter'],[(0,1,'Authenticated upload request'),(1,2,'Guarded object creation / staging'),(2,1,'Size and checksum evidence'),(1,0,'Ready metadata or reservation'),(0,2,'Direct transfer only in presigned mode'),(0,1,'Complete reservation where applicable'),(1,2,'Finalise without overwriting originals'),(1,0,'File state; indexing queued')])
sequence('download',['Browser','Express','PostgreSQL','S3 adapter'],[(0,1,'Request file download'),(1,2,'Check owner / inherited permission'),(2,1,'Current file state and authority'),(1,3,'Guarded original read'),(3,1,'Bytes or bounded signed URL'),(1,0,'Authorised response; no access if revoked')])
graph('er_application',[('u','User\\PK id; UNIQUE email',0,2),('ses','UserSession / RefreshToken\\FK userId',-4.7,0),('fol','Folder\\FK ownerId, parentFolderId',0,0),('file','File\\FK ownerId, folderId',4.7,0),('per','Permission\\FK granteeUserId\\Polymorphic resourceId',-4.7,-2),('act','ActivityLog\\Nullable FK userId',0,-2),('share','ShareLink\\FK fileId, createdBy',4.7,-2),('idx','DocumentIndex\\PK/FK fileId',0,-4),('chunks','DocumentChunk / AiJob\\FK fileId + generation',4.7,-4)],[('u','ses','1 : many',False),('u','fol','1 : many',False),('u','file','1 : many',False),('u','per','1 : many',False),('u','act','1 : many',True),('file','share','1 : many',False),('file','idx','1 : 0..1',False),('file','chunks','1 : many',False),('fol','file','1 : many',False)])
graph('er_intelligence',[('f','files\\PK id; UNIQUE object\_key',0,2),('c','chunks\\FK file\_id; float32 BLOB',0,0),('fts','chunk\_fts\\External-content FTS5',4.7,0),('conv','conversations\\PK id; authorised scope',-4.7,-2),('ex','exchanges\\FK conversation\_id',0,-2),('owners','conversation\_owners\\Actor ownership',-4.7,-4),('out','cloud\_outbox\\PK file\_id; revision',4.7,-2)],[('f','c','1 : many; cascade',False),('c','fts','Triggers synchronise',True),('conv','ex','1 : many; cascade',False),('conv','owners','Private ownership check',True),('f','out','Retryable metadata',True)])
chain('aws_events',['Finalised original in S3','EventBridge prefix rule','SQS / bounded consumer','Lambda validates event','Standard Step Functions','DynamoDB processing state','Await-local marker ends cloud run','Private extraction + MiniLM','Search / Qwen / citations'])
graph('state_machine',[('v','Validate',0,0),('e','ExtractOrClassify',4.7,0),('p','PersistManifest',9.4,0),('a','AwaitLocalEmbedding\\Task ends execution',9.4,-2),('r','RecordFailure',4.7,-3.8),('f','Failed\\Fail state',9.4,-3.8)],[('v','e','Success',False),('e','p','Success',False),('p','a','Success',False),('v','r','Catch',True),('e','r','Catch',True),('p','r','Catch',True),('a','r','Catch',True),('r','f','',False)])
chain('job_lifecycle',['QUEUED / generation N','Claim with SKIP LOCKED','RUNNING; owned lease','Extract / embed / persist','SUCCEEDED if generation current','Retry or FAILED after bound'])
chain('embedding',['Verified original bytes','Bounded text extraction','Token offsets; 220-token windows','32-token overlap','MiniLM CPU; normalised 384D','SQLite vectors + FTS triggers'])
chain('dense_search',['Authorised file-ID scope','Encode query with same MiniLM','Normalised matrix dot product','Dense candidates and relevance gates','Distinct file ranking / passages','Return current authorised metadata'])
graph('hybrid',[('q','Query + trusted file scope',0,2),('d','Dense semantic ranking\\Cosine candidates',-2.6,0),('b','Sparse ranking\\SQLite FTS5 BM25',2.6,0),('rrf','Reciprocal rank fusion\\k = 60; eligibility gates',0,-2),('rank','Tie break: term coverage\\then dense similarity',0,-4)],[('q','d','',False),('q','b','',False),('d','rrf','',False),('b','rrf','',False),('rrf','rank','',False)])
chain('rag',['JWT and resource authorisation','Private actor + scoped file IDs','Hybrid evidence retrieval','Bounded context and instruction isolation','Genuine Qwen JSON claims','Exact quote / citation validation','One bounded correction if needed','Generated / labelled fallback / abstain','Persist owned conversation'])
graph('multidoc',[('q','Question spanning two documents',0,2),('a','Document A\\Local AI processing evidence',-2.6,0),('b','Document B\\Synthetic Borealis code',2.6,0),('c','Complementary retrieved passages',0,-2),('g','Qwen structured answer\\Claim-to-source attribution',0,-4)],[('q','a','Scoped retrieval',False),('q','b','Scoped retrieval',False),('a','c','',False),('b','c','',False),('c','g','S1 / S2 citations',False)])
graph('citation_validation',[('r','Retrieved evidence sufficient?',0,2),('g','Generate structured claims',0,0),('v','Quotes exact; IDs in scope? ',0,-2),('ok','Accept supported claims',-4.7,-4),('fix','One source-faithful correction',4.7,-2),('fail','Label fallback or abstain',4.7,-4)],[('r','g','Yes',False),('r','fail','No',True),('g','v','',False),('v','ok','Valid',False),('v','fix','Invalid',True),('fix','fail','Still invalid / timeout',True)])
graph('trust',[('b','Untrusted browser / document text',0,2),('e','Express identity boundary\\JWT + resource policy',0,0),('p','Private intelligence boundary\\Service token + trusted scope',0,-2),('m','Internal model boundary\\No tool or public model endpoint',-4.7,-4),('aws','AWS boundary\\Pinned identity + guarded SDK',4.7,-4)],[('b','e','Validate input',False),('e','p','No user-chosen service host',False),('p','m','Evidence-only prompt',False),('p','aws','Role design pending EC2',True)])
graph('deployment',[('h','Local Linux rehearsal host\\Docker Desktop; NOT EC2',0,2),('a','Express + React\\Loopback host port',0,0),('pg','PostgreSQL volume',-4.7,-2),('i','FastAPI + SQLite volume',0,-2),('o','Native Linux Ollama\\Read-only model assets',4.7,-2),('c','Proposed Ubuntu EC2 host\\Same runtime; SSM private access',0,-4)],[('h','a','',False),('a','pg','Internal network',False),('a','i','Private token',False),('i','o','Internal model network',False),('a','c','Not yet deployed',True)])
graph('shutdown',[('auth','Verify identity, Free plan\\credits and absolute deadline',0,2),('run','Bounded approved host session',0,0),('boot','Boot timer\\225 minutes',-4.7,-2),('watch','Credit / authorisation watchdog',0,-2),('ext','External Scheduler\\230-minute deadline',4.7,-2),('stop','Drain / cancel generation\\Stop EC2; retain disk',0,-4)],[('auth','run','Only after approval',False),('run','boot','Arm',True),('run','watch','Poll',True),('run','ext','Independent control',True),('boot','stop','',True),('watch','stop','Failure / limit',True),('ext','stop','',True)])
print('20 editable TikZ technical diagrams generated.')
