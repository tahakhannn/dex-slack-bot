const fs = require('fs');
const path = require('path');

const handlersDir = path.join(__dirname, 'handlers');
const files = fs.readdirSync(handlersDir).filter(f => f.endsWith('.js')).map(f => path.join(handlersDir, f));

const registeredIds = new Set();
const referencedIds = new Set();

files.forEach(file => {
  const content = fs.readFileSync(file, 'utf8');
  
  // Find registered actions/views (e.g. app.action("my_id", ...))
  const registerRegex = /app\.(?:action|view)\(\s*["']([^"']+)["']/g;
  let match;
  while ((match = registerRegex.exec(content)) !== null) {
    registeredIds.add(match[1]);
  }
  
  // Find referenced actions/views (e.g. action_id: "my_id", callback_id: "my_id")
  const refRegex = /(?:action_id|callback_id)\s*:\s*["']([^"']+)["']/g;
  while ((match = refRegex.exec(content)) !== null) {
    referencedIds.add(match[1]);
  }
});

const deadRoutes = [];
registeredIds.forEach(id => {
  // Value "value" is generic, and some might be triggered via other means, but let's check
  if (!referencedIds.has(id)) {
    deadRoutes.push(id);
  }
});

console.log("Potentially dead routes (registered but never referenced in action_id/callback_id):");
console.log(deadRoutes.join('\n'));
