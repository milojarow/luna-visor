const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {test,after}=require('node:test'),assert=require('node:assert/strict');
const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'luna-private-test-'));
Object.assign(process.env,{MEDIA_PATH:scratch,TMPDIR:scratch,SESSION_SECRET:'test-private-only',ADMIN_PASSWORD_HASH:'test',CDN_BASE_URL:'https://cdn.test',LUNA_BASE_URL:'https://luna.test'});
for(const dir of ['db','files'])fs.mkdirSync(path.join(scratch,dir));
const express=require('express'),sharp=require('sharp');
const db=require('../src/db/connection'),{requireAuth}=require('../src/middleware/auth');
const {saveFile,replaceFile,copyFile,moveFile,deleteFile}=require('../src/services/file-manager');
const {expireOldFiles}=require('../src/services/file-expirer');
const privateFiles=require('../src/services/private-files');
const ids={},keys={};
for(const [name,priv]of [['a',1],['b',1],['public',0]]){
 ids[name]=Number(db.prepare('INSERT INTO clients(name,slug,is_private,preserve_format) VALUES(?,?,?,?)').run(name,name,priv,priv).lastInsertRowid);
 keys[name]=crypto.randomBytes(32).toString('hex');
 db.prepare('INSERT INTO api_keys(name,key_hash,key_preview,client_id) VALUES(?,?,?,?)').run(name,crypto.createHash('sha256').update(keys[name]).digest('hex'),'test',ids[name]);
}
keys.admin=crypto.randomBytes(32).toString('hex');db.prepare("INSERT INTO api_keys(name,key_hash,key_preview,is_admin)VALUES('admin',?,'test',1)").run(crypto.createHash('sha256').update(keys.admin).digest('hex'));
const partner=Number(db.prepare("INSERT INTO partners(name,password_hash)VALUES('partner','test')").run().lastInsertRowid);
db.prepare('UPDATE api_keys SET partner_id=? WHERE client_id=?').run(partner,ids.a);
const app=express();app.use(express.json());
app.use((req,res,next)=>{if(req.headers['x-test-owner'])req.session={authenticated:true};if(req.headers['x-test-partner'])req.session={partnerId:partner};next();});
app.use(requireAuth);app.use('/api/files',require('../src/routes/files'));app.use('/api/clients',require('../src/routes/clients'));app.use('/api/me',require('../src/routes/me'));app.use(require('../src/middleware/error'));
const server=app.listen(0,'127.0.0.1'),ready=new Promise(r=>server.on('listening',r));
after(async()=>{await new Promise(r=>server.close(r));db.close();fs.rmSync(scratch,{recursive:true,force:true});});
async function api(who,url,options={}){await ready;const headers={...options.headers};if(keys[who])headers['X-API-Key']=keys[who];if(who==='owner')headers['X-Test-Owner']='1';if(who==='partner')headers['X-Test-Partner']='1';return fetch(`http://127.0.0.1:${server.address().port}/api${url}`,{...options,headers});}
async function upload(who,name,bytes){const body=new FormData();body.append('files',new Blob([bytes]),name);const r=await api(who,'/files/upload',{method:'POST',body});return {status:r.status,body:await r.json()};}
const idOf=url=>url.split('/').at(-2);
async function png(){return sharp({create:{width:5,height:7,channels:3,background:'#85603a'}}).png().toBuffer();}
function temp(bytes){const f=path.join(scratch,crypto.randomUUID());fs.writeFileSync(f,bytes);return f;}

