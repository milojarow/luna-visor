const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const db = require('../db/connection');
const config = require('../config');

function clientIsPrivate(clientId) {
  return db.prepare('SELECT is_private FROM clients WHERE id = ?').get(clientId)?.is_private === 1;
}
function fileIsPrivate(fileId) {
  return db.prepare('SELECT c.is_private FROM files f JOIN clients c ON c.id=f.client_id WHERE f.id=?').get(fileId)?.is_private === 1;
}
function fileUrl(file) {
  if (clientIsPrivate(file.client_id)) return `${config.LUNA_BASE_URL || ''}/api/files/${file.id}/content`;
  return `${config.CDN_BASE_URL}/${file.id}.${file.extension}`;
}
function checkTransfer(fileId, targetClientId) {
  const source = db.prepare('SELECT c.is_private FROM files f JOIN clients c ON c.id=f.client_id WHERE f.id=?').get(fileId);
  const target = db.prepare('SELECT is_private FROM clients WHERE id=?').get(targetClientId);
  if (source && target && source.is_private !== target.is_private) {
    const error = new Error('Cannot move or copy across public/private vault boundaries'); error.status = 409; throw error;
  }
}
function root() {
  fs.mkdirSync(config.MEDIA_PRIVATE_PATH, { recursive:true, mode:0o700 });
  return config.MEDIA_PRIVATE_PATH;
}
function disk(file) { return path.join(root(), `${file.id}.${file.extension}`); }
function remove(file) { try { fs.unlinkSync(file); } catch (e) { if (e.code !== 'ENOENT') throw e; } }
async function describe(tempPath, name) {
  // Sniff a bounded header; an arbitrary attachment need not be parseable to store it.
  const fd=fs.openSync(tempPath,'r'), header=Buffer.alloc(8192); let length;
  try { length=fs.readSync(fd,header,0,header.length,0); } finally { fs.closeSync(fd); }
  let detected;
  try { detected = await (await import('file-type')).fileTypeFromBuffer(header.subarray(0,length)); }
  catch { detected = undefined; } // malformed/unrecognized content is an attachment, never inline
  const mime = detected?.mime || 'application/octet-stream';
  const ext = path.extname(name).slice(1).toLowerCase();
  const type = mime.startsWith('image/') ? 'image' : mime.startsWith('audio/') ? 'audio' : mime.startsWith('video/') ? 'video' : 'document';
  return { extension: /^[a-z0-9]{1,12}$/.test(ext) ? ext : 'bin', mime_type:mime, type, size_bytes:fs.statSync(tempPath).size };
}
async function savePrivate(temp, name, clientId, apiKeyId = null) {
  let dest;
  try {
    const metadata = await describe(temp, name); const id = randomUUID();
    dest = disk({id, extension:metadata.extension}); fs.copyFileSync(temp,dest); fs.chmodSync(dest,0o600);
    db.prepare(`INSERT INTO files(id,original_name,extension,mime_type,size_bytes,client_id,api_key_id,type,has_thumbnail,has_resized)
      VALUES(?,?,?,?,?,?,?,?,0,0)`).run(id,name,metadata.extension,metadata.mime_type,metadata.size_bytes,clientId,apiKeyId,metadata.type);
    return db.prepare('SELECT * FROM files WHERE id=?').get(id);
  } catch (e) { if (dest) remove(dest); throw e; }
  finally { remove(temp); }
}
function deletePrivate(file) {
  const original=disk(file), backup=path.join(root(),`.delete-${randomUUID()}`); let moved=false;
  try {
    if (fs.existsSync(original)) { fs.renameSync(original,backup); moved=true; }
    db.prepare('DELETE FROM files WHERE id=?').run(file.id);
  } catch (e) { if (moved) fs.renameSync(backup,original); throw e; }
  if (moved) remove(backup);
  return file;
}
async function replacePrivate(fileId,temp,name) {
  let staged, backup, old, destination, exchanged=false, committed=false;
  try {
    const metadata=await describe(temp,name);
    old=db.prepare('SELECT * FROM files WHERE id=?').get(fileId);
    if (!old || !clientIsPrivate(old.client_id)) return null;
    staged=path.join(root(),`.replace-${randomUUID()}`); fs.copyFileSync(temp,staged); fs.chmodSync(staged,0o600);
    backup=path.join(root(),`.previous-${randomUUID()}`); const previous=disk(old);
    destination=disk({id:fileId,extension:metadata.extension});
    db.transaction(()=>{
      fs.renameSync(previous,backup);
      try {
        fs.renameSync(staged,destination); exchanged=true;
        db.prepare(`UPDATE files SET original_name=?,extension=?,mime_type=?,size_bytes=?,type=?,has_thumbnail=0,has_resized=0,updated_at=datetime('now') WHERE id=?`)
          .run(name,metadata.extension,metadata.mime_type,metadata.size_bytes,metadata.type,fileId);
      } catch(e) { if(exchanged)remove(destination); fs.renameSync(backup,previous); throw e; }
    })();
    committed=true; remove(backup); return db.prepare('SELECT * FROM files WHERE id=?').get(fileId);
  } catch (error) {
    if (!committed && backup && fs.existsSync(backup)) { if(exchanged)remove(destination); fs.renameSync(backup,disk(old)); }
    throw error;
  } finally { remove(temp); if(staged)remove(staged); }
}
function copyPrivate(file,targetClientId) {
  const id=randomUUID(), dest=disk({id,extension:file.extension});
  try {
    fs.copyFileSync(disk(file),dest);fs.chmodSync(dest,0o600);
    db.prepare(`INSERT INTO files(id,original_name,extension,mime_type,size_bytes,client_id,type,has_thumbnail,has_resized) VALUES(?,?,?,?,?,?,?,0,0)`)
      .run(id,file.original_name,file.extension,file.mime_type,file.size_bytes,targetClientId,file.type);
  } catch(e) {remove(dest);throw e;}
  return db.prepare('SELECT * FROM files WHERE id=?').get(id);
}
module.exports={clientIsPrivate,fileIsPrivate,fileUrl,checkTransfer,disk,savePrivate,replacePrivate,deletePrivate,copyPrivate};
