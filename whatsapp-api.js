require('dotenv').config();
const { Client, MessageMedia, LocalAuth,Buttons,List } = require('whatsapp-web.js');
const express = require('express');
const {app,server,io} = require('./socket.js')
const qrcode = require('qrcode');
const fs = require('fs');
const { phoneNumberFormatter } = require('./helpers/formatter');
const fileUpload = require('express-fileupload');
const axios = require('axios');
const cron = require('node-cron');
const fileDownload = require('js-file-download');
const https = require('https');
const AdmZip = require("adm-zip");
var FormData = require('form-data');

const mime = require('mime-types');
const mysql = require('mysql');
const { v4: uuidv4 } = require('uuid');
const rateLimit = require('express-rate-limit')
const cors = require('cors');
const jwt = require("jsonwebtoken");
const {secretKey} = require('./main.js');

const waSocket = io.of('/whatsapp');

const port = process.env.PORT || 8000;

var serverReady = false;
var fileSession = false

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

var db_d3pjk = mysql.createPool({
  host: "103.28.53.92",
  user: "dpajakco_portal",
  password: "19d3pajak",
  database: "dpajakco_portal"
});
//CLEAR SESSION FOLDER IF EXIST
if (fs.existsSync('./data_session/')) fs.rmdirSync('./data_session/', {recursive: true})
if (fs.existsSync('./data_session.zip')) fs.unlinkSync('./data_session.zip');


//CRONJOB BACKUP
const restartServer = async() =>{
  var zip = new AdmZip()
  zip.addLocalFolder('./data_session');
  zip.writeZip('./data_session.zip');
  console.log('Compression Success');
  const params = new FormData({ maxDataSize: 1009715200 });
  const file = fs.createReadStream('./data_session.zip'); //too big to upload
  params.append('session',file);
  axios({
      method: 'POST',
      url: 'https://wa.nuriz.web.id/save_session.php',
      // url: 'https://webhook.site/4247af82-6ced-4d4a-b767-47a25f30a46f?',
      data: params,
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
      headers: {
          // origin: 'api.nuriz.id',
          ...params.getHeaders()
      }
  }).then(function (response) {
      // console.log(response);
      console.log('File uploaded successfully!',response.data);
      // fs.rmSync('./data_session/session.zip',{ recursive: true, force: true });
      // fs.rmSync('./data_session/session',{ recursive: true, force: true });
      axios({
          url: 'https://api.heroku.com/apps/whatsapp-api-nuriz/dynos',
          method: 'DELETE',
          headers:{
              'Authorization': 'Bearer '+process.env.HEROKU_API_KEY,
              'Accept':'application/vnd.heroku+json; version=3`'
          }
      }).then(function (response,err) {
          if (response.status!==202){
            console.log(response.status,err);
          }else{
            console.log('Dyno restarted successfully!',response.data);
          }
      })
  })
  .catch(function (err) {
  console.log('Failed to save the file:',err);
  });
}
cron.schedule('0 17 * * *', async () => {
  serverReady = false
  console.log('running a task every 17:00, starting backup data...');
  //close all client
  closeAllSession(true);
});

//------

const queryMysql = (penerima,msgbody) =>{
  return new Promise((resolve, reject)=>{
      let uuid = uuidv4();
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

const invalidAPIrequest = (req, res) => {
  res.status(404).send(JSON.stringify({
    status: 'error',
    message: 'Invalid Whatsapp API'
  }))
}

const sessions = [];
const getAllSession = ()=>{
  let sql = 'SELECT * FROM session';
  return new Promise((resolve, reject)=>{
    db_wa.query(sql, async function (err, result) {
      if (err) throw err;
      let hasil = []
      result.forEach(data => {
        hasil.push({
          id: data.id,
          description: data.description,
          ready: data.ready,
          number: data.number,
        })
      });
      return resolve(hasil)
    })
  })
}
const saveSession = async(id, description,session)=>{
  let sql = 'INSERT INTO `session` (`id`, `description`, session) VALUES ("'+id+'", "'+description+'", '+session+');';
  return db_wa.query(sql, function (err, result) {
    if (err) throw err;
    return result
  })
}
const updateSession = async(id,ready,number,session)=>{
  let sql = 'UPDATE `session` SET `ready` = "'+ready+'"';
  if (session!==undefined) sql += ', session = '+session+'';
  if (number!==undefined) sql += ', number = "'+number+'"';
  sql += ' WHERE `id` = "'+id+'";';
  return db_wa.query(sql, function (err, result) {
    if (err) throw err;
    return result
  })
}
const removeSession = async(id) =>{
  let sql = 'DELETE FROM `session` WHERE `id` = "'+id+'";';
  return db_wa.query(sql, function (err, result) {
    if (err) throw err;
    return result
  })
}
const closeAllSession = async(restart=false) =>{
  let sql = 'SELECT * FROM session';
  const hasil = await new Promise((resolve, reject)=>{
    db_wa.query(sql, async function (err, result) {
      if (err) throw err;
      return resolve(result)
    })
  })
  console.log('closing all session')
  let check = []
  await hasil.forEach(async (data) => {
    const indexClient = sessions.find(sess => sess.id == data.id)
    console.log('Closing id:',data.id)
    const client = indexClient.client
    client.destroy().then(()=>{
      check.push(data.id)
      if (check.length == hasil.length){
        console.log('All session closed')
        if (restart) restartServer()
      }
    })
  });
}

// const SESSIONS_FILE = './whatsapp-sessions.json';

// const createSessionsFileIfNotExists = function() {
//   if (!fs.existsSync(SESSIONS_FILE)) {
//     try {
//       fs.writeFileSync(SESSIONS_FILE, JSON.stringify([]));
//       console.log('Sessions file created successfully.');
//     } catch(err) {
//       console.log('Failed to create sessions file: ', err);
//     }
//   }
// }

// createSessionsFileIfNotExists();

// const setSessionsFile = function(sessions) {
//   fs.writeFile(SESSIONS_FILE, JSON.stringify(sessions), function(err) {
//     if (err) {
//       console.log(err);
//     }
//   });
// }

// const getSessionsFile = function() {
//   return JSON.parse(fs.readFileSync(SESSIONS_FILE));
// }
let client = []
const createSession = function(id, description,session) {
  console.log('Creating session: ' + id);
  client = new Client({
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
      clientId: id,
      dataPath: './data_session',
    })
  });

  client.initialize();

  client.on('qr',(qr) => {
    console.log('QR RECEIVED FOR ID:',id, qr);
    qrcode.toDataURL(qr, (err, url) => {
      waSocket.emit('qr', { id: id, src: url });
      waSocket.emit('message', { id: id, text: 'QR Code received, scan please!' });
    });
  });

  client.on('ready', () => {
    waSocket.emit('ready', { id: id });
    waSocket.emit('message', { id: id, text: 'Whatsapp is ready!' });
    waSocket.emit('number', { id: id, number: client.info.wid.user });
    
    console.log(`Client ${id} is ready!`);
    updateSession(id,true,client.info.wid.user)

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
    console.log(`Client ${id} is authenticated!`);
    waSocket.emit('authenticated', { id: id });
    waSocket.emit('message', { id: id, text: 'Whatsapp is authenticated!' });
  });

  client.on('auth_failure', function() {
    waSocket.emit('message', { id: id, text: 'Auth failure, restarting...' });
  });

  client.on('disconnected', (reason) => {
    waSocket.emit('message', { id: id, text: 'Whatsapp is disconnected!' });
    client.destroy();
    // client.initialize();

    // Menghapus pada file sessions
    removeSession(id)
    waSocket.emit('remove-session', id);
  });
  client.on('change_state',async state=>{
    console.log(id," State :",state);
  })

  client.on('message', async msg => {
    // console.log('--NEW MESSAGE--');
    // console.log(msg);
    const messageType  = ['chat', 'image', 'video', 'ptt', 'audio', 'document', 'location', 'vcard', 'multi_vcard', 'sticker'];
    console.log(msg.type, msg.body)
    if (messageType.indexOf(msg.type)<0) return
    const chat = await msg.getChat();
    if (chat.isGroup){
      handleGroupChat(msg)
    }else{
      switch (msg.body) {
        case '!ping':
          msg.reply('pong');
          break;
        case 'good morning':
          msg.reply('Selamat Pagi');
          break;
        case'/groups':
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
        case '/buttons':
          let button = new Buttons('Button body',[{body:'bt1'},{body:'bt2'},{body:'bt3'}],'title','footer');
          client.sendMessage(msg.from, button);
          break;
        case '/list':
          let sections = [{title:'sectionTitle',rows:[{title:'ListItem1', description: 'desc'},{title:'ListItem2'}]}];
          let list = new List('List body','btnText',sections,'Title','footer');
          client.sendMessage(msg.from, list);
          break;
        case '/cekd3pajak19':
          msg.reply('Memproses permintaan ...');
          let sql = "SELECT * FROM `mahasiswa` WHERE NOT ISNULL(whatsapp)";
          db_d3pjk.query(sql, async function (err, result) {
            if (err) throw err;
            let verified = 0
            let unverified = 0
            let listUnverified = ""
            for (let data of result){
              const mls = 100+Math.floor(Math.random()*1500)+1
              const number = phoneNumberFormatter("0"+data.whatsapp);
              const isRegisteredNumber = await client.isRegisteredUser(number);
              if (!isRegisteredNumber){
                unverified = unverified+1;
                listUnverified=listUnverified+"\n"+data.npm+" - 0"+data.whatsapp;
                console.log("GAGAL "+data.npm+" 0"+data.whatsapp);
              }else {
                console.log("SUKSES "+data.npm+" 0"+data.whatsapp);
                verified++;
              }
              await sleep(mls)
            }
            let replyMsg = "*HASIL VERIFIKASI*\n\nTerverifikasi: "+verified+"\nGagal: "+unverified+"\n\n"+
            "*Daftar nomor yang gagal verifikasi*"+listUnverified;
            console.log("- Sukses "+verified+" | Gagal "+unverified+" -");
            client.sendMessage(msg.from, replyMsg);
          });
          break;
        case '/backup':
          closeAllSession(true);
          break;
        default:
          // console.log(msg.type)
          // msg.reply('*AUTO REPLY*\r\nWhatsapp ini tidak dapat menerima pesan')
          break;
      }
    
    
      // Downloading media
      if (msg.hasMedia) {
        msg.downloadMedia().then(media => {
          // To better understanding
          // Please look at the console what data we get
          // console.log(media);
    
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
  
            console.log(media.mimetype)
            // Save to file
            const params = new URLSearchParams();
            params.append('filename',filename)
            params.append('filetype',media.mimetype)
            params.append('file',media.data)
            params.append('jenis','ktta')
            axios.post('https://cors.nuriz.web.id/https://script.google.com/macros/s/AKfycbzTVkl5eJluO1j6yRk-8ZA9Aic3nm4pIpT7pzO9YgvemlWe8GnPNYY5GNjkDEh7KpDVeg/exec?action=upload_file', params,{
              headers: {
                origin: 'whatsapp.heroku.com'
              }
            })
            .then(function (response) {
              // console.log(response);
              console.log('File downloaded successfully!', fullFilename);
              msg.reply('File downloaded successfully!');
            })
            .catch(function (err) {
              console.log('Failed to save the file:', err);
              msg.reply('Failed to save the file:', err);
            });
            // try {
            //   fs.writeFileSync(fullFilename, media.data, { encoding: 'base64' }); 
            //   console.log('File downloaded successfully!', fullFilename);
            //   msg.reply('File downloaded successfully!');
            // } catch (err) {
            //   console.log('Failed to save the file:', err);
            //   msg.reply('Failed to save the file:', err);
            // }
          }
        });
      }
    }
  });
  client.on('group_join', async msg => {
    const chat = await msg.getChat();
    msg.reply('Halo, Bot ini dapat membantu kamu dalam mengelola group.\r\n\r\nSenang bergabung dengan * ' + chat.name+"*");

  });
  client.on('group_update',async msg => {
    msg.reply(JSON.stringify(msg));
  })

const handleGroupChat = async (msg) => {
  const chat = await msg.getChat();
  const mentions = await msg.getMentions();
  let terpanggil = false;
  for(let contact of mentions) {
      terpanggil = contact.isMe;
      if (terpanggil) break;
  }
  if (terpanggil){
    let pesan = msg.body.replace(/@/g,"/");
    let pesanSplit = pesan.split("/");
    for(let psn of pesanSplit){
      if (psn.length > 0 && psn.slice(0,2)!=='62'){
        pesan = psn.trim()
        break;
      }
    }
    switch(pesan){
      case 'help':
        const panduan = '*LIST COMMAND AUTOREPLY*\r\n\r\n' +
        '```panggil```  -> Tag semua participant\r\n'+
        '```help```  -> Bantuan list _command_';
        msg.reply(panduan);
        break;
      case 'panggil':
        let text = "";
        let mentions = [];
  
        for(let participant of chat.participants) {
            const contact = await client.getContactById(participant.id._serialized);
            
            mentions.push(contact);
            text += `@${participant.id.user} `;
        }
  
        await chat.sendMessage(text, { mentions });
        break;
      default:
        
        break;
    }
  }
    
  }
  // Tambahkan client ke sessions
  sessions.push({
    id: id,
    description: description,
    client: client
  });
}

