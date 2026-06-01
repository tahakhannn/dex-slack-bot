const fs = require('fs');
const path = require('path');

const targetFileRelativePath = process.argv[2];
if (!targetFileRelativePath) {
  console.log("Usage: node find_unused_exports.js <relative-path-to-file>");
  process.exit(1);
}

const targetFile = fs.readFileSync(path.join(__dirname, targetFileRelativePath), 'utf8');
const exportMatch = targetFile.match(/module\.exports\s*=\s*\{([^}]+)\};/m);
if (!exportMatch) {
  console.log("Could not find exports block");
  process.exit(1);
}

const methods = exportMatch[1]
  .split(',')
  .map(m => m.trim().split(':')[0]) // Handle things like `foo: bar`
  .filter(m => m.length > 0 && !m.startsWith('//'));

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
    if (file.endsWith(targetFileRelativePath)) continue;
    const content = fs.readFileSync(file, 'utf8');
    // Using simple includes since JS method usages can vary.
    // This is a naive heuristic but works for our purposes.
    if (content.includes(`.${method}(`) || content.includes(`.${method} =`) || content.includes(`.${method},`) || content.includes(`.${method}\n`) || content.includes(` ${method},`) || content.includes(` ${method} `)) {
      isUsed = true;
      break;
    }
  }
  
  if (!isUsed) {
    unused.push(method);
  }
});

console.log(`Unused methods in ${targetFileRelativePath}:`);
console.log(unused.join('\n'));
