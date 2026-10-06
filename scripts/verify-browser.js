// Production assets + real CSP, with a synthetic identity and mocked API.
// This smoke test never authenticates a real user or changes remote data.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';

const user={id:'11111111-1111-4111-8111-111111111111',email:'qa@example.test',aud:'authenticated',role:'authenticated',user_metadata:{full_name:'QA'}};
const account={id_cuenta_principal:'QA',nombre:'QA',activa:true,es_predeterminada:true,modulo_tarjetas_activo:true,modulo_cc_activo:true,modulo_ahorro_activo:true,modulo_inversiones_activo:true};
const card={id_tarjeta:'QA-CARD',id_cuenta_principal:'QA',nombre:'Visa QA',activa:true,banco:'QA',red:'VISA',total_resumen_ars:0,total_resumen_usd:0,fecha_vencimiento_actual:'2026-10-09'};
const emptyAccount={...account,id_cuenta_principal:'EMPTY',nombre:'Sin configuración',es_predeterminada:false,modulo_cc_activo:false,modulo_inversiones_activo:false};
const fixtures={
 getConfig:{url:'https://qa.supabase.co',anonKey:'public-test-key'},
 getInitialData:{success:true,cuentas:[account,emptyAccount],meses:['2026-10'],categorias:[],tarjetas:[card],subcuentas:[],usuarios_cc:[],preferencias:{}},
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
 const openNavigation = async width => {
  if(width<=900){
   await page.waitForFunction(()=>document.querySelector('#app-sidebar').getBoundingClientRect().right<=0);
   await page.click('#sidebar-toggle');
  }
  await page.waitForFunction(()=>Math.abs(document.querySelector('#app-sidebar').getBoundingClientRect().left)<1);
 };
 // Exercise the real sidebar and every responsive layout without remote writes.
 await page.setViewport({width:1440,height:960});
 for(const width of [1440,1024,768,390]){
  await page.setViewport({width,height:960});
  for(const [name,id] of [['Resumen','nav-btn-dashboard'],['Movimientos','tab-btn-movimientos'],['Tarjetas','tab-btn-tarjetas'],['Gastos compartidos','tab-btn-cc'],['Ahorro','tab-btn-ahorro'],['Inversiones','tab-btn-inversiones']]){
   await openNavigation(width);
   await page.click('#'+id);
   await page.waitForFunction(name=>document.querySelector('#page-title')?.textContent===name,{},name);
   await page.waitForFunction(()=>document.querySelector('.vista-container.active')?.querySelector('.ux-analysis'));
   if(width<=900) await page.waitForFunction(()=>document.querySelector('#app-sidebar').getBoundingClientRect().right<=0);
   const overflow=await page.evaluate(()=>{const content=document.querySelector('.main-content');return document.documentElement.scrollWidth>innerWidth+2 || content.scrollWidth>content.clientWidth+2;});
   assert.equal(overflow,false,'page overflow in '+name+' at '+width);
  }
  await openNavigation(width);
  await page.click('#tab-btn-tarjetas');
  await page.waitForSelector('#tc-card-select');
  await page.select('#tc-card-select','1');
  assert.equal(await page.$eval('#tc-btn-pagar-resumen',el=>el.disabled),true,'empty statement cannot register payment');
  assert.equal(await page.$eval('#tc-tope-kpi-val',el=>el.textContent),'Sin base de ingresos');
  assert.equal(await page.$eval('#tc-btn-vaciar-inline',el=>!!el.closest('.ux-more')),true);
  if(width<=900) await page.waitForFunction(()=>document.querySelector('#app-sidebar').getBoundingClientRect().right<=0);
  await page.screenshot({path:'.audit.local/ux-tarjetas-'+width+'.png',fullPage:true});
 }
 await page.setViewport({width:1440,height:960});
 await openNavigation(1440);
 await page.select('#selector-cuenta','EMPTY');
 await page.waitForFunction(()=>App.Store.cuenta==='EMPTY');
 assert.equal(await page.$eval('#tab-btn-tarjetas',el=>getComputedStyle(el).display==='none'),false,'empty account keeps navigation');
 await page.select('#selector-cuenta','QA');
 await page.click('#tab-btn-ahorro');
 await page.waitForSelector('#aho-btn-ars');
 await page.click('#pill-usd');
 await page.waitForFunction(()=>App.Store.globalCurrency==='USD');
 assert.equal(await page.$eval('#aho-btn-ars',el=>getComputedStyle(el.parentElement).display),'none');
 await page.click('#tab-btn-movimientos');
 await page.waitForSelector('#mov-btn-nuevo');
 await page.click('#mov-btn-nuevo');
 await page.waitForSelector('#modal-movimientos.modal-open');
 assert.equal(await page.$eval('#modal-movimientos select[name=moneda]',el=>el.value),'USD','new movement keeps explicit selected currency');
 await page.click('#modal-movimientos .modal-x');

 // Filled fixtures verify currency separation and percentage-based amounts.
 const income = (id,moneda,importe)=>({id_movimiento:id,id_cuenta_principal:'QA',tipo_mov:'INGRESO',fecha:'2026-10-05',descripcion:id,moneda,importe});
 fixtures.getDashboardData={success:true,kpis:{ingresos:700,egresos:0,resultado:700},kpisPorMoneda:{ARS:{ingresos:700,egresos:0,resultado:700},USD:{ingresos:100,egresos:0,resultado:100}},movimientos:[income('INGRESO-ARS','ARS',700),income('INGRESO-USD','USD',100)],evolucionPorMoneda:{ARS:[],USD:[]}};
 await page.evaluate(async data=>{App.API.invalidateAll();const mod=await App.Modules.movimientos.load();mod._render(data);},fixtures.getDashboardData);
 const tableText=await page.$eval('#mov-tabla-wrap',el=>el.textContent);
 assert.ok(tableText.includes('INGRESO-USD')&&!tableText.includes('INGRESO-ARS'));
 await page.click('#mov-btn-nuevo');
 await page.waitForSelector('#modal-movimientos.modal-open');
 await page.click('#btn-modo-monto-pct');
 await page.waitForFunction(()=>document.querySelector('#modal-movimientos input[name=importe]').value==='25.00');
 await page.select('#modal-movimientos select[name=moneda]','ARS');
 await page.waitForFunction(()=>document.querySelector('#modal-movimientos input[name=importe]').value==='175.00');
 assert.equal(await page.$eval('#modal-movimientos select[name=moneda]',el=>!!el.labels.length),true);
 assert.ok((await page.$eval('#info-gasto-pct',el=>el.textContent)).includes('$ 700,00'),'ARS base stays native with global USD');
 assert.equal(await page.evaluate(()=>App.Utils.formatearMonedaNativa(100,'USD')),'US$ 100,00');
 await page.screenshot({path:'.audit.local/ux-movimiento-form-1440.png'});
 await page.click('#modal-movimientos .modal-x');
 const emptyConsumos = fixtures.getConsumosTC;
 fixtures.getConsumosTC = {success:true,kpis:{},consumos:[{id_consumo_tarjeta:'ARS-TC',id_tarjeta:'QA-CARD',fecha:'2026-10-05',importe:20,moneda:'ARS',descripcion:'Consumo ARS',pagado:false},{id_consumo_tarjeta:'USD-TC',id_tarjeta:'QA-CARD',fecha:'2026-10-05',importe:10,moneda:'USD',descripcion:'Consumo USD',pagado:false}]};
 await page.evaluate(()=>App.API.invalidateAll());
 await page.click('#tab-btn-tarjetas');
 await page.evaluate(async data=>{const mod=await App.Modules.tarjetas.load();await mod.cargar();mod._render(data);},fixtures.getConsumosTC);
 await page.click('#tc-btn-pagar-resumen');
 await page.waitForSelector('#modal-tc-pagar-resumen.modal-open');
 const paymentText=await page.$eval('#modal-tc-pagar-resumen .modal-body',el=>el.textContent);
 assert.ok(paymentText.includes('$ 20,00') && paymentText.includes('US$ 10,00'),'payment confirmation keeps both native currencies under global USD');
 await page.click('#modal-tc-pagar-resumen .modal-x');
 fixtures.getConsumosTC = emptyConsumos;
 await page.evaluate(async data=>{const mod=await App.Modules.tarjetas.load();mod._render(data);},fixtures.getConsumosTC);
 await page.setViewport({width:390,height:844});
 for(const [nav,button] of [['tab-btn-movimientos','mov-btn-nuevo'],['tab-btn-tarjetas','tc-btn-nuevo-inline'],['tab-btn-cc','cc-btn-nuevo'],['tab-btn-ahorro','aho-btn-nuevo'],['tab-btn-inversiones','inv-btn-nuevo']]){
  await openNavigation(390);await page.click('#'+nav);
  await page.waitForFunction(()=>document.querySelector('#app-sidebar').getBoundingClientRect().right<=0);
  await page.click('#'+button);await page.waitForSelector('.modal-open');
  await page.waitForFunction(()=>getComputedStyle(document.querySelector('.modal-open')).opacity==='1' && getComputedStyle(document.querySelector('.modal-open .modal-content')).transform==='matrix(1, 0, 0, 1, 0, 0)');
  const fit=await page.$eval('.modal-open .modal-dialog',el=>{const r=el.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&el.scrollWidth<=el.clientWidth+2;});
  assert.ok(fit,'mobile form fits: '+button);
  await page.screenshot({path:'.audit.local/ux-form-'+button+'-390.png'});
  await page.click('.modal-open .modal-x');
 }
 await page.evaluate(()=>window.toggleAppTheme());
 assert.equal(await page.$eval('html',el=>el.dataset.theme),'dark');
 assert.deepEqual(errors,[]);
 console.log('PASS: login, seven modules, six responsive views, five mobile forms, currency percentages, empty payment, theme and production CSP (mocked API).');
}catch(error){if(browser){const pages=await browser.pages();await pages.at(-1).screenshot({path:'.audit.local/ux-failure.png'});}throw error;}finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