const init = async function(socket) {
  console.log('INIT')
  const savedSessions = await getAllSession();
  if (savedSessions.length > 0) {
    if (socket) {
      // console.log(savedSessions); //pastikan session yg ditampilin sesuai sm data
      socket.emit('init', savedSessions);
      //??
    } else {
      let sql = 'UPDATE `session` SET `ready` = "false" WHERE ready="true"';
      db_wa.query(sql, function (err, result) {})
      savedSessions.forEach(sess => {
        createSession(sess.id, sess.description,sess.session);
      });
      serverReady = true
    }
  }
}
//DOWNLOAD SESSION
console.log("Downloading session...");
const request = https.get("https://wa.nuriz.web.id/data_session.zip", function(response) {
    if (response.statusCode === 200) {
        const file = fs.createWriteStream("data-session.zip");
        response.pipe(file);
        // after download completed close filestream
        file.on("finish", () => {
            file.close();
            console.log("Download Completed");
            var sessionZip = new AdmZip("./data-session.zip");
            const dir = './data_session/'
            if (!fs.existsSync(dir)){
                fs.mkdirSync(dir, { recursive: true });
            }
            console.log('extracting file')
            sessionZip.extractAllTo(/*target path*/ dir, /*overwrite*/ true);
            fs.unlinkSync('./data-session.zip');
            console.log('starting...');
            fileSession = true
            init();
        });
    }
    else{
        console.log("Error Downloading File Session, opening new session");
        fileSession=true
        init();
    }
}).on('error', function(err) {
    console.log("Error: " + err.message);
});
// Socket IO
waSocket.on('connection', function(socket) {
  console.log('socket connected');
  if (fileSession) init(socket);
  else{
    const checkSessionFile = setInterval(() => {
      if (fileSession){
        clearInterval(checkSessionFile);
        init(socket);
      }
    },500);
  }
  socket.on('create-session', async function(data) {
    console.log('Create session: ' + data.id);
    await saveSession(data.id, data.description, null);
    createSession(data.id, data.description,'');
  });
  socket.on('remove-session',function(data){
    console.log('Request remove session: ' + data.id);
    const indexClient = sessions.find(sess => sess.id == data.id)
    const client = indexClient.client
    // Menghapus pada file sessions
    removeSession(data.id);
    client.destroy().then(async()=>{
      await sleep(500)
      fs.rmdirSync('./data_session/session-'+data.id, { recursive: true, force:true });
      await sleep(500)
      fs.rmdir('./data_session/session-'+data.id, {recursive: true,force: true}, (err) => {

        if (err) {
          return console.log("error occurred in deleting directory", err);
        }
        
        console.log("Session deleted successfully");
        waSocket.emit('remove-session', data.id);
      })
    });
  })
});
function whatsappGEThandler(req,res){
  switch(req.params[1]){
    case 'cek-nomor':
      cekNomor(req,res);
      break;
    default:
      invalidAPIrequest()
  }

  async function cekNomor(req,res){
    if (!req.body.nomor){
      return res.status(403).json({
        status: 'failed',
        message: 'Nomor tidak boleh kosong',
      });
    }
    const sender = Math.floor(Math.random() * sessions.length);
    const client = sessions[sender].client;
    const number = phoneNumberFormatter(req.query.nomor);
    let status_wa = await client.getState()
    console.log("Cek nomor "+req.query.nomor+" lewat "+sessions[sender].number+" ("+sessions[sender].id+")")
    if ( status_wa!=='CONNECTED') {
      return res.status(406).json({
        status: 'failed',
        message: 'Whatsapp not connected',
      });
    }
    const isRegisteredNumber = await client.isRegisteredUser(number);
    if (isRegisteredNumber){
      return res.json({
        status: true,
        message: 'nomor terdaftar'
      })
    }
    if (!isRegisteredNumber) {
      return res.status(422).json({
        status: false,
        message: 'nomor tidak terdaftar'
      });
    }
  }
}
function whatsappPOSThandler(req,res){
  switch(req.params[1]){
    case 'send-message':
      postSendMessage(req,res);
      break;
    default:
      invalidAPIrequest()
  }
  // Send message
  async function postSendMessage(req, res){
    // console.log(req);
    if (!req.body.number || !req.body.message) {
      res.status(400).sen({
        message: 'Bad Request',
      })
    }

    const sender = Math.floor(Math.random() * sessions.length);
    const number = phoneNumberFormatter(req.body.number);
    let message = req.body.message;
    if (jwt.decode(req.headers['authorization'].split(' ')[1], secretKey).name == 'Portal D3Pajak19'){
      message = await queryMysql(req.body.number,req.body.message)
    }
    // console.log(sessions)
    
    /**
     * Check if the number is already registered
     * Copied from app.js
     * 
     * Please check app.js for more validations example
     * You can add the same here!
     */
    let status_msg = "pending"
    let sender_number = 0;
    if (sessions.length > 0) {
      if (!serverReady){
        return res.status(406).json({
          status: 'failed',
          message: 'Server is under maintenance',
        });
      }else{
        const client = sessions[sender].client;
      sender_number = sessions[sender].number;
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
      }
      
    }else{
      console.log('Whatsapp API Alert : No Sessions')
      res.status(200).json({
        status: 'no session',
      });
    }
    let sql = "INSERT INTO `log_message` (`pengirim`, `penerima`,`pesan`,`status`,`created_at`, `updated_at`) VALUES ('"+sender_number+"','"+req.body.number+"','"+message+"','"+status_msg+"',CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);";
    db_wa.query(sql, function (err, result) {
      if (err) throw err;
      console.log("1 message recorded -END-");
    });
  };
}

async function sleep(millis) {
  return new Promise(resolve => setTimeout(resolve, millis));
}
module.exports = {
  whatsappPOSThandler,
  whatsappGEThandler
}
