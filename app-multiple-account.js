const { Client, MessageMedia, LocalAuth,Buttons,List } = require('whatsapp-web.js');
const express = require('express');
const socketIO = require('socket.io');
const qrcode = require('qrcode');
const http = require('http');
const fs = require('fs');
const { phoneNumberFormatter } = require('./helpers/formatter');
const fileUpload = require('express-fileupload');
const axios = require('axios');

const mime = require('mime-types');
const mysql = require('mysql');
const { v4: uuidv4 } = require('uuid');
const rateLimit = require('express-rate-limit')
const jwt = require("jsonwebtoken");
const secretKey = '019jd99jsi91jedi0djjwi000jdos00290iujk';

const port = process.env.PORT || 8000;

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

//Initializing db connection
var db_portald3pajak = mysql.createPool({
  host: "103.28.53.179",
  user: "nurizweb_navicat",
  password: "sp@8cfXKJKub3Y8",
  database: "nurizweb_whatsappapi"
});
var db_wa = mysql.createPool({
  host: "103.28.53.179",
  user: "nurizweb_navicat",
  password: "sp@8cfXKJKub3Y8",
  database: "nurizweb_whatsappapi"
});
//------
// Handling message modification
const msgBodyChecker = async (msgbody,penerima) => {
  console.log(msgbody);
  // Fired on all message creations, including your own
  if (msgbody.startsWith("*-PORTAL D3pajak19-*")){
    let uuid = uuidv4();
    try{
      msgbody = await queryMysql(uuid,penerima,msgbody);
    } catch(error){
      console.log(error)
    }
    return msgbody
  }
};
const queryMysql = (uuid,penerima,msgbody) =>{
  return new Promise((resolve, reject)=>{
      let sql = "INSERT INTO `notifikasi` (`id`, `penerima`,`pesan`,`created_at`, `updated_at`) VALUES ('"+uuid+"','"+penerima+"','"+msgbody+"',CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);";
      db_portald3pajak.query(sql, function (err, result) {
          if (err) return reject(err);
          console.log("Database created");
      });
      msgbody += "\n\n----------\nKlik link berikut untuk cek keaslian pesan ini\nhttps://portal.d3pajak19.com/ceknotif/"+uuid;
      return resolve(msgbody);
      
  });
};
//----------

app.use(express.json());
app.use(express.urlencoded({
  extended: true
}));

/**
 * BASED ON MANY QUESTIONS
 * Actually ready mentioned on the tutorials
 * 
 * The two middlewares above only handle for data json & urlencode (x-www-form-urlencoded)
 * So, we need to add extra middleware to handle form-data
 * Here we can use express-fileupload
 */
app.use(fileUpload({
  debug: false
}));

app.use(async(req, res, next) => {
  res.set('x-powered-by', 'nuriz.id');
  if ( req.path == '/') return next();
  if(!req.headers['authorization']){
    res.status(401).send(JSON.stringify({
      status: 'error',
      message: 'Missing authorization on request'
    }))
    return;
  }else{
    const token = req.headers['authorization'].split(' ')[1];
    console.log(jwt)
    let decoded = null
    try{
     decoded = jwt.verify(token, secretKey);
    }catch(err){
      res.status(401).send(JSON.stringify({
        status: 'error',
        message: 'Invalid authorization on request'
      }))
      return;
    }
    console.log(decoded)
  }
  next();
});
//testing number of proxy
app.set('trust proxy', 1) //ubah angka sampai result di /ip sesuai dengan ip sebenarnya
app.get('/ip', (request, response) => response.send(request.ip))

app.get('/', (req, res) => {
  res.sendFile('index-multiple-account.html', {
    root: __dirname
  });
});

const sessions = [];
const SESSIONS_FILE = './whatsapp-sessions.json';

const createSessionsFileIfNotExists = function() {
  if (!fs.existsSync(SESSIONS_FILE)) {
    try {
      fs.writeFileSync(SESSIONS_FILE, JSON.stringify([]));
      console.log('Sessions file created successfully.');
    } catch(err) {
      console.log('Failed to create sessions file: ', err);
    }
  }
}

createSessionsFileIfNotExists();

const setSessionsFile = function(sessions) {
  fs.writeFile(SESSIONS_FILE, JSON.stringify(sessions), function(err) {
    if (err) {
      console.log(err);
    }
  });
}

