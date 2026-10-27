const {Router}=require('express');
const{getPublicJob}=require('../services/public-media-jobs');
const{rateLimit}=require('express-rate-limit');
const router=Router();
router.use(rateLimit({windowMs:60000,max:240,standardHeaders:true,legacyHeaders:false}));
// Read-only, opaque 192-bit capability for PUBLIC marketing media only. No writes or keys.
router.get('/:token',async(req,res)=>{
  res.set({'Cache-Control':'no-store','Referrer-Policy':'no-referrer','Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET, HEAD'});
  const job=getPublicJob(req.params.token);if(!job)return res.status(404).json({error:'Job unavailable'});
  let timer;
  try{
    const timeout=new Promise(resolve=>{timer=setTimeout(()=>resolve(null),req.method==='HEAD'?25000:120000)});
    const result=job.result||await Promise.race([job.promise,timeout]);
    if(!result){res.set('Retry-After','1');return res.status(202).end();}
    return res.redirect(307,result.cdn_url);
  }catch(error){return res.status(error.status||502).json({error:'Media unavailable'});}
  finally{if(timer)clearTimeout(timer);}
});
module.exports=router;
