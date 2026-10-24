import {wifiRouter} from './wifi.js';
import {resolve} from 'node:path';
import {runtimeSites,hostOf} from './sites.js';
import express from 'express';
import cookieParser from 'cookie-parser';
import {rateLimit} from 'express-rate-limit';
import pg from 'pg';
import {sameOrigin} from './security.js';
import {uploadRouter,cleanupUploads} from './uploads.js';
import {pagesRouter} from './pages.js';
import {workspaceRouter} from './workspace.js';
import {mesRouter} from './mes.js';
import {portfolioRouter} from './portfolio.js';
import {driveRouter} from './drive-routes.js';
import {previewRouter} from './media.js';
import {adminRouter} from './admin.js';
import {translationRouter} from './translation.js';
import {maintenanceGate,backupActive} from './storage.js';
import {oauthRouter} from './oauth.js';
export function createApp(pool,filesRoot,{sites=runtimeSites(),mesOnly=process.env.APP_MODE==='mes',webRoot=process.env.MES_WEB_ROOT}={}) {
 const app=express();app.disable('x-powered-by');app.set('trust proxy',(process.env.TRUST_PROXY||'loopback').split(',').map(v=>v.trim()));app.locals.sites=sites;app.locals.mesOnly=mesOnly;
 app.use((req,res,next)=>{res.set({'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});if(![hostOf(sites.mes),...(!mesOnly?[hostOf(sites.portfolio)]:[]),'127.0.0.1'].includes(req.hostname))return res.sendStatus(400);next();});
 app.get('/api/health',async(req,res)=>{await pool.query('select 1');res.json({ok:true});});
 app.use('/api',sameOrigin,cookieParser(),rateLimit({windowMs:60000,limit:180,skip:req=>['GET','PATCH'].includes(req.method)&&/^\/api\/mes\/(media|uploads)\/[a-f0-9-]{36}(?:\?|$)/.test(req.originalUrl),standardHeaders:'draft-7',legacyHeaders:false}));
 const authLimit=rateLimit({windowMs:900000,limit:30,standardHeaders:'draft-7',legacyHeaders:false});
 app.use('/api/oauth',authLimit,oauthRouter(pool));
 app.use(express.json({limit:'1mb'}));
 const gate=maintenanceGate();app.locals.maintenance=gate;app.use(gate.middleware);
 app.use('/api/mes/uploads',rateLimit({windowMs:60000,limit:600,standardHeaders:'draft-7',legacyHeaders:false}));
 app.use('/api/mes/media',rateLimit({windowMs:60000,limit:600,standardHeaders:'draft-7',legacyHeaders:false}));
 app.use('/api/portfolio',(req,res,next)=>!mesOnly&&req.hostname===hostOf(sites.portfolio)?next():res.sendStatus(404));
 app.use('/api/mes',(req,res,next)=>req.hostname===hostOf(sites.mes)?next():res.sendStatus(404));
 app.use((req,res,next)=>['login','register','reset','consumeToken'].includes(req.body?.action)||['passwordLogin','activateAccount'].includes(req.body?.name)?authLimit(req,res,next):next());
 app.use('/api/mes',driveRouter(pool));app.use('/api/mes',pagesRouter(pool));
 app.use('/api/mes',previewRouter(pool,filesRoot));
 app.use('/api/mes/wifi',wifiRouter(pool));
 app.use('/api/mes/admin',adminRouter(pool,filesRoot,gate));app.use('/api/mes',translationRouter(pool));
 if(!mesOnly)app.use('/api/portfolio',portfolioRouter(pool));app.use('/api/mes/uploads',uploadRouter(pool,filesRoot,gate));app.use('/api/mes',workspaceRouter(pool,filesRoot));app.use('/api/mes',mesRouter(pool,filesRoot));
 if(mesOnly&&webRoot){app.use(express.static(resolve(webRoot)));app.get(['/','/ticket/:reference','/page/:id'],(req,res)=>res.sendFile(resolve(webRoot,'index.html')));}
 app.use((err,req,res,next)=>{
  const code=err.code;
  if(['P0099','P0409'].includes(code)){err.status=409;err.expose=true;}
  const status=err.status||(['28000','invalid-credentials'].includes(code)?401:code==='rate-limited'?429:code==='P0001'?403:code==='password-policy'?400:503);
  if(status===503)console.error('API request failed',{code:code||'internal'});
  if(res.headersSent)return next(err);
  res.status(status).json({code:code==='28000'?'unauthenticated':code==='P0001'?'permission-denied':code||'unavailable',error:err.expose && status>=400 && status<600?err.message:'Request failed. Check credentials, permissions and input.'});
 });
 return app;
}
if(process.env.NODE_ENV!=='test') {
 const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:4,idleTimeoutMillis:30000,connectionTimeoutMillis:5000,options:'-c statement_timeout=15000'});
 pool.on('error',error=>console.error('Database connection interrupted',{code:error.code||'connection-error'}));
 const filesRoot=process.env.FILES_ROOT||'/var/lib/th-app/files';
 const app=createApp(pool,process.env.FILES_ROOT||'/var/lib/th-app/files');
 const server=app.listen(Number(process.env.PORT||3000),process.env.HOST||'127.0.0.1');server.requestTimeout=180000;
 const cleanup=setInterval(()=>{if(app.locals.maintenance.blocked||backupActive())return;return cleanupUploads(pool,filesRoot).then(()=>pool.query("delete from public.file_grants where expires<now(); delete from portfolio.sessions where expires<now(); delete from portfolio.tokens where expires<now()")).catch(()=>{});},3600000);cleanup.unref();
 process.on('SIGTERM',()=>{clearInterval(cleanup);server.close(()=>pool.end().then(()=>process.exit(0)));});
}