const getSessionsFile = function() {
  return JSON.parse(fs.readFileSync(SESSIONS_FILE));
}

const createSession = function(id, description) {
  console.log('Creating session: ' + id);
  const client = new Client({
    restartOnAuthFail: true,
    puppeteer: {
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--single-process', // <- this one doesn't works in Windows
        '--disable-gpu'
      ],
    },
    authStrategy: new LocalAuth({
      clientId: id
    })
  });

  client.initialize();

  client.on('qr', (qr) => {
    console.log('QR RECEIVED FOR ID:',id, qr);
    qrcode.toDataURL(qr, (err, url) => {
      io.emit('qr', { id: id, src: url });
      io.emit('message', { id: id, text: 'QR Code received, scan please!' });
    });
  });

  client.on('ready', () => {
    io.emit('ready', { id: id });
    io.emit('message', { id: id, text: 'Whatsapp is ready!' });
    io.emit('number', { id: id, number: client.info.wid.user });
    
    console.log(`Client ${id} is ready!`);
    const savedSessions = getSessionsFile();
    const sessionIndex = savedSessions.findIndex(sess => sess.id == id);
    savedSessions[sessionIndex].ready = true;
    savedSessions[sessionIndex].number = client.info.wid.user;
    setSessionsFile(savedSessions);
    // Checking pending message in db
    let sql = "SELECT * FROM `log_message`WHERE status='pending'";
    db_wa.query(sql, function (err, result) {
      if (err) throw err;
      result.forEach(data => {
        const number = phoneNumberFormatter(data.penerima);
        client.sendMessage(number, data.pesan);
        let sql = "UPDATE `log_message` SET `status`='success' WHERE `id`='"+data.id+"'";
        db_wa.query(sql, function (err, result) {
          if (err) throw err;
          console.log("Log message updated on id="+data.id);
        });
      });
    });
  });

  client.on('authenticated', () => {
    io.emit('authenticated', { id: id });
    io.emit('message', { id: id, text: 'Whatsapp is authenticated!' });
  });

  client.on('auth_failure', function() {
    io.emit('message', { id: id, text: 'Auth failure, restarting...' });
  });

  client.on('disconnected', (reason) => {
    io.emit('message', { id: id, text: 'Whatsapp is disconnected!' });
    client.destroy();
    client.initialize();

    // Menghapus pada file sessions
    const savedSessions = getSessionsFile();
    const sessionIndex = savedSessions.findIndex(sess => sess.id == id);
    savedSessions.splice(sessionIndex, 1);
    setSessionsFile(savedSessions);

    io.emit('remove-session', id);
  });

  client.on('message', msg => {
    // console.log('--NEW MESSAGE--');
    // console.log(msg);
    switch (msg.body) {
      case '!ping':
        msg.reply('pong');
        break;
      case 'good morning':
        msg.reply('Selamat Pagi');
        break;
      case'!groups':
        client.getChats().then(chats => {
          const groups = chats.filter(chat => chat.isGroup);
    
          if (groups.length == 0) {
            msg.reply('You have no group yet.');
          } else {
            let replyMsg = '*YOUR GROUPS*\n\n';
            groups.forEach((group, i) => {
              replyMsg += `ID: ${group.id._serialized}\nName: ${group.name}\n\n`;
            });
            replyMsg += '_You can use the group id to send a message to the group._'
            msg.reply(replyMsg);
          }
        });
        break;
      case '!buttons':
        let button = new Buttons('Button body',[{body:'bt1'},{body:'bt2'},{body:'bt3'}],'title','footer');
        client.sendMessage(msg.from, button);
        break;
      case '!list':
        let sections = [{title:'sectionTitle',rows:[{title:'ListItem1', description: 'desc'},{title:'ListItem2'}]}];
        let list = new List('List body','btnText',sections,'Title','footer');
        client.sendMessage(msg.from, list);
        break;
      default:
        msg.reply('*AUTO REPLY*\r\nWhatsapp ini tidak dapat menerima pesan')
        break;
    }
  
  
    // Downloading media
    if (msg.hasMedia) {
      msg.downloadMedia().then(media => {
        // To better understanding
        // Please look at the console what data we get
        console.log(media);
  
        if (media) {
          // The folder to store: change as you want!
          // Create if not exists
          const mediaPath = './downloaded-media/';
  
          if (!fs.existsSync(mediaPath)) {
            fs.mkdirSync(mediaPath);
          }
  
          // Get the file extension by mime-type
          const extension = mime.extension(media.mimetype);
          
          // Filename: change as you want! 
          // I will use the time for this example
          // Why not use media.filename? Because the value is not certain exists
          const filename = new Date().getTime();
  
          const fullFilename = mediaPath + filename + '.' + extension;
  
          // Save to file
          try {
            fs.writeFileSync(fullFilename, media.data, { encoding: 'base64' }); 
            console.log('File downloaded successfully!', fullFilename);
            msg.reply('File downloaded successfully!');
          } catch (err) {
            console.log('Failed to save the file:', err);
            msg.reply('Failed to save the file:', err);
          }
        }
      });
    }
  });
  // Tambahkan client ke sessions
  sessions.push({
    id: id,
    description: description,
    client: client
  });

  // Menambahkan session ke file
  const savedSessions = getSessionsFile();
  const sessionIndex = savedSessions.findIndex(sess => sess.id == id);

  if (sessionIndex == -1) {
    savedSessions.push({
      id: id,
      description: description,
      ready: false,
    });
    setSessionsFile(savedSessions);
  }
}

