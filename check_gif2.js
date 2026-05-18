const https = require('https');

function checkSize(url) {
  https.request(url, { method: 'HEAD' }, (res) => {
    console.log(`URL: ${url}`);
    console.log(`Status: ${res.statusCode}`);
    console.log(`Content-Length: ${res.headers['content-length']} bytes`);
  }).end();
}

checkSize('https://media.giphy.com/media/g5R9dok94mrIvplmZd/200.gif');
checkSize('https://media.giphy.com/media/g5R9dok94mrIvplmZd/200w.gif');
checkSize('https://media.giphy.com/media/g5R9dok94mrIvplmZd/giphy-preview.gif');
