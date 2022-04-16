const fs = require('fs');

if (fs.existsSync('./.wwebjs_auth/')) fs.rmdirSync('./.wwebjs_auth/', {recursive: true})
if (fs.existsSync('./test.jpeg')) fs.unlinkSync('./test.jpeg');