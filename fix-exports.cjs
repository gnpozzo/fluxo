const fs = require('fs');
const path = require('path');

const modDir = 'src/modules';
const files = fs.readdirSync(modDir);

files.forEach(f => {
  const p = path.join(modDir, f);
  let content = fs.readFileSync(p, 'utf8');
  
  // Si la clase no tiene export, se lo agregamos
  content = content.replace(/^class ([a-zA-Z0-9_]+)/m, 'export class $1');
  
  fs.writeFileSync(p, content);
});

// Arreglar main.js para que las importaciones correspondan con las clases extraídas dinámicamente
let mainContent = fs.readFileSync('src/main.js', 'utf8');

mainContent = mainContent.replace(/import \{ CtaCorrienteModule \} from '.\/modules\/CcModule.js';/g, "import { CCModule } from './modules/CcModule.js';");
mainContent = mainContent.replace(/window.App.Modules\['ctacorrientemodule'\] = new CtaCorrienteModule\(\);/g, "window.App.Modules['cc'] = new CCModule();");

fs.writeFileSync('src/main.js', mainContent);
console.log('Fixed exports!');
