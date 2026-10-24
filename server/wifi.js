import http from 'node:http';
import {Router} from 'express';
import {actorFor} from './security.js';
export function wifiCommand(action,data={}){
 return new Promise((resolve,reject)=>{
  const body=JSON.stringify({action,data});const request=http.request({socketPath:process.env.NODE_ENV==='test'&&process.env.TEST_WIFI_SOCKET||'/run/th-wifi/control.sock',path:'/',method:'POST',headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)}},response=>{let value='';response.on('data',chunk=>{value+=chunk;if(value.length>16384)request.destroy(new Error('Invalid Wi-Fi response'));});response.on('end',()=>{try{const result=JSON.parse(value);if(response.statusCode!==200)throw Object.assign(new Error(result.error),{status:409,expose:true});resolve(result);}catch(error){reject(error);}});});
  request.setTimeout(20000,()=>request.destroy(new Error('Wi-Fi broker timeout')));request.on('error',reject);request.end(body);
 });
}
export function wifiRouter(pool){
 const router=Router();
 router.use(async(req,res,next)=>{const {rows:[row]}=await pool.query('select public.mes_dispatch($1,$2,$3) result',['getSession',{},actorFor(req.cookies.th_mes,req.headers['x-mes-tester'])]);if(!row.result?.isOwner)return res.sendStatus(403);next();});
 router.get('/',async(req,res)=>{if(req.app.locals.mesOnly)return res.json({available:false});try{res.json(await wifiCommand('status'));}catch{res.json({available:false});}});
 router.post('/:action',async(req,res)=>{if(req.app.locals.mesOnly)return res.sendStatus(404);if(!['connect','confirm'].includes(req.params.action))return res.sendStatus(400);res.json(await wifiCommand(req.params.action,req.body));});
 return router;
}