const init = function(socket) {
  const savedSessions = getSessionsFile();
  if (savedSessions.length > 0) {
    if (socket) {
        savedSessions.forEach(sess => {
          sess.ready = false;
        })
        console.log(savedSessions);
        setSessionsFile(savedSessions);
      socket.emit('init', savedSessions);
    } else {
      savedSessions.forEach(sess => {
        createSession(sess.id, sess.description);
      });
    }
  }
}

init();

// Socket IO
io.on('connection', function(socket) {
  init(socket);
  console.log(sessions)
  socket.on('create-session', function(data) {
    console.log('Create session: ' + data.id);
    createSession(data.id, data.description);
  });
  socket.on('remove-session',function(data){
    console.log('Request remove session: ' + data.id);
    const indexClient = sessions.find(sess => sess.id == data.id)
    const client = indexClient.client
    client.destroy();
    client.initialize();

    // Menghapus pada file sessions
    const savedSessions = getSessionsFile();
    const sessionIndex = savedSessions.findIndex(sess => sess.id == data.id);
    savedSessions.splice(sessionIndex, 1);
    setSessionsFile(savedSessions);

    io.emit('remove-session', data.id);
  })
});

// Send message
app.post('/send-message', async (req, res) => {
  // console.log(req);

  const sender = req.body.sender;
  const number = phoneNumberFormatter(req.body.number);
  const message = await msgBodyChecker(req.body.message);
  // console.log(sessions)
  const indexClient = sessions.find(sess => sess.id == sender)
  const client = indexClient.client;

  // Make sure the sender is exists & ready
  if (!indexClient) {
    return res.status(422).json({
      status: false,
      message: `The sender: ${sender} is not found!`
    })
  }

  /**
   * Check if the number is already registered
   * Copied from app.js
   * 
   * Please check app.js for more validations example
   * You can add the same here!
   */
   let status_msg = "pending"
   let status_wa = await client.getState()
   console.log("STATUS",status_wa)
   if ( status_wa!=='CONNECTED') {
     res.status(200).json({
       status: status_msg,
     });
   }else{
    const isRegisteredNumber = await client.isRegisteredUser(number);

    if (!isRegisteredNumber) {
      return res.status(422).json({
        status: false,
        message: 'The number is not registered'
      });
    }
    status_msg="success"
    client.sendMessage(number, message).then(response => {
      res.status(200).json({
        status: true,
        response: response
      });
    }).catch(err => {
      res.status(500).json({
        status: false,
        response: err
      });
    });
  }
  let sql = "INSERT INTO `log_message` (`pengirim`, `penerima`,`pesan`,`status`,`created_at`, `updated_at`) VALUES ('"+indexClient.number+"','"+req.body.number+"','"+message+"','"+status_msg+"',CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);";
  db_wa.query(sql, function (err, result) {
    if (err) throw err;
    console.log("1 message recorded -END-");
  });
});

server.listen(port, function() {
  console.log('App running on *: ' + port);
});