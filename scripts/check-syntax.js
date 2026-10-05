import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const walk=path=>fs.readdirSync(path,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?walk(`${path}/${entry.name}`):entry.name.endsWith('.js')?[`${path}/${entry.name}`]:[]);
const files=['vite.config.js',...['src','api','api_controllers','api_lib','shared','scripts','tests'].flatMap(walk)];
let failed=false;
for(const file of files){const result=spawnSync(process.execPath,['--check',file],{encoding:'utf8'});if(result.status!==0){failed=true;console.error(file,result.stderr);}}
if(failed)process.exit(1);
console.log(`Syntax OK: ${files.length} JavaScript files.`);
