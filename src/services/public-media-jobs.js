const crypto=require('node:crypto');
const config=require('../config');
const jobs=new Map();
function publicLocation(url){
  const u=new URL(url),base=new URL(config.CDN_BASE_URL);
  if(u.origin!==base.origin||u.username||u.password||u.search||u.hash||!/^\/[0-9a-f-]{36}\.(?:png|jpe?g|webp|avif|gif|mp4|webm|svg)$/i.test(u.pathname))throw Error('Job result is not a public CDN object');
  return u.href;
}
function createPublicJob(task){
  if(!config.LUNA_BASE_URL)throw Object.assign(Error('Public job API origin not configured'),{status:503});
  sweep();if(jobs.size>=512)throw Object.assign(Error('Too many public media jobs'),{status:503});
  const token=crypto.randomBytes(24).toString('hex');
  const job={token,expires:Date.now()+15*60*1000,result:null,error:null};
  job.promise=Promise.resolve().then(task).then(result=>{publicLocation(result.cdn_url);job.result=result;return result},error=>{job.error=error;throw error});
  // A caller may only poll later; background rejection must never be unhandled.
  job.promise.catch(error=>{job.error=error});jobs.set(token,job);
  return{job,pending:{status:'pending',poll_url:`${config.LUNA_BASE_URL}/api/media-jobs/${token}`,retry_after:1}};
}
function sweep(){for(const[token,job]of jobs)if(job.expires<Date.now())jobs.delete(token);}
function getPublicJob(token){sweep();if(!/^[0-9a-f]{48}$/.test(token))return null;return jobs.get(token)||null;}
function createQueue(maxActive=2,maxWaiting=32){
  let active=0;const waiting=[];
  function next(){while(active<maxActive&&waiting.length){const item=waiting.shift();active++;Promise.resolve().then(item.task).then(item.resolve,item.reject).finally(()=>{active--;next()});}}
  return task=>{
    if(active>=maxActive&&waiting.length>=maxWaiting)return Promise.reject(Object.assign(Error('Media queue busy'),{status:503}));
    return new Promise((resolve,reject)=>{waiting.push({task,resolve,reject});next()});
  };
}
module.exports={createPublicJob,getPublicJob,createQueue,publicLocation};
