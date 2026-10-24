import {validateEvidence,validateIssue} from '../mes/site/model.js';
import {driveApi} from './drive-client.js';
import {serveCloudMedia,prepareCloudOriginal,commitCloudRecord,cloudRecord,removeCloudFile} from './cloud-media.js';
import {publishFile} from './publish.js';
import {filePath,deleteEverywhere,storageQuota} from './storage.js';
import {displayPath} from './media.js';
import {Router} from 'express';
import {mkdir,rm,stat} from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import {pipeline} from 'node:stream/promises';
import {Transform} from 'node:stream';
import {join} from 'node:path';
import {hash,token,validPath,actorFor} from './security.js';
import {normalizeDocument,documentText} from '../mes/site/rich-document.js';
const viewerActions=new Set(['read','readBundle','readTicket','downloadUrl']);
const publicActions=new Set(['getDashboardDefaults','getAppearanceDefaults','getDirectory','passwordLogin','activateAccount',...viewerActions]);
const types=new Set(['image/jpeg','image/png','image/webp','video/mp4','video/webm','video/quicktime','application/pdf','text/plain','text/csv','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']);
export function mesRouter(pool,filesRoot) {
 const router=Router();
 async function dispatch(name,data,actor) {
  const viewer=!actor.session&&viewerActions.has(name);
  const {rows:[r]}=await pool.query(viewer?'select public.mes_view($1,$2) as result':'select public.mes_dispatch($1,$2,$3) as result',viewer?[name,data]:[name,data,actor]);
  if(r.result?.errorCode)throw Object.assign(new Error('Account request denied'),{code:r.result.errorCode});
  return r.result;
 }
 router.get('/tickets/:reference',async(req,res)=>{
  const reference=req.params.reference;
  if(!/^(?:TH[0-9]{4}-[0-9]{2}|[a-zA-Z0-9_-]{1,128})$/.test(reference))return res.sendStatus(400);
  const mapped=(await pool.query('select issue_id from public.mes_ticket_codes where code=$1',[reference])).rows[0];
  const id=mapped?.issue_id||reference;
  try{res.json(await dispatch('readTicket',{id},actorFor(req.cookies.th_mes,req.headers['x-mes-tester'])));}catch(error){if(error.code==='P0001')return res.status(404).json({error:'Ticket unavailable'});throw error;}
 });
 router.all('/files/:grant',async(req,res)=>{
  const action=req.method==='PUT'?'uploadUrl':req.method==='GET'?'downloadUrl':null;
  if(!action)return res.sendStatus(405);
  const value=req.params.grant;
  if(!/^[a-f0-9]{64}$/.test(value))return res.sendStatus(404);
  const {rows:[grant]}=await pool.query('delete from public.file_grants where hash=$1 and action=$2 and expires>now() returning *',[hash(value),action]);
  if(!grant)return res.sendStatus(403);
  await dispatch(action,{path:grant.path},grant.actor);
  if(action==='downloadUrl'){const info=(await pool.query('select * from public.files where path=$1',[grant.path])).rows[0];if(info&&await serveCloudMedia(pool,filesRoot,grant.path,req,res,info.type))return;}
  const path=await filePath(filesRoot,grant.path,action!=='downloadUrl');
  if(action==='downloadUrl') {
   const {rows:[meta]}=await pool.query('select * from public.files where path=$1',[grant.path]);
   if(!meta)return res.sendStatus(404);
   res.set({'Content-Type':meta.type,'X-Content-Type-Options':'nosniff','Content-Security-Policy':"sandbox; default-src 'none'"});
   return res.download(path,meta.name||'attachment');
  }
  const type=req.headers['content-type'];
  if(!types.has(type))return res.status(400).json({error:'Unsupported file type'});
  const {rows:[quota]}=await pool.query('select (select coalesce(sum(size),0) from public.files)+(select coalesce(sum(size),0) from public.mes_media) used');
  if(Number(quota.used)+(type.startsWith('video/')?209715200:10485760)>storageQuota())throw Object.assign(new Error('Storage quota reached'),{status:507,code:'resource-exhausted',expose:true});
  await mkdir(join(path,'..'),{recursive:true});
  const temporary=path+'.'+token()+'.tmp';let size=0;
  try {
   const limiter=new Transform({transform(chunk,encoding,callback){size+=chunk.length;callback(size>(type.startsWith('video/')?209715200:10485760)?Object.assign(new Error('File too large'),{status:413}):null,chunk);}});
   await pipeline(req,limiter,createWriteStream(temporary,{flags:'wx',mode:0o600}));
   if(!size)throw Object.assign(new Error('Empty file'),{status:400});
   // link is atomic and never overwrites an existing slot.
   const cloud=await prepareCloudOriginal(pool,temporary,grant.path,type,size);
   if(!cloud)await publishFile(temporary,path);
   const db=await pool.connect();
   try {await db.query('begin');if(cloud)await commitCloudRecord(db,cloud);await db.query('insert into public.files(path,size,type) values($1,$2,$3)',[grant.path,size,type]);await db.query('commit');}
   catch(e){await db.query('rollback');if(cloud)await driveApi(`files/${encodeURIComponent(cloud.drive_id)}`,{method:'DELETE'}).catch(()=>{});else await rm(path,{force:true});throw e;}finally{db.release();}
   res.json({ok:true});
  } finally {await rm(temporary,{force:true});}
 });
 // Stable authenticated URLs allow byte-range video playback and browser cache reuse.
 router.get('/attachments/:issue/:slot',async(req,res)=>{
  const path=`issues/${req.params.issue}/${req.params.slot}`;
  if(!validPath(path))return res.sendStatus(404);
  const actor=actorFor(req.cookies.th_mes,req.headers['x-mes-tester']);
  await dispatch('downloadUrl',{path},actor);
  const {rows:[meta]}=await pool.query('select * from public.files where path=$1',[path]);
  if(!meta)return res.sendStatus(404);
  res.set({'Content-Type':req.query.preview==='1'&&meta.type.startsWith('image/')?'image/jpeg':meta.type,'Cache-Control':'private, max-age=0, must-revalidate','Content-Security-Policy':"sandbox; default-src 'none'"});
  if(req.query.download==='1'||(!meta.type.startsWith('image/')&&!meta.type.startsWith('video/')))res.attachment(meta.name||'attachment');
  if(await serveCloudMedia(pool,filesRoot,path,req,res,meta.type))return;
  res.set('X-Accel-Buffering','no');
  const display=await displayPath(filesRoot,path,req.query.preview==='1'&&meta.type.startsWith('image/'));
  res.set('X-Media-Preview',display.endsWith('.preview.jpg')?'ready':'original');res.type(display.endsWith('.preview.jpg')?'image/jpeg':meta.type);res.sendFile(display,{dotfiles:'deny'});
 });
 router.post('/',async(req,res)=>{
  const {name,data={}}=req.body||{};
  if(typeof name!=='string'||!data||typeof data!=='object'||Array.isArray(data)||name==='finishDelete')return res.sendStatus(400);
  const actor={...actorFor(req.cookies.th_mes,req.headers['x-mes-tester']),ip:req.ip,agent:String(req.headers['user-agent']||'').slice(0,240)};
  if(!publicActions.has(name)&&!actor.session)return res.status(401).json({code:'unauthenticated',error:'Sign in first'});
  if(name==='createIssue'){
   await dispatch('getSession',{},actor);
   const invalid=validateEvidence(data.evidence);
   if(invalid)return res.status(400).json({code:'invalid-evidence',error:invalid});
  }
  if(name==='completePendingTicket'){
   await dispatch('getSession',{},actor);
   data.richDocument=normalizeDocument(data.richDocument);data.description=documentText(data.richDocument);
   const invalid=validateIssue(data);if(invalid)return res.status(400).json({code:'invalid-argument',error:invalid});
   if(!Array.isArray(data.files)||data.files.length>5)return res.sendStatus(400);
   const files=[];for(const file of data.files){if(!validPath(file.path)||typeof file.name!=='string')return res.sendStatus(400);const {rows:[info]}=await pool.query('select size,type from public.files where path=$1',[file.path]);if(!info)return res.sendStatus(400);if(!await cloudRecord(pool,file.path))await stat(await filePath(filesRoot,file.path));files.push({...file,size:Number(info.size),type:info.type});}
   const evidence=validateEvidence(files);if(evidence)return res.status(400).json({code:'invalid-evidence',error:evidence});data.files=files;
  }
  if((name==='createIssue'||name==='saveTicketEdit'||(name==='updateIssue'&&data.operation==='edit'))&&data.richDocument!==undefined){data.richDocument=normalizeDocument(data.richDocument);data.description=documentText(data.richDocument);}
  if(name==='uploadUrl'||name==='downloadUrl') {
   if(!validPath(data.path))return res.sendStatus(400);
   await dispatch(name,data,actor);
   if(name==='downloadUrl'&&!actor.session)return res.json({url:'/api/mes/attachments/'+data.path.split('/').slice(1).map(encodeURIComponent).join('/')});
   const value=token();
   await pool.query('insert into public.file_grants(hash,action,path,actor) values($1,$2,$3,$4)',[hash(value),name,data.path,actor]);
   return res.json({url:`/api/mes/files/${value}`});
  }
  if(name==='attachFiles') {
   await dispatch('getSession',{},actor);
   if(!Array.isArray(data.files)||data.files.length>5)return res.sendStatus(400);
   const files=[];
   for(const f of data.files) {
    const path=`issues/${data.issueId}/${f.slot}`;
    if(!validPath(path))return res.sendStatus(400);
    const {rows:[info]}=await pool.query('select size,type from public.files where path=$1',[path]);
    if(!info)return res.sendStatus(400);
    if(!await cloudRecord(pool,path))await stat(await filePath(filesRoot,path));files.push({slot:f.slot,path,name:f.name,size:Number(info.size),type:info.type});
   }
   const result=await dispatch(name,{...data,files},actor);
   for(const f of files)await pool.query('update public.files set name=$2 where path=$1',[f.path,f.name]);
   return res.json(result);
  }
  if(name==='deleteIssue') {
   if(!/^[a-zA-Z0-9_-]{1,128}$/.test(data.id||''))return res.sendStatus(400);
   await dispatch(name,data,actor);
   for(const row of (await pool.query('select path from public.mes_cloud_files where path like $1',[`issues/${data.id}/%`])).rows)await removeCloudFile(pool,row.path);
   await deleteEverywhere(filesRoot,`issues/${data.id}`,{recursive:true,force:true});
   await pool.query('delete from public.files where path like $1',[`issues/${data.id}/%`]);
   return res.json(await dispatch('finishDelete',data,actor));
  }
  const result=await dispatch(name,data,actor);
  if(result.sessionToken) {
   res.cookie('th_mes',result.sessionToken,{httpOnly:true,secure:true,sameSite:'lax',path:'/',maxAge:(result.sessionMaxAgeSeconds===2592000?2592000:43200)*1000});
   delete result.sessionToken;
   delete result.sessionMaxAgeSeconds;
  }
  if(name==='logout')res.clearCookie('th_mes',{path:'/',httpOnly:true,secure:true,sameSite:'lax'});
  if(name==='getDirectory')result.apiVersion='accounts-v1';
  res.json(result);
 });
 return router;
}