test('private bytes are exact, outside public storage, without variants',async()=>{
 const bytes=await png(),r=await upload('a','photo.png',bytes);assert.equal(r.status,201);assert.equal(r.body.length,1);const url=r.body[0].cdn_url;assert.match(url,/^https:\/\/luna\.test\/api\/files\/[^/]+\/content$/);
 const id=idOf(url),row=db.prepare('SELECT * FROM files WHERE id=?').get(id);assert.equal(row.has_resized,0);assert.equal(row.has_thumbnail,0);assert.deepEqual(fs.readFileSync(privateFiles.disk(row)),bytes);assert.equal(fs.readdirSync(path.join(scratch,'files')).length,0);
 assert.equal(fs.statSync(privateFiles.disk(row)).mode&0o777,0o600);
});
test('anonymous, unrelated client and admin cannot read private bytes; own key, owner and scoped partner can',async()=>{
 const r=await upload('a','scope.png',await png()),id=idOf(r.body[0].cdn_url);
 for(const [who,status]of [[null,401],['b',403],['admin',403],['a',200],['owner',200],['partner',200]])assert.equal((await api(who,`/files/${id}/content`)).status,status,who);
 const other=await upload('b','other.png',await png());assert.equal((await api('partner',`/files/${idOf(other.body[0].cdn_url)}/content`)).status,403);
});
test('HEAD, ranges, no-store and revocation apply before byte access',async()=>{
 const bytes=await png(),r=await upload('b','range.png',bytes),id=idOf(r.body[0].cdn_url);
 const head=await api('b',`/files/${id}/content`,{method:'HEAD'});assert.equal(head.status,200);assert.equal(Number(head.headers.get('content-length')),bytes.length);assert.equal((await head.arrayBuffer()).byteLength,0);
 const range=await api('b',`/files/${id}/content`,{headers:{Range:'bytes=0-15'}});assert.equal(range.status,206);assert.deepEqual(Buffer.from(await range.arrayBuffer()),bytes.subarray(0,16));assert.equal(range.headers.get('cache-control'),'private, no-store');assert.equal(range.headers.get('x-content-type-options'),'nosniff');
 db.prepare("UPDATE api_keys SET revoked_at=datetime('now') WHERE client_id=?").run(ids.b);assert.equal((await api('b',`/files/${id}/content`)).status,401);db.prepare('UPDATE api_keys SET revoked_at=NULL WHERE client_id=?').run(ids.b);
});
test('arbitrary private attachments are downloads; forged MIME/extension never executes HTML',async()=>{
 const bytes=Buffer.from('<script>parent.alert(1)</script>');
 for(const name of ['private.html','fake-image.png','private.pdf','archive.zip','no-extension']){
  const r=await upload('a',name,bytes);assert.equal(r.status,201);assert.ok(r.body[0].cdn_url);const id=idOf(r.body[0].cdn_url),response=await api('a',`/files/${id}/content`);assert.equal(response.status,200);assert.match(response.headers.get('content-disposition'),/^attachment;/);assert.equal(response.headers.get('content-type'),'application/octet-stream');assert.equal(response.headers.get('content-security-policy'),"sandbox; default-src 'none'");assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes);
 }
 const rejected=await upload('public','public.html',bytes);assert.ok(rejected.body[0].error);assert.equal(fs.readdirSync(path.join(scratch,'files')).length,0);
});
test('public/private move and copy fail without moving, copying or changing ownership',async()=>{
 const bytes=await png(),r=await upload('a','move.png',bytes),id=idOf(r.body[0].cdn_url);assert.throws(()=>moveFile(id,ids.public),{status:409});await assert.rejects(copyFile(id,ids.public),{status:409});assert.equal(db.prepare('SELECT client_id FROM files WHERE id=?').get(id).client_id,ids.a);assert.equal(fs.readdirSync(path.join(scratch,'files')).length,0);
 const normal=await upload('public','normal.png',bytes),normalId=path.basename(new URL(normal.body[0].cdn_url).pathname).split('.')[0];assert.throws(()=>moveFile(normalId,ids.a),{status:409});await assert.rejects(copyFile(normalId,ids.a),{status:409});assert.equal(db.prepare('SELECT client_id FROM files WHERE id=?').get(normalId).client_id,ids.public);
 assert.equal((await api('public',`/files/${normalId}/content`)).status,404);
});
test('private copy, transfer, replacement and deletion stay private and preserve source isolation',async()=>{
 const bytes=await png(),r=await upload('a','source.png',bytes),id=idOf(r.body[0].cdn_url);const copy=await copyFile(id,ids.b);assert.deepEqual(fs.readFileSync(privateFiles.disk(copy)),bytes);moveFile(copy.id,ids.a);assert.equal((await api('b',`/files/${copy.id}/content`)).status,403);
 const text=Buffer.from('changed document');const changed=await replaceFile(id,temp(text),'new.txt','text/html',text.length);assert.equal(changed.id,id);assert.equal(changed.extension,'txt');assert.deepEqual(fs.readFileSync(privateFiles.disk(changed)),text);assert.equal(fs.existsSync(path.join(scratch,'private-files',id+'.png')),false);assert.deepEqual(fs.readFileSync(privateFiles.disk(copy)),bytes);
 deleteFile(id);assert.equal((await api('a',`/files/${id}/content`)).status,404);assert.equal(fs.existsSync(privateFiles.disk(changed)),false);
});
test('failed DB writes clean private upload and restore original replacement',async()=>{
 const bytes=await png(),r=await upload('a','old.png',bytes),id=idOf(r.body[0].cdn_url);const old=db.prepare('SELECT * FROM files WHERE id=?').get(id);
 db.exec(`CREATE TRIGGER block_private_replace BEFORE UPDATE ON files WHEN OLD.id='${id}' BEGIN SELECT RAISE(ABORT,'test rollback'); END`);
 await assert.rejects(replaceFile(id,temp(Buffer.from('new')),'new.txt','text/plain',3),/test rollback/);db.exec('DROP TRIGGER block_private_replace');assert.deepEqual(fs.readFileSync(privateFiles.disk(old)),bytes);assert.equal(db.prepare('SELECT extension FROM files WHERE id=?').get(id).extension,'png');
 const before=fs.readdirSync(path.join(scratch,'private-files')).sort();db.exec("CREATE TRIGGER block_private_insert BEFORE INSERT ON files BEGIN SELECT RAISE(ABORT,'test insert rollback'); END");await assert.rejects(saveFile(temp(bytes),'failure.png','image/png',bytes.length,ids.a),/test insert rollback/);db.exec('DROP TRIGGER block_private_insert');assert.deepEqual(fs.readdirSync(path.join(scratch,'private-files')).sort(),before);
});
test('private policy is create-only, discoverable and compatible with expiry',async()=>{
 const created=await api('admin','/clients',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'private-ephemeral',is_private:true,is_ephemeral:true})});assert.equal(created.status,201);const c=await created.json();assert.equal(c.is_private,1);assert.equal(c.preserve_format,1);assert.equal(c.is_ephemeral,1);
 const renamed=await api('admin',`/clients/${c.id}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'renamed-private',is_private:false})});assert.equal(renamed.status,200);assert.equal((await renamed.json()).is_private,1);
 const file=await saveFile(temp(await png()),'expire.png','image/png',0,c.id);db.prepare("UPDATE files SET created_at=datetime('now','-25 hours') WHERE id=?").run(file.id);assert.equal(expireOldFiles(),1);assert.equal(fs.existsSync(privateFiles.disk(file)),false);
 const me=await(await api('a','/me')).json();assert.equal(me.client.is_private,true);assert.ok(me.callable_endpoints.includes('GET /api/files/{id}/content'));assert.equal(me.branding.available_cover_formats.length,0);
 const source=await upload('a','no-render.png',await png());const cover=await api('a',`/files/${idOf(source.body[0].cdn_url)}/story`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});assert.equal(cover.status,409);
});
