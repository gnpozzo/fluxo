const fs = require('fs');
const path = require('path');

const apiDir = path.join(__dirname, 'api');
const controllersDir = path.join(apiDir, '_controllers');

if (!fs.existsSync(controllersDir)) {
  fs.mkdirSync(controllersDir);
}

const files = fs.readdirSync(apiDir).filter(f => f.endsWith('.js') && f !== 'index.js');

let imports = '';
let switchCases = '';

for (const file of files) {
  const name = file.replace('.js', '');
  fs.renameSync(path.join(apiDir, file), path.join(controllersDir, file));
  
  imports += `import ${name} from './_controllers/${file}';\n`;
  switchCases += `    case '${name}': return await ${name}(req, res);\n`;
}

const indexContent = `${imports}

export default async function handler(req, res) {
  const endpoint = req.query?.endpoint || req.url.split('?')[0].split('/').pop();
  
  switch(endpoint) {
${switchCases}
    default:
      return res.status(404).json({ success: false, error: 'Endpoint not found: ' + endpoint });
  }
}
`;

fs.writeFileSync(path.join(apiDir, 'index.js'), indexContent);
console.log('API consolidated!');
