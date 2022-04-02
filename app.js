const { Client, MessageMedia, LocalAuth, List, Buttons, LegacySessionAuth } = require('whatsapp-web.js');
const express = require('express');
const { body, validationResult } = require('express-validator');
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

const port = process.env.PORT || 8000;

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

const SESSION_FILE_PATH = './session.json';
let sessionCfg;
if (fs.existsSync(SESSION_FILE_PATH)) {
  sessionCfg = require(SESSION_FILE_PATH);
}
var db_portald3pajak = mysql.createPool({
  host: "103.28.53.179",
  user: "navicat_nurizweb",
  password: "sp@8cfXKJKub3Y8",
  database: "testing"
});
var db_wa = mysql.createPool({
  host: "103.28.53.179",
  user: "navicat_nurizweb",
  password: "sp@8cfXKJKub3Y8",
  database: "testing"
});

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
app.use(express.json());
app.use(express.urlencoded({
  extended: true
}));
app.use(fileUpload({
  debug: true
}));

app.use((req, res, next) => {
  res.set('x-powered-by', 'nuriz.id');
  next();
});
app.get('/', (req, res) => {
  res.sendFile('index.html', {
    root: __dirname
  });
});
app.get('/ip', (request, response) => response.send(request.ip))
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
  authStrategy: new LegacySessionAuth({
    session: sessionCfg
  })
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
client.initialize();
client.on('ready', () => {
  let sql = "SELECT * FROM `log_message`WHERE status='pending'";
  db_wa.query(sql, function (err, result) {
    if (err) throw err;
    result.forEach(data => {
      const number = phoneNumberFormatter(data.penerima);
      client.sendMessage(number, data.pesan);
      let sql = "UPDATE `log_message` SET `status`='success' WHERE `id`='"+data.id+"'";
      db_wa.query(sql, function (err, result) {
        if (err) throw err;
        console.log("Database updated");
      });
    });
  });
})
// Socket IO
io.on('connection', function(socket) {
  socket.emit('message', 'Connecting...');

  client.on('qr', (qr) => {
    console.log('QR RECEIVED', qr);
    qrcode.toDataURL(qr, (err, url) => {
      socket.emit('qr', url);
      socket.emit('message', 'QR Code received, scan please!');
    });
  });

  client.on('ready', () => {
    socket.emit('ready', 'Whatsapp is ready!');
    socket.emit('message', 'Whatsapp is ready!');
    console.log('Whatsapp is ready!');
  });

  client.on('authenticated', async (session) => {
    socket.emit('authenticated', 'Whatsapp is authenticated!');
    socket.emit('message', 'Whatsapp is authenticated!');
    console.log('AUTHENTICATED');
    sessionCfg = session;
    fs.writeFile(SESSION_FILE_PATH, JSON.stringify(session), (err) => {
        if (err) {
            console.error(err);
        }
    });
  });

  client.on('auth_failure', function(session) {
    socket.emit('message', 'Auth failure, restarting...');
  });

  client.on('disconnected', (reason) => {
    socket.emit('message', 'Whatsapp is disconnected!');
    client.destroy();
    client.initialize();
  });
});


const checkRegisteredNumber = async function(number) {
  const isRegistered = await client.isRegisteredUser(number);
  return isRegistered;
}

// Send message
app.post('/send-message', [
  body('number').notEmpty(),
  body('message').notEmpty(),
], async (req, res) => {
  const errors = validationResult(req).formatWith(({
    msg
  }) => {
    return msg;
  });

  if (!errors.isEmpty()) {
    return res.status(422).json({
      status: false,
      message: errors.mapped()
    });
  }

  const number = phoneNumberFormatter(req.body.number);
  const message = await msgBodyChecker(req.body.message,req.body.number);

  let status_msg = "pending"
  let status_wa = await client.getState()
  console.log("STATUS",status_wa)
  if ( status_wa!=='CONNECTED') {
    res.status(200).json({
      status: status_msg,
    });
  }else{
    const isRegisteredNumber = await checkRegisteredNumber(number);

    if (!isRegisteredNumber) {
      return res.status(422).json({
        status: false,
        message: 'Nomor tidak terdaftar'
      });
    }
    status_msg="success"
    client.sendMessage(number, message).then(response => {
      res.status(200).json({
        status: status_msg,
        response: response
      });
    }).catch(err => {
      res.status(500).json({
        status: false,
        response: err
      });
    });
  }
  let sql = "INSERT INTO `log_message` (`penerima`,`pesan`,`status`,`created_at`, `updated_at`) VALUES ('"+req.body.number+"','"+message+"','"+status_msg+"',CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);";
  db_wa.query(sql, function (err, result) {
    if (err) throw err;
    console.log("1 message recorded -END-");
  });
});

// Send media
app.post('/send-media', async (req, res) => {
  const number = phoneNumberFormatter(req.body.number);
  const caption = req.body.caption;
  const fileUrl = req.body.file;

  // const media = MessageMedia.fromFilePath('./image-example.png');
  // const file = req.files.file;
  // const media = new MessageMedia(file.mimetype, file.data.toString('base64'), file.name);
  let mimetype;
  const attachment = await axios.get(fileUrl, {
    responseType: 'arraybuffer'
  }).then(response => {
    mimetype = response.headers['content-type'];
    return response.data.toString('base64');
  });

  const media = new MessageMedia(mimetype, attachment, 'Media');

  client.sendMessage(number, media, {
    caption: caption
  }).then(response => {
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
});

const findGroupByName = async function(name) {
  const group = await client.getChats().then(chats => {
    return chats.find(chat => 
      chat.isGroup && chat.name.toLowerCase() == name.toLowerCase()
    );
  });
  return group;
}

// Send message to group
// You can use chatID or group name, yea!
app.post('/send-group-message', [
  body('id').custom((value, { req }) => {
    if (!value && !req.body.name) {
      throw new Error('Invalid value, you can use `id` or `name`');
    }
    return true;
  }),
  body('message').notEmpty(),
], async (req, res) => {
  const errors = validationResult(req).formatWith(({
    msg
  }) => {
    return msg;
  });

  if (!errors.isEmpty()) {
    return res.status(422).json({
      status: false,
      message: errors.mapped()
    });
  }

  let chatId = req.body.id;
  const groupName = req.body.name;
  const message = req.body.message;

  // Find the group by name
  if (!chatId) {
    const group = await findGroupByName(groupName);
    if (!group) {
      return res.status(422).json({
        status: false,
        message: 'No group found with name: ' + groupName
      });
    }
    chatId = group.id._serialized;
  }
  
  client.sendMessage(chatId, message).then(response => {
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
});

// Clearing message on spesific chat
app.post('/clear-message', [
  body('number').notEmpty(),
], async (req, res) => {
  const errors = validationResult(req).formatWith(({
    msg
  }) => {
    return msg;
  });

  if (!errors.isEmpty()) {
    return res.status(422).json({
      status: false,
      message: errors.mapped()
    });
  }

  const number = phoneNumberFormatter(req.body.number);

  const isRegisteredNumber = await checkRegisteredNumber(number);

  if (!isRegisteredNumber) {
    return res.status(422).json({
      status: false,
      message: 'The number is not registered'
    });
  }

  const chat = await client.getChatById(number);
  
  chat.clearMessages().then(status => {
    res.status(200).json({
      status: true,
      response: status
    });
  }).catch(err => {
    res.status(500).json({
      status: false,
      response: err
    });
  })
});

server.listen(port, function() {
  console.log('App running on *: ' + port);
});
