import test from 'node:test';
import assert from 'node:assert/strict';
import {ChartFilters, movementDimensions, filteredEvolution} from '../src/core/ChartFilters.js';
const rows = [
 {fecha:'2026-09-01',categoria_nombre:'Vivienda',tipo_mov:'EGRESO',importe:40},
 {fecha:'2026-10-01',categoria_nombre:'Vivienda',tipo_mov:'EGRESO',importe:100},
 {fecha:'2026-10-01',categoria_nombre:'Comida',tipo_mov:'EGRESO',importe:50},
 {fecha:'2026-10-01',categoria_nombre:'Sueldo',tipo_mov:'INGRESO',importe:500}
];
test('cross filtering composes OR selections with AND dimensions without mutating rows',()=>{
 const f=new ChartFilters(); const before=JSON.stringify(rows);
 f.pick({categoria:'Vivienda'}); assert.equal(f.apply(rows,movementDimensions).length,2);
 f.pick({categoria:'Comida'},{ctrlKey:true}); assert.equal(f.apply(rows,movementDimensions).length,3);
 f.pick({mes:'2026-10'}); assert.equal(f.apply(rows,movementDimensions).length,2);
 f.pick({categoria:'Vivienda'},{ctrlKey:true}); assert.equal(f.apply(rows,movementDimensions)[0].importe,50);
 f.clear(); assert.equal(f.apply(rows,movementDimensions).length,4);
 assert.equal(JSON.stringify(rows),before);
});
test('facets retain alternative categories and historical monthly bars recalculate from matching rows',()=>{
 const f=new ChartFilters();f.pick({categoria:'Vivienda',mes:'2026-10'});
 assert.equal(f.apply(rows,movementDimensions,['categoria']).length,3);
 const history=filteredEvolution(f.apply(rows,movementDimensions,['mes']),[{mes:'2026-09'},{mes:'2026-10'}]);
 assert.deepEqual(history.map(h=>h.egresos),[40,100]);assert.equal(history[1].ingresos,0);
 f.resetContext('account:month:ARS'); assert.equal(f.active,false);
 f.pick({categoria:'Comida'});f.resetContext('account:month:ARS');assert.equal(f.active,true);
 f.resetContext('other:month:ARS');assert.equal(f.active,false);
});
test('native Chart.js events support control and command selection, and repeat click clears',()=>{
 const f=new ChartFilters();f.pick({categoria:'Vivienda'});f.pick({categoria:'Comida'},{native:{ctrlKey:true}});
 assert.equal(f.selections.get('categoria').size,2);
 f.pick({categoria:'Vivienda'},{native:{metaKey:true}});assert.deepEqual([...f.selections.get('categoria')],['Comida']);
 f.pick({categoria:'Comida'});assert.equal(f.active,false);
});
