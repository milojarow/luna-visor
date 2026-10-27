const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const crypto=require('node:crypto');
const{Readable,Transform}=require('node:stream');
const{pipeline}=require('node:stream/promises');
const db=require('../db/connection');
const config=require('../config');
const{saveFile,deleteFile}=require('./file-manager');
const{validateUpload}=require('./upload-validator');
const{createPublicJob,createQueue}=require('./public-media-jobs');
const{fileUrl}=require('./private-files');
const TYPES={'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/avif':'avif','image/gif':'gif','video/mp4':'mp4'};
function failure(message,status=400){return Object.assign(new Error(message),{status});}
function allowedMetaUrl(value){
  if(typeof value!=='string'||value.length>8192)throw failure('Invalid Meta media URL');
  let u;try{u=new URL(value)}catch{throw failure('Invalid Meta media URL')}
  if(u.protocol!=='https:'||u.username||u.password||u.hash||(u.port&&u.port!=='443'))throw failure('Invalid Meta media origin');
  if(!['www.facebook.com','scontent.xx.fbcdn.net'].includes(u.hostname)&&!/^(?:external|scontent|video)-[a-z0-9-]+\.xx\.fbcdn\.net$/.test(u.hostname))throw failure('Unsupported Meta media host');
  if([...u.searchParams.keys()].some(k=>/access_token|appsecret_proof|authorization/i.test(k)))throw failure('Do not send Meta API credentials');
  return u.href;
}
function createMetaImporter({fetchMedia=globalThis.fetch,concurrency=2,maxWaiting=32,maxImageBytes=8*1024**2,maxVideoBytes=128*1024**2,vaultLimit=2*1024**3}={}){
 const schedule=createQueue(concurrency,maxWaiting),saveStage=createQueue(1,64),inflight=new Map(),misses=new Map(),reserved=new Map(),negative=new Map();
 function quota(clientId,bytes){
  const used=db.prepare('SELECT COALESCE(SUM(size_bytes),0)AS n FROM files WHERE client_id=?').get(clientId).n;
  if(used+(reserved.get(clientId)||0)+bytes>vaultLimit)throw failure('Temporary media vault quota reached',507);
  diskRoom(bytes);
 }
 function diskRoom(bytes){const stat=fs.statfsSync(config.MEDIA_PATH);if(stat.bavail*stat.bsize<1024**3+bytes)throw failure('Media disk reserve reached',507);}
 async function download(url,clientId,apiKeyId,cacheKey){
  diskRoom(1);const controller=new AbortController(),deadline=setTimeout(()=>controller.abort(),60000);let response,temporary,writer;
  try{
   for(let redirects=0;redirects<=4;redirects++){
    response=await fetchMedia(url,{redirect:'manual',signal:controller.signal});
    if([301,302,303,307,308].includes(response.status)){
     const location=response.headers.get('location');await response.body?.cancel();if(!location||redirects===4)throw failure('Meta redirect rejected',502);url=allowedMetaUrl(new URL(location,url).href);continue;
    }break;
   }
   if(!response||response.status!==200)throw failure('Meta source unavailable',502);
   const mime=(response.headers.get('content-type')||'').split(';')[0].trim().toLowerCase(),extension=TYPES[mime];if(!extension)throw failure('Only raster images and MP4 are importable',415);
   const maximum=mime==='video/mp4'?maxVideoBytes:maxImageBytes;
   const declared=Number(response.headers.get('content-length'));
   if(Number.isFinite(declared)&&declared>maximum)throw failure('Meta media too large',413);if(declared>0)diskRoom(declared);
   const dir=path.join(os.tmpdir(),'luna-meta-imports');fs.mkdirSync(dir,{recursive:true,mode:0o700});temporary=path.join(dir,crypto.randomUUID());writer=fs.createWriteStream(temporary,{flags:'wx',mode:0o600});
   let bytes=0;const hasher=crypto.createHash('sha256');if(!response.body)throw failure('Empty Meta media',502);
   const bounded=new Transform({transform(chunk,_encoding,done){bytes+=chunk.byteLength;hasher.update(chunk);if(bytes>maximum)done(failure('Meta media too large',413));else done(null,chunk);}});
   await pipeline(Readable.fromWeb(response.body),bounded,writer,{signal:controller.signal});
   if(bytes<1)throw failure('Empty Meta media',502);
   const checked=await validateUpload(temporary,'meta.'+extension,{preserveFormat:true});const actual=TYPES[checked.mime];if(!actual)throw failure('Unsupported Meta media bytes',415);
   if(bytes>(checked.mime==='video/mp4'?maxVideoBytes:maxImageBytes))throw failure('Meta media too large',413);
   const hash=hasher.digest('hex');
   return await saveStage(async()=>{
    const existing=db.prepare("SELECT f.* FROM meta_media_imports m JOIN files f ON f.id=m.file_id WHERE m.client_id=? AND m.content_hash=? AND f.created_at>datetime('now','-23 hours') LIMIT 1").get(clientId,hash);
    let file=existing;
    if(!file){quota(clientId,bytes);reserved.set(clientId,(reserved.get(clientId)||0)+bytes);try{file=await saveFile(temporary,'meta-preview.'+actual,checked.mime,bytes,clientId,apiKeyId);}finally{reserved.set(clientId,(reserved.get(clientId)||bytes)-bytes);}}
    try{db.prepare('INSERT INTO meta_media_imports(cache_key,client_id,file_id,content_hash)VALUES(?,?,?,?) ON CONFLICT(cache_key)DO UPDATE SET file_id=excluded.file_id,content_hash=excluded.content_hash').run(cacheKey,clientId,file.id,hash);}
    catch(error){if(!existing)deleteFile(file.id);throw error;}
    return file;
   });
  }finally{
   clearTimeout(deadline);if(writer&&!writer.closed)writer.destroy();if(response?.body&&!response.body.locked)await response.body.cancel().catch(()=>{});
   if(temporary)try{fs.unlinkSync(temporary)}catch{}
  }
 }
 function importMedia({url,clientId,apiKeyId=null}){
  url=allowedMetaUrl(url);const client=db.prepare('SELECT * FROM clients WHERE id=?').get(clientId);
  if(!client||client.is_private||!client.is_ephemeral)throw failure('Meta imports require a public ephemeral vault',403);
  const key=crypto.createHash('sha256').update(clientId+'\0'+url).digest('hex');
  const cached=db.prepare("SELECT f.* FROM meta_media_imports m JOIN files f ON f.id=m.file_id WHERE m.cache_key=? AND m.client_id=? AND f.created_at>datetime('now','-23 hours')").get(key,clientId);
  if(cached)return{status:200,body:{id:cached.id,cdn_url:fileUrl(cached),cached:true}};
  const existing=inflight.get(key);if(existing)return{status:202,body:existing.pending};
  const bad=negative.get(key);if(bad&&bad.until>Date.now())throw failure(bad.message,bad.status);
  const now=Date.now(),rate=misses.get(clientId)||{start:now,count:0};if(now-rate.start>=60000){rate.start=now;rate.count=0;}if(rate.count>=60)throw failure('Too many new Meta imports',429);rate.count++;misses.set(clientId,rate);
  const created=createPublicJob(()=>schedule(async()=>{
   let file;
   try{
    file=await download(url,clientId,apiKeyId,key);
    return{id:file.id,cdn_url:fileUrl(file),cached:false};
   }catch(error){negative.set(key,{message:error.message,status:error.status||502,until:Date.now()+60000});if(negative.size>512)negative.delete(negative.keys().next().value);throw error;}
   finally{inflight.delete(key);}
  }));inflight.set(key,created);created.job.promise.finally(()=>{if(inflight.get(key)===created)inflight.delete(key)}).catch(()=>{});return{status:202,body:created.pending};
 }
 return{importMedia};
}
const instance=createMetaImporter();module.exports={allowedMetaUrl,createMetaImporter,importMetaMedia:instance.importMedia};
