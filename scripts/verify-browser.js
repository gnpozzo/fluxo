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
const emptyAccount={...account,id_cuenta_principal:'EMPTY',nombre:'Sin configuración',es_predeterminada:false,modulo_tarjetas_activo:false,modulo_ahorro_activo:false,modulo_cc_activo:false,modulo_inversiones_activo:false};
const fixtures={
 getConfig:{url:'https://qa.supabase.co',anonKey:'public-test-key'},
 getInitialData:{success:true,cuentas:[account,emptyAccount],meses:['2026-10'],categorias:[],tarjetas:[card,{...card,id_tarjeta:"DISABLED-CARD",id_cuenta_principal:"EMPTY"}],subcuentas:[{id_subcuenta:"DISABLED-SAVINGS",id_cuenta_principal:"EMPTY",nombre:"Deshabilitada"}],usuarios_cc:[],preferencias:{}},
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
   const chartIds = {Resumen:['dash-widget-moneyflow','dash-widget-categories'],Movimientos:['mov-donut-wrap','mov-evolucion-wrap'],Tarjetas:['tc-widget-moneyflow','tc-widget-categories'],'Gastos compartidos':['cc-widget-moneyflow','cc-widget-categories'],Ahorro:['aho-widget-moneyflow','aho-widget-categories'],Inversiones:['inv-widget-moneyflow','inv-widget-categories']};
   await page.waitForFunction(ids=>ids.every(id=>{const el=document.getElementById(id);return el && el.getBoundingClientRect().height>0 && !el.closest('details:not([open])');}),{},chartIds[name]);
   if(width<=900) await page.waitForFunction(()=>document.querySelector('#app-sidebar').getBoundingClientRect().right<=0);
   const overflow=await page.evaluate(()=>{const content=document.querySelector('.main-content');return document.documentElement.scrollWidth>innerWidth+2 || content.scrollWidth>content.clientWidth+2;});
   assert.equal(overflow,false,'page overflow in '+name+' at '+width);
  }
  await openNavigation(width);
  await page.click('#tab-btn-tarjetas');
  await page.waitForSelector('#tc-carousel-visual');
  if (!(await page.$eval('#tc-carousel-visual',el=>el.textContent)).includes('Visa QA')) await page.click('#tc-carousel-next');
  assert.equal(await page.$('#tc-card-select'),null);
  assert.ok((await page.$eval('#tc-carousel-visual',el=>el.textContent)).includes('Visa QA'));
  assert.equal(await page.$eval('#tc-btn-pagar-resumen',el=>el.disabled),true,'empty statement cannot register payment');
  assert.equal(await page.$eval('#tc-tope-kpi-val',el=>el.textContent),'Sin base de ingresos');
  assert.equal(await page.$eval('#tc-btn-vaciar-inline',el=>!!el.closest('details')),false);
  assert.equal(await page.$eval('#tc-btn-vaciar-inline',el=>el.textContent),'Vaciar consumos');
  if(width<=900) await page.waitForFunction(()=>document.querySelector('#app-sidebar').getBoundingClientRect().right<=0);
  await page.screenshot({path:'.audit.local/ux-tarjetas-'+width+'.png',fullPage:true});
  if(width===390){
   await page.click('#vista-tarjetas .ux-filter-trigger');
   await page.waitForSelector('#modal-filtros-vista-tarjetas.modal-open');
   await page.waitForFunction(()=>getComputedStyle(document.querySelector('#modal-filtros-vista-tarjetas')).opacity==='1');
   assert.ok(await page.$eval('#modal-filtros-vista-tarjetas .modal-dialog',el=>el.getBoundingClientRect().right<=innerWidth));
   await page.screenshot({path:'.audit.local/ux-filtros-modal-390.png'});
   await page.keyboard.press('Escape');
   assert.equal(await page.$eval('#modal-filtros-vista-tarjetas',el=>el.classList.contains('modal-open')),false);
  }
 }
 await page.setViewport({width:1440,height:960});
 await openNavigation(1440);
 // Filters are staged in a compact modal; cancel and Escape keep the active selection.
 await page.click('#tab-btn-tarjetas');
 await page.click('#vista-tarjetas .ux-filter-trigger');
 await page.waitForSelector('#modal-filtros-vista-tarjetas.modal-open');
 assert.equal(await page.$eval('#vista-tarjetas .ux-filter-trigger svg',el=>!!el.querySelector('polygon')),true);
 assert.equal(await page.$eval('#vista-tarjetas .ux-filter-trigger',el=>el.getBoundingClientRect().height),34);
 await page.select('#tc-cuenta-filter-draft','personal');
 await page.click('#modal-filtros-vista-tarjetas .modal-cancel');
 assert.equal(await page.$eval('#tc-cuenta-filter',el=>el.value),'');
 await page.click('#vista-tarjetas .ux-filter-trigger');
 await page.select('#tc-cuenta-filter-draft','personal');
 await page.click('#modal-filtros-vista-tarjetas .modal-confirm');
 assert.equal(await page.$eval('#tc-cuenta-filter',el=>el.value),'personal');
 assert.equal(await page.$eval('#vista-tarjetas .ux-filter-count',el=>el.textContent),'1');
 await page.click('#vista-tarjetas .ux-filter-trigger');
 await page.waitForFunction(()=>getComputedStyle(document.querySelector('#modal-filtros-vista-tarjetas')).opacity==='1');
 await page.screenshot({path:'.audit.local/ux-filtros-modal-1440.png'});
 await page.click('#modal-filtros-vista-tarjetas .ux-filter-modal-fields > button');
 await page.click('#modal-filtros-vista-tarjetas .modal-confirm');
 assert.equal(await page.$eval('#tc-cuenta-filter',el=>el.value),'');
 await page.select('#selector-cuenta','EMPTY');
 await page.waitForFunction(()=>App.Store.cuenta==='EMPTY');
 await page.waitForFunction(()=>document.querySelector('#page-title').textContent==='Resumen');
 for(const id of ['tarjetas','cc','ahorro','inversiones']) assert.equal(await page.$eval('#tab-btn-'+id,el=>getComputedStyle(el).display==='none'),true,'disabled module stays hidden');
 for(const action of ['tarjeta','cc','ahorro','inversion']) assert.equal(await page.$eval('[data-qa-action='+action+']',el=>el.hidden),true);
 assert.equal(await page.$eval('#tab-btn-movimientos',el=>el.hidden),false);
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

 // Cross-filtering uses real canvas clicks and keyboard modifiers, with historical category detail.
 await page.setViewport({width:1440,height:960});
 await page.click('#pill-ars');
 const movement=(id,cat,mes,importe,tipo='EGRESO')=>({id_movimiento:id,id_cuenta_principal:'QA',categoria_nombre:cat,fecha:mes+'-05',importe,tipo_mov:tipo,moneda:'ARS',descripcion:id});
 const current=[movement('VIVIENDA-OCT','Vivienda','2026-10',100),movement('COMIDA-OCT','Comida','2026-10',50),movement('SUELDO-OCT','Sueldo','2026-10',500,'INGRESO')];
 const historical=[movement('VIVIENDA-SEP','Vivienda','2026-09',40),movement('COMIDA-SEP','Comida','2026-09',10),...current];
 const evolution=[{mes:'2026-09',ingresos:0,egresos:50,balance:-50},{mes:'2026-10',ingresos:500,egresos:150,balance:350}];
 const crossData={success:true,kpis:{ingresos:500,egresos:150,resultado:350},movimientos:current,movimientosHistoricos:historical,evolucionMensual:evolution,evolucionPorMoneda:{ARS:evolution},kpisPorMoneda:{ARS:{ingresos:500,egresos:150,resultado:350}}};
 fixtures.getDashboardData=crossData;
 const chartAsset=loaded.find(url=>url.includes('vendor_ui-'));
 const readChart=async id=>page.evaluate(async ({id,asset})=>{const module=await import(asset);const Chart=Object.values(module).find(value=>typeof value?.getChart==='function');const chart=Chart.getChart(document.getElementById(id));return chart ? {labels:chart.data.labels,datasets:chart.data.datasets.map(d=>d.data)} : null;},{id,asset:chartAsset});
 const canvasClick=async(id,index,dataset=0,mode='element',ctrl=false)=>{
  await page.$eval('#'+id,el=>el.scrollIntoView({block:'center'}));
  await page.waitForFunction(async({id,asset})=>{const module=await import(asset);const Chart=Object.values(module).find(value=>typeof value?.getChart==='function');return !Chart.getChart(document.getElementById(id))?.animating;},{},{id,asset:chartAsset});
  const point=await page.evaluate(async({id,asset,index,dataset,mode})=>{
   const module=await import(asset);const Chart=Object.values(module).find(value=>typeof value?.getChart==='function');const chart=Chart.getChart(document.getElementById(id));const bounds=chart.canvas.getBoundingClientRect();let p;
   if(mode==='legend'){const box=chart.legend.legendHitBoxes[index];p={x:chart.legend.left+box.left+box.width/2,y:chart.legend.top+box.top+box.height/2};}
   else if(mode==='axis')p={x:chart.scales.x.getPixelForValue(index),y:chart.chartArea.bottom+12};
   else p=chart.getDatasetMeta(dataset).data[index].getCenterPoint();
   return {x:bounds.x+p.x,y:bounds.y+p.y};
  },{id,asset:chartAsset,index,dataset,mode});
  if(ctrl)await page.keyboard.down('Control');await page.mouse.click(point.x,point.y);if(ctrl)await page.keyboard.up('Control');
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 };
 for(const [name,nav,legend,bar,list] of [
  ['dashboard','nav-btn-dashboard','dash-categories-legend','dash-moneyflow-canvas','dash-mov-list'],
  ['movimientos','tab-btn-movimientos','mov-donut-wrap .fintech-legend-list','mov-evolucion-canvas','mov-tabla-wrap']
 ]){
  await page.click('#'+nav);await page.evaluate(async({name,data})=>{const mod=await App.Modules[name].load();await mod.cargar();mod._render(data);},{name,data:crossData});
  await page.waitForFunction(name=>document.querySelector('.vista-container.active')?.id==='vista-'+name && getComputedStyle(document.querySelector('.vista-container.active')).opacity==='1',{},name);
  await page.click('#'+legend+' [aria-label="Filtrar: Vivienda"]');
  let text=await page.$eval('#'+list,el=>el.textContent);assert.ok(text.includes('VIVIENDA-OCT')&&!text.includes('COMIDA-OCT'),name+' category filters list');
  assert.deepEqual((await readChart(bar)).datasets[1],[40,100],name+' category filters monthly bars');
  await page.keyboard.down('Control');await page.click('#'+legend+' [aria-label="Filtrar: Comida"]');await page.keyboard.up('Control');
  assert.deepEqual((await readChart(bar)).datasets[1],[50,150],name+' Ctrl adds category');
  await canvasClick(bar,0,1);text=await page.$eval('#'+list,el=>el.textContent);assert.ok(text.includes('VIVIENDA-SEP')&&!text.includes('VIVIENDA-OCT'),name+' month cascades');
  await canvasClick(bar,1,1,'axis',true);text=await page.$eval('#'+list,el=>el.textContent);assert.ok(text.includes('VIVIENDA-OCT')&&text.includes('VIVIENDA-SEP'),name+' Ctrl axis label adds month');
  await page.click('#vista-'+name+' .chart-filter-status button:last-child');
  await canvasClick(bar,0,0,'legend');assert.ok(!(await page.$eval('#'+list,el=>el.textContent)).includes('COMIDA-OCT'),name+' native legend filters list');
  await page.click('#vista-'+name+' .chart-filter-status button:last-child');
 }
 await page.click('#tab-btn-tarjetas');
 const tcData={success:true,kpis:{},consumos:current.filter(m=>m.tipo_mov==='EGRESO').map(m=>({...m,id_consumo_tarjeta:m.id_movimiento,id_tarjeta:'QA-CARD',tarjeta_nombre:'Visa QA',tipo_consumo:'COMUN'}))};
 await page.evaluate(async data=>{const mod=await App.Modules.tarjetas.load();mod._render(data);},tcData);
 await page.click('#tc-categories-legend [aria-label="Filtrar: Vivienda"]');
 assert.equal((await readChart('tc-moneyflow-canvas')).datasets[0][0],100);
 assert.ok(!(await page.$eval('#tc-consumos-list',el=>el.textContent)).includes('COMIDA-OCT'));
 await canvasClick('tc-categories-donut-canvas',1,0,'element',true);
 assert.equal((await readChart('tc-moneyflow-canvas')).datasets[0][0],150,'Ctrl donut adds another category');
 await page.click('#vista-tarjetas .chart-filter-status button:last-child');
 await page.click('#tab-btn-cc');
 const ccData={success:true,kpis:{},consumos:tcData.consumos.map(m=>({...m,id_consumo_cc:m.id_movimiento,importe_total:m.importe,pagador:'YO',mi_parte:m.importe/2}))};
 await page.evaluate(async data=>{const mod=await App.Modules.cc.load();mod._render(data);},ccData);
 await page.click('#cc-categories-legend [aria-label="Filtrar: Vivienda"]');
 assert.equal((await readChart('cc-moneyflow-canvas')).datasets[0].at(-1),100);
 assert.ok(!(await page.$eval('#cc-consumos-list',el=>el.textContent)).includes('COMIDA-OCT'));
 await page.click('#vista-cc .chart-filter-status button:last-child');

 await page.click('#tab-btn-ahorro');
 const savings={success:true,kpis:{arsTotal:150,usdTotal:0,consolidadoArs:150},subcuentas:[],transferencias:current.filter(m=>m.tipo_mov==='EGRESO').map(m=>({...m,id_transferencia:m.id_movimiento,tipo_mov:'DEPOSITO',subcuenta_nombre:m.categoria_nombre}))};
 await page.evaluate(async data=>{const mod=await App.Modules.ahorro.load();mod._render(data);},savings);
 await page.click('#aho-categories-legend [aria-label="Filtrar: Vivienda"]');
 assert.equal((await readChart('aho-moneyflow-canvas')).datasets[0].at(-1),100);
 assert.ok(!(await page.$eval('#aho-movimientos-list',el=>el.textContent)).includes('COMIDA-OCT'));
 await page.keyboard.down('Control');await page.click('#aho-categories-legend [aria-label="Filtrar: Comida"]');await page.keyboard.up('Control');
 assert.equal((await readChart('aho-moneyflow-canvas')).datasets[0].at(-1),150);
 await page.click('#vista-ahorro .chart-filter-status button:last-child');
 await page.click('#tab-btn-inversiones');
 const investment={success:true,kpis:{valorActual:150,costoTotal:150,gananciaTotal:0,rendimientoPorc:0},portfolio:[{id_operacion:'BTC-OP',ticker:'BTC',fecha:'2026-10-05',tipo_op:'COMPRA',cantidad:1,precio:100},{id_operacion:'AAPL-OP',ticker:'AAPL',fecha:'2026-10-05',tipo_op:'COMPRA',cantidad:1,precio:50}],tenencias:[{ticker:'BTC',moneda:'ARS',cantidad:1,precioProm:100,costoTotalArs:100,valorActualArs:100,gananciaArs:0,rendPct:0},{ticker:'AAPL',moneda:'ARS',cantidad:1,precioProm:50,costoTotalArs:50,valorActualArs:50,gananciaArs:0,rendPct:0}]};
 await page.evaluate(async data=>{const mod=await App.Modules.inversiones.load();mod._render(data);},investment);
 await page.click('#inv-categories-legend [aria-label="Filtrar: Criptomonedas"]');
 assert.equal((await readChart('inv-moneyflow-canvas')).datasets[0].at(-1),100);
 assert.ok(!(await page.$eval('#inv-operaciones-list',el=>el.textContent)).includes('AAPL'));
 await page.keyboard.down('Control');await page.click('#inv-categories-legend [aria-label="Filtrar: CEDEARs"]');await page.keyboard.up('Control');
 assert.equal((await readChart('inv-moneyflow-canvas')).datasets[0].at(-1),150);
 await page.click('#vista-inversiones .chart-filter-status button:last-child');
 await page.screenshot({path:'.audit.local/ux-crossfilters.png',fullPage:true});
 await page.evaluate(()=>window.toggleAppTheme());
 assert.equal(await page.$eval('html',el=>el.dataset.theme),'dark');
 assert.deepEqual(errors,[]);
 console.log('PASS: login, seven modules, six responsive views with visible charts, account module gating, card carousel, crossed chart filters in six modules, five mobile forms, currency percentages, empty payment, theme and production CSP (mocked API).');
}catch(error){if(browser){const pages=await browser.pages();await pages.at(-1).screenshot({path:'.audit.local/ux-failure.png'});}throw error;}finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
