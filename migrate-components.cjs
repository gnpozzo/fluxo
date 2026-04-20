const fs = require('fs');
const path = require('path');

const components = [
  { file: 'component-toast.html', className: 'Toast', out: 'src/components/Toast.js', assign: 'window.App.Toast = new Toast();' },
  { file: 'component-modal.html', className: 'Modal', out: 'src/components/Modal.js', assign: 'window.App.Modal = Modal;' },
  { file: 'component-datatable.html', className: 'DataTable', out: 'src/components/DataTable.js', assign: 'window.App.DataTable = DataTable;' },
  { file: 'component-form-validator.html', className: 'FormValidator', out: 'src/components/FormValidator.js', assign: 'window.App.FormValidator = FormValidator;' },
  { file: 'app-icons.html', className: null, out: 'src/core/AppIcons.js', assign: 'import "./core/AppIcons.js";' }
];

let mainAdditions = '';

components.forEach(({file, className, out, assign}) => {
  if (!fs.existsSync(file)) return;
  const content = fs.readFileSync(file, 'utf8');
  const match = content.match(/<script>([\s\S]*?)<\/script>/i);
  let js = match ? match[1] : '';

  if (className) {
    js = js.replace('class ' + className, 'export class ' + className);
    mainAdditions += `import { ${className} } from './${out.replace('src/','')}';\n${assign}\n`;
  } else if (file === 'app-icons.html') {
    mainAdditions += assign + '\n';
  }

  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, "'use strict';\n" + js.replace(/'use strict';/g, '').trim());
  fs.unlinkSync(file);
});

if (mainAdditions) {
  let main = fs.readFileSync('src/main.js', 'utf8');
  main = main.replace('// 3. UI Components', '// 3. UI Components\n' + mainAdditions);
  fs.writeFileSync('src/main.js', main);
  console.log('✓ Componentes UI migradas y agregadas a main.js');
}

// Generar mock para api_getInitialData
const initialDataMock = `export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({error: 'Methosd Not Allowed'});
  return res.status(200).json({
    success: true,
    cuentas: [{ id_cuenta_principal: '1', nombre: 'Mock Cuenta', es_predeterminada: true, modulo_tarjetas_activo: true, modulo_cc_activo: true }],
    meses: ['2023-10'],
    categorias: [],
    tarjetas: [],
    usuarios_cc: []
  });
};`;
fs.writeFileSync('api/getInitialData.js', initialDataMock);
console.log('✓ Mock API getInitialData creado para no quebrar el boot');
