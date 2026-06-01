const fs = require('fs');
const path = require('path');

const dbFile = fs.readFileSync(path.join(__dirname, 'helpers/db.js'), 'utf8');
const exportMatch = dbFile.match(/return \{([^}]+)\};\n\}/);
if (!exportMatch) {
  console.log("Could not find exports block");
  process.exit(1);
}

const methods = exportMatch[1]
  .split(',')
  .map(m => m.trim())
  .filter(m => m.length > 0 && m !== 'detectColumns' && m !== 'supportsColumn');

const dirsToSearch = ['handlers', 'cron', 'helpers', 'app.js'];

const getAllFiles = (dirPath, arrayOfFiles) => {
  const files = fs.readdirSync(dirPath);
  arrayOfFiles = arrayOfFiles || [];
  files.forEach(file => {
    if (fs.statSync(dirPath + "/" + file).isDirectory()) {
      arrayOfFiles = getAllFiles(dirPath + "/" + file, arrayOfFiles);
    } else {
      if (file.endsWith('.js')) {
        arrayOfFiles.push(path.join(dirPath, "/", file));
      }
    }
  });
  return arrayOfFiles;
};

const allFiles = [];
dirsToSearch.forEach(dir => {
  const fullPath = path.join(__dirname, dir);
  if (fs.existsSync(fullPath)) {
    if (fs.statSync(fullPath).isDirectory()) {
      getAllFiles(fullPath, allFiles);
    } else {
      allFiles.push(fullPath);
    }
  }
});

const unused = [];

methods.forEach(method => {
  let isUsed = false;
  
  for (const file of allFiles) {
    if (file.endsWith('db.js')) continue;
    const content = fs.readFileSync(file, 'utf8');
    if (content.includes(`db.${method}(`) || content.includes(`db.${method} =`) || content.includes(`db.${method},`) || content.includes(`db.${method}\n`)) {
      isUsed = true;
      break;
    }
  }
  
  if (!isUsed) {
    unused.push(method);
  }
});

console.log("Unused DB methods:");
console.log(unused.join('\n'));
