const{parentPort,workerData}=require('node:worker_threads');
const fs=require('node:fs'),path=require('node:path');
(async()=>{
 const satori=require('satori').default,{Resvg}=require('@resvg/resvg-js'),sharp=require('sharp');
 const template=require('./template');const a=workerData;
 const svg=await satori(template(a),{width:a.width,height:a.height,fonts:[
  {name:'Clash Display',data:fs.readFileSync(path.join(__dirname,'fonts/ClashDisplay-Bold.ttf')),weight:700,style:'normal'},
  {name:'Satoshi',data:fs.readFileSync(path.join(__dirname,'fonts/Satoshi-Regular.ttf')),weight:400,style:'normal'}]});
 const png=new Resvg(svg).render().asPng();const image=await sharp(png).webp({quality:88}).toBuffer();parentPort.postMessage(image);
})().catch(()=>{parentPort.postMessage({error:'Render failed'});process.exitCode=1;});
