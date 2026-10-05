// Production assets + real CSP, with a synthetic identity and mocked API.
// This smoke test never authenticates a real user or changes remote data.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';

const user={id:'11111111-1111-4111-8111-111111111111',email:'qa@example.test',aud:'authenticated',role:'authenticated',user_metadata:{full_name:'QA'}};
const account={id_cuenta_principal:'QA',nombre:'QA',activa:true,es_predeterminada:true,modulo_tarjetas_activo:true,modulo_cc_activo:true,modulo_ahorro_activo:true,modulo_inversiones_activo:true};
const fixtures={
 getConfig:{url:'https://qa.supabase.co',anonKey:'public-test-key'},
 getInitialData:{success:true,cuentas:[account],meses:['2026-10'],categorias:[],tarjetas:[],subcuentas:[],usuarios_cc:[],preferencias:{}},
 getUserInfo:{success:true,user_metadata:user.user_metadata,email:user.email},
 getDashboardData:{success:true,kpis:{ingresos:0,egresos:0,resultado:0,pctSaldado:0,pctPendiente:0},movimientos:[],evolucionMensual:[],kpisPorMoneda:{ARS:{},USD:{}}},
 getConsumosTC:{success:true,consumos:[],tarjetas:[],kpis:{}},
 getConsumosCC:{success:true,consumos:[],usuarios:[],kpis:{}},
 getAhorros:{success:true,transferencias:[],subcuentas:[],kpis:{}},
 getPortfolio:{success:true,portfolio:[],tenencias:[],kpis:{valorActual:0,costoTotal:0,gananciaTotal:0,rendimientoPorc:0}},
 admin_getCuentasPrincipales:{success:true,data:[account]},
 togglePago:{success:true,data:{}},
 getNotificaciones:{success:true,notificaciones:[]}
};
const csp=JSON.parse(fs.readFileSync('vercel.json')).headers[0].headers.find(h=>h.key==='Content-Security-Policy').value;
const server=http.createServer((req,res)=>{
 res.setHeader('Content-Security-Policy',csp);
 if(req.url.startsWith('/api/')){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(fixtures[req.url.split('?')[0].slice(5)]||{success:true,data:[]}));return;}
 const relative=req.url==='/'?'index.html':req.url.split('?')[0].slice(1);
 const file=path.resolve('dist',relative);
 if(!file.startsWith(path.resolve('dist')+path.sep)||!fs.existsSync(file)){res.statusCode=404;res.end();return;}
 res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.html')?'text/html':'application/octet-stream');
 res.end(fs.readFileSync(file));
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const executable=process.env.BROWSER_PATH||['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p=>fs.existsSync(p));
let browser;
try {
 browser=await puppeteer.launch({executablePath:executable,headless:true});
 const page=await browser.newPage();await page.setViewport({width:1440,height:960});
 const errors=[],loaded=[];
 page.on('pageerror',error=>errors.push(error.message));
 page.on('console',message=>{if(message.type()==='error' && !message.text().includes('Failed to load resource'))errors.push(message.text());});
 await page.setRequestInterception(true);
 page.on('request',request=>{
  const url=request.url();if(url.includes('/assets/'))loaded.push(url);
  if(url.startsWith('https://qa.supabase.co/'))return request.respond({status:200,contentType:'application/json',body:JSON.stringify(user),headers:{'Access-Control-Allow-Origin':'*'}});
  if(!url.startsWith('http://127.0.0.1:')&&!url.startsWith('data:'))return request.abort();
  return request.continue();
 });
 const url=`http://127.0.0.1:${server.address().port}`;
 await page.goto(url,{waitUntil:'networkidle0'});
 assert.equal(await page.$eval('#login-overlay',el=>getComputedStyle(el).display),'flex');
 assert.equal(loaded.some(url=>/Module-/.test(url)),false,'login should not load screen modules');
 const exp=Math.floor(Date.now()/1000)+3600;
 const token=Buffer.from('{}').toString('base64url')+'.'+Buffer.from(JSON.stringify({sub:user.id,exp,aud:'authenticated'})).toString('base64url')+'.test';
 await page.evaluate((session)=>localStorage.setItem('sb-qa-auth-token',JSON.stringify(session)),{access_token:token,refresh_token:'test',expires_at:exp,expires_in:3600,token_type:'bearer',user});
 await page.reload({waitUntil:'networkidle0'});
 await page.waitForFunction(()=>window.App?.Auth?.user?.id);
 await page.waitForFunction(()=>getComputedStyle(document.querySelector('#login-overlay')).display==='none');
 for(const name of ['dashboard','movimientos','tarjetas','cc','ahorro','inversiones','admin']){
  const result=await page.evaluate(async name=>{const module=await App.Modules[name].load();await module.cargar();return true;},name);
  assert.equal(result,true);
 }
 await page.waitForSelector('.modal-open');
 assert.equal(await page.$$eval('[onclick],[onerror],[onsubmit]',els=>els.length),0);
 await page.screenshot({path:'.audit.local/browser-smoke.png',fullPage:true});
 await page.click('.modal-open .modal-x');
 await page.setViewport({width:390,height:844});
 await page.waitForFunction(()=>Math.abs(document.querySelector('.main-wrapper').getBoundingClientRect().left)<1);
 await page.waitForFunction(()=>{const button=document.querySelector('#sidebar-toggle'),r=button.getBoundingClientRect();return button.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));});
 await page.click('#sidebar-toggle');
 assert.equal(await page.$eval('#app-sidebar',el=>el.classList.contains('sidebar-open')),true);
 await page.click('#sidebar-backdrop',{offset:{x:385,y:400}});
 assert.equal(await page.$eval('#app-sidebar',el=>el.classList.contains('sidebar-open')),false);
 await page.screenshot({path:'.audit.local/browser-mobile.png',fullPage:true});
 await page.evaluate(()=>window.toggleAppTheme());
 assert.equal(await page.$eval('html',el=>el.dataset.theme),'dark');
 assert.deepEqual(errors,[]);
 console.log('PASS: login, lazy loading, seven modules and modal under production CSP (mocked API).');
}finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
