const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const{Worker}=require('node:worker_threads');
const config=require('../config'),db=require('../db/connection');
const{createPublicJob,createQueue}=require('./public-media-jobs');
const{saveFile,deleteFile}=require('./file-manager'),{fileUrl}=require('./private-files');
const LOGO='https://cdn.solutions45.com/9d2cd33a-9f61-442b-81e3-96c5e4ed23fe.png';
const CLIENT_SLUG='blindando-post-preview-temporal';
const schedule=createQueue(1,8),inflight=new Map(),rates=new Map();
function failure(message,status=400){return Object.assign(Error(message),{status});}
function publicImage(value){try{const u=new URL(value);return u.origin===new URL(config.CDN_BASE_URL).origin&&!u.username&&!u.password&&!u.search&&!u.hash&&/^\/[a-f0-9-]{36}\.(png|jpe?g|webp|avif|gif)$/i.test(u.pathname)}catch{return false;}}
function normalize(input){
 if(!input||typeof input!=='object')throw failure('Render parameters required');
 const{headline,product}=input;if(typeof headline!=='string'||!headline.trim()||headline.length>400||typeof product!=='string'||!product.trim()||product.length>120)throw failure('headline and product required, at most 400 and 120 characters');
 const color=input.color||'#1B3A5C';if(typeof color!=='string'||!/^#[a-f0-9]{6}$/i.test(color))throw failure('color must be a hex color');
 let bullets=input.bullets||[];if(typeof bullets==='string')bullets=bullets.split('|').slice(0,4);if(!Array.isArray(bullets)||bullets.length>4||bullets.some(b=>typeof b!=='string'||b.length>240))throw failure('At most four bullets, 240 characters each');
 const bg=input.bg||null;if(bg&&!publicImage(bg))throw failure('background must be a Luna image');
 return{headline,product,bullets,color,bg,format:input.format==='ig'?'ig':'square'};
}
async function imageData(url){
 const r=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(15000)});if(!r.ok)throw failure('Luna artwork unavailable',502);
 if(Number(r.headers.get('content-length'))>8*1024**2)throw failure('Artwork too large',413);
 let n=0;const chunks=[];for await(const chunk of r.body){n+=chunk.length;if(n>8*1024**2)throw failure('Artwork too large',413);chunks.push(chunk);}
 const sharp=require('sharp'),png=await sharp(Buffer.concat(chunks),{limitInputPixels:50_000_000}).png().toBuffer();return'data:image/png;base64,'+png.toString('base64');
}
let logo;
function logoData(){if(!logo)logo=imageData(LOGO).catch(e=>{logo=null;throw e;});return logo;}
function renderInWorker(data){return new Promise((resolve,reject)=>{
 const worker=new Worker(path.join(__dirname,'../../renderers/blindando/worker.js'),{workerData:data,resourceLimits:{maxOldGenerationSizeMb:128,stackSizeMb:4}});
 let done=false;const finish=(error,result)=>{if(done)return;done=true;clearTimeout(timer);worker.terminate();error?reject(error):resolve(result);};
 const timer=setTimeout(()=>finish(failure('Render timeout',503)),30000);
 worker.once('message',r=>r?.error?finish(failure('Render failed',502)):finish(null,Buffer.from(r)));worker.once('error',()=>finish(failure('Render failed',502)));worker.once('exit',code=>{if(!done)finish(failure('Render exited '+code,502));});
});}
function requestRender(input,clientId,apiKeyId=null){
 const client=db.prepare('SELECT * FROM clients WHERE id=?').get(clientId);
 if(!client||client.slug!==CLIENT_SLUG||!client.is_ephemeral||client.is_private)throw failure('This vault cannot render the Blindando template',403);
 const a=normalize(input);const key=crypto.createHash('sha256').update('blindando-v1\0'+clientId+'\0'+JSON.stringify(a)).digest('hex');
 const cached=db.prepare("SELECT f.* FROM brand_media_renders r JOIN files f ON f.id=r.file_id WHERE r.cache_key=? AND r.client_id=? AND f.created_at>datetime('now','-23 hours')").get(key,clientId);
 if(cached)return{status:200,body:{id:cached.id,cdn_url:fileUrl(cached),cached:true}};
 if(inflight.has(key))return{status:202,body:inflight.get(key).pending};
 const now=Date.now();let rate=rates.get(clientId)||{start:now,count:0};if(now-rate.start>60000)rate={start:now,count:0};if(rate.count>=20)throw failure('Too many new renders',429);rate.count++;rates.set(clientId,rate);
 const created=createPublicJob(()=>schedule(async()=>{
  const stat=fs.statfsSync(config.MEDIA_PATH);const used=db.prepare('SELECT COALESCE(SUM(size_bytes),0)AS n FROM files WHERE client_id=?').get(clientId).n;
  if(used>2*1024**3-8*1024**2||stat.bavail*stat.bsize<1024**3+8*1024**2)throw failure('Render storage reserve reached',507);
  const bgDataUri=a.bg?await imageData(a.bg).catch(()=>null):null;
  const result=await renderInWorker({...a,width:1080,height:a.format==='ig'?1350:1080,fontSize:a.headline.length<30?72:a.headline.length<50?64:56,bgDataUri,logoDataUri:await logoData()});
  const after=fs.statfsSync(config.MEDIA_PATH),current=db.prepare('SELECT COALESCE(SUM(size_bytes),0)AS n FROM files WHERE client_id=?').get(clientId).n;
  if(current+result.length>2*1024**3||after.bavail*after.bsize<1024**3+result.length)throw failure('Render storage reserve reached',507);
  const dir=path.join(os.tmpdir(),'luna-blindando-renders');fs.mkdirSync(dir,{recursive:true,mode:0o700});const temp=path.join(dir,crypto.randomUUID());let file;
  try{fs.writeFileSync(temp,result,{mode:0o600,flag:'wx'});const slug=a.product.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,40);file=await saveFile(temp,'og-'+slug+(a.format==='ig'?'-ig':'')+'.webp','image/webp',result.length,clientId,apiKeyId);db.prepare('INSERT INTO brand_media_renders(cache_key,client_id,file_id)VALUES(?,?,?) ON CONFLICT(cache_key)DO UPDATE SET file_id=excluded.file_id').run(key,clientId,file.id);return{id:file.id,cdn_url:fileUrl(file),cached:false};}
  catch(e){if(file)deleteFile(file.id);throw e;}finally{try{fs.unlinkSync(temp)}catch{}}
 }));inflight.set(key,created);created.job.promise.finally(()=>{if(inflight.get(key)===created)inflight.delete(key)}).catch(()=>{});return{status:202,body:created.pending};
}
module.exports={normalize,publicImage,requestRender,renderInWorker,CLIENT_SLUG};
