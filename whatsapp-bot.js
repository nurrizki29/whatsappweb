require("dotenv").config();
const {
  Client,
  MessageMedia,
  LocalAuth,
  Buttons,
  List,
} = require("whatsapp-web.js");
const express = require("express");
const { app, server, io } = require("./socket.js");
const qrcode = require("qrcode");
const fs = require("fs");
const { phoneNumberFormatter } = require("./helpers/formatter");
const path = require("path");
const axios = require("axios");
const cron = require("node-cron");
const https = require("https");
const AdmZip = require("adm-zip");
var FormData = require("form-data");

const mime = require("mime-types");
const mysql = require("mysql");
const { v4: uuidv4 } = require("uuid");
const jwt = require("jsonwebtoken");
const { secretKey } = require("./main.js");
const { gdrive, cariSessionFile } = require("./gdrive_api.js");
const waSocket = io.of("/whatsapp-bot");
const port = process.env.PORT || 8000;

//GOOGLE APIS

var botReady = false;
var fileSession = false;

//Initializing db connection
var db_portald3pajak = mysql.createPool({
  host: "103.28.53.179",
  user: "nurizweb_navicat",
  password: "sp@8cfXKJKub3Y8",
  database: "nurizweb_whatsappapi",
});
var db_wa = mysql.createPool({
  host: "103.28.53.179",
  user: "nurizweb_navicat",
  password: "sp@8cfXKJKub3Y8",
  database: "nurizweb_whatsappapi",
});

var db_d3pjk = mysql.createPool({
  host: "103.28.53.92",
  user: "dpajakco_portal",
  password: "19d3pajak",
  database: "dpajakco_portal",
});
//CLEAR SESSION FOLDER IF EXIST
if (fs.existsSync("./data_session/"))
  fs.rmdirSync("./data_session/", { recursive: true });
if (fs.existsSync("./data_session.zip")) fs.unlinkSync("./data_session.zip");

//CRONJOB BACKUP
const restartServer = async () => {
  var zip = new AdmZip();
  zip.addLocalFolder("./data_session");
  zip.writeZip("./data_session.zip");
  console.log("Compression Success");
  const sessionZipPath = path.resolve(__dirname, "./data_session.zip");
  let fileId = await cariSessionFile();
  if (fileId) {
    const deleteFile = await gdrive.files.delete({ fileId });
    if ((deleteFile.data = "")) {
      console.log("Old backup session deleted");
    }
  }
  console.log("Uploading backup file to google gdrive");
  await gdrive.files
    .create({
      requestBody: {
        name: "data_session.zip",
        mimeType: mime.lookup(sessionZipPath),
        parents: ["1zl3xCmn2SxVvTHeP9IZpHX7QYeHcBy1Z"],
      },
      media: {
        mimeType: mime.lookup(sessionZipPath),
        body: fs.createReadStream(sessionZipPath),
      },
    })
    .then((res) => {
      fileId = res.data.id;
      console.log("Backup session uploaded with id:", fileId);
    })
    .catch((err) => {
      console.error("Whatsapp API Error : ", err);
    });
  axios({
    url: "https://api.heroku.com/apps/whatsapp-api-nuriz/dynos",
    method: "DELETE",
    headers: {
      Authorization: "Bearer " + process.env.HEROKU_API_KEY,
      Accept: "application/vnd.heroku+json; version=3`",
    },
  }).then(function (response, err) {
    if (response.status !== 202) {
      console.log(response.status, err);
    } else {
      console.log("Dyno restarted successfully!", response.data);
    }
  });
};

//------

//----------

const sessions = [];
const getAllSession = () => {
  let sql = "SELECT * FROM session";
  return new Promise((resolve, reject) => {
    db_wa.query(sql, async function (err, result) {
      if (err) throw err;
      let hasil = [];
      result.forEach((data) => {
        hasil.push({
          id: data.id,
          description: data.description,
          ready: data.ready,
          number: data.number,
        });
      });
      return resolve(hasil);
    });
  });
};

const removeSession = async (id) => {
  let sql = 'DELETE FROM `session` WHERE `id` = "' + id + '";';
  return db_wa.query(sql, function (err, result) {
    if (err) throw err;
    return result;
  });
};
const closeAllSession = async (restart = false) => {
  let sql = "SELECT * FROM session";
  const hasil = await new Promise((resolve, reject) => {
    db_wa.query(sql, async function (err, result) {
      if (err) throw err;
      return resolve(result);
    });
  });
  console.log("closing all session");
  let check = [];
  await hasil.forEach(async (data) => {
    const indexClient = sessions.find((sess) => sess.id == data.id);
    console.log("Closing id:", data.id);
    const client = indexClient.client;
    client.destroy().then(() => {
      check.push(data.id);
      if (check.length == hasil.length) {
        console.log("All session closed");
        if (restart) restartServer();
      }
    });
  });
};

const createSession = function (id, description) {
  console.log("Creating session: " + id);
  const client = new Client({
    restartOnAuthFail: true,
    puppeteer: {
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-accelerated-2d-canvas",
        "--no-first-run",
        "--no-zygote",
        "--single-process", // <- this one doesn't works in Windows
        "--disable-gpu",
      ],
    },
    authStrategy: new LocalAuth({
      clientId: id,
      dataPath: "./data_session",
    }),
  });

  client.initialize();

  client.on("qr", (qr) => {
    console.log("QR RECEIVED FOR ID:", id, qr);
    qrcode.toDataURL(qr, (err, url) => {
      waSocket.emit("qr", { id: id, src: url });
      waSocket.emit("message", {
        id: id,
        text: "QR Code received, scan please!",
      });
    });
  });

  client.on("ready", () => {
    let retryMax = 5;
    const afterReady = () => {
      try {
        console.log(client.info);
        waSocket.emit("ready", { id: id });
        waSocket.emit("message", { id: id, text: "Whatsapp is ready!" });
        waSocket.emit("number", { id: id, number: client.info.wid.user });

        console.log(`Client ${id} is ready!`);
        updateSession(id, true, client.info.wid.user);

        // Checking pending message in db
        let sql = "SELECT * FROM `log_message`WHERE status='pending'";
        db_wa.query(sql, function (err, result) {
          if (err) throw err;
          result.forEach((data) => {
            const number = phoneNumberFormatter(data.penerima);
            client.sendMessage(number, data.pesan);
            let sql =
              "UPDATE `log_message` SET `status`='success' WHERE `id`='" +
              data.id +
              "'";
            db_wa.query(sql, function (err, result) {
              if (err) throw err;
              console.log("Log message updated on id=" + data.id);
            });
          });
        });
      } catch (error) {
        console.log(error);
        if (retryMax > 0) {
          console.log(
            "Max retries reached, please delete and reconnect client manually"
          );
          return;
        }
        console.log("Retry in 5 seconds...");
        setTimeout(() => {
          afterReady();
        }, 5000);
      }
    };
    afterReady();
  });

  client.on("authenticated", () => {
    console.log(`Client ${id} is authenticated!`);
    waSocket.emit("authenticated", { id: id });
    waSocket.emit("message", { id: id, text: "Whatsapp is authenticated!" });
  });

  client.on("auth_failure", function () {
    waSocket.emit("message", { id: id, text: "Auth failure, restarting..." });
  });

  client.on("disconnected", (reason) => {
    waSocket.emit("message", { id: id, text: "Whatsapp is disconnected!" });
    client.destroy();
    // client.initialize();

    // Menghapus pada file sessions
    removeSession(id);
    waSocket.emit("remove-session", id);
  });
  client.on("change_state", async (state) => {
    console.log(id, " State :", state);
  });

  client.on("message", async (msg) => {
    // console.log('--NEW MESSAGE--');
    // console.log(msg);
    const messageType = [
      "chat",
      "image",
      "video",
      "ptt",
      "audio",
      "document",
      "location",
      "vcard",
      "multi_vcard",
      "sticker",
    ];
    console.log(msg.type, msg.body);
    if (messageType.indexOf(msg.type) < 0) return;
    const chat = await msg.getChat();
    if (chat.isGroup) {
      handleGroupChat(msg);
    } else {
      switch (msg.body) {
        case "!ping":
          msg.reply("pong");
          break;
        case "good morning":
          msg.reply("Selamat Pagi");
          break;
        case "/groups":
          client.getChats().then((chats) => {
            const groups = chats.filter((chat) => chat.isGroup);

            if (groups.length == 0) {
              msg.reply("You have no group yet.");
            } else {
              let replyMsg = "*YOUR GROUPS*\n\n";
              groups.forEach((group, i) => {
                replyMsg += `ID: ${group.id._serialized}\nName: ${group.name}\n\n`;
              });
              replyMsg +=
                "_You can use the group id to send a message to the group._";
              msg.reply(replyMsg);
            }
          });
          break;
        case "/buttons":
          let button = new Buttons(
            "Button body",
            [{ body: "bt1" }, { body: "bt2" }, { body: "bt3" }],
            "title",
            "footer"
          );
          client.sendMessage(msg.from, button);
          break;
        case "/list":
          let sections = [
            {
              title: "sectionTitle",
              rows: [
                { title: "ListItem1", description: "desc" },
                { title: "ListItem2" },
              ],
            },
          ];
          let list = new List(
            "List body",
            "btnText",
            sections,
            "Title",
            "footer"
          );
          client.sendMessage(msg.from, list);
          break;
        case "/cekd3pajak19":
          msg.reply("Memproses permintaan ...");
          let sql = "SELECT * FROM `mahasiswa` WHERE NOT ISNULL(whatsapp)";
          db_d3pjk.query(sql, async function (err, result) {
            if (err) throw err;
            let verified = 0;
            let unverified = 0;
            let listUnverified = "";
            for (let data of result) {
              const mls = 100 + Math.floor(Math.random() * 1500) + 1;
              const number = phoneNumberFormatter("0" + data.whatsapp);
              const isRegisteredNumber = await client.isRegisteredUser(number);
              if (!isRegisteredNumber) {
                unverified = unverified + 1;
                listUnverified =
                  listUnverified + "\n" + data.npm + " - 0" + data.whatsapp;
                console.log("GAGAL " + data.npm + " 0" + data.whatsapp);
              } else {
                console.log("SUKSES " + data.npm + " 0" + data.whatsapp);
                verified++;
              }
              await sleep(mls);
            }
            let replyMsg =
              "*HASIL VERIFIKASI*\n\nTerverifikasi: " +
              verified +
              "\nGagal: " +
              unverified +
              "\n\n" +
              "*Daftar nomor yang gagal verifikasi*" +
              listUnverified;
            console.log(
              "- Sukses " + verified + " | Gagal " + unverified + " -"
            );
            client.sendMessage(msg.from, replyMsg);
          });
          break;
        case "/backup":
          msg.reply("Memulai backup ...");
          closeAllSession(true);
          break;
        default:
          // console.log(msg.type)
          // msg.reply('*AUTO REPLY*\r\nWhatsapp ini tidak dapat menerima pesan')
          break;
      }
    }
  });
  client.on("group_join", async (msg) => {
    const chat = await msg.getChat();
    msg.reply(
      "Halo, Bot ini dapat membantu kamu dalam mengelola group.\r\n\r\nSenang bergabung dengan * " +
        chat.name +
        "*"
    );
  });
  client.on("group_update", async (msg) => {
    msg.reply(JSON.stringify(msg));
  });

  const handleGroupChat = async (msg) => {
    const chat = await msg.getChat();
    const mentions = await msg.getMentions();
    let terpanggil = false;
    for (let contact of mentions) {
      terpanggil = contact.isMe;
      if (terpanggil) break;
    }
    if (terpanggil) {
      let pesan = msg.body.replace(/@/g, "/");
      let pesanSplit = pesan.split("/");
      for (let psn of pesanSplit) {
        if (psn.length > 0 && psn.slice(0, 2) !== "62") {
          pesan = psn.trim();
          break;
        }
      }
      switch (pesan) {
        case "help":
          const panduan =
            "*LIST COMMAND AUTOREPLY*\r\n\r\n" +
            "```panggil```  -> Tag semua participant\r\n" +
            "```help```  -> Bantuan list _command_";
          msg.reply(panduan);
          break;
        case "panggil":
          let text = "";
          let mentions = [];

          for (let participant of chat.participants) {
            const contact = await client.getContactById(
              participant.id._serialized
            );

            mentions.push(contact);
            text += `@${participant.id.user} `;
          }

          await chat.sendMessage(text, { mentions });
          break;
        default:
          break;
      }
    }
  };
  // Tambahkan client ke sessions
  sessions = {
    id: id,
    client: client,
  };
};

const init = async function (socket) {
  console.log("WA BOT INIT");
  if (savedSessions.length > 0) {
    if (socket) {
      // console.log(savedSessions); //pastikan session yg ditampilin sesuai sm data
      socket.emit("init", savedSessions);
      //??
    } else {
      createSession("wa-bot", "");
    }
  } else {
    if (socket) {
      socket.emit("init", []);
    }
  }
  botReady = true;
};
//DOWNLOAD SESSION
const initSession = async () => {
  console.log("Downloading Session");
  let progress = 0;
  var fileId = await cariSessionFile();
  await gdrive.files
    .get({ fileId, alt: "media" }, { responseType: "stream" })
    .then((res) => {
      res.data
        .on("end", async () => {
          console.log("Done downloading file.");
          const deleteFile = await gdrive.files.emptyTrash();
          if (deleteFile.data === "") {
            console.log("Trash deleted");
          }
          var sessionZip = new AdmZip("./data_session.zip");
          const dir = "./data_session/";
          if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
          }
          console.log("extracting file");
          sessionZip.extractAllTo(/*target path*/ dir, /*overwrite*/ true);
          fs.unlinkSync("./data_session.zip");
          console.log("Session restore Completed");
          fileSession = true;
          init();
        })
        .on("error", (err) => {
          console.error("Error Downloading File Session, opening new session");
          fileSession = true;
          init();
        })
        .on("data", (d) => {
          progress += d.length;
          if (process.stdout.isTTY) {
            process.stdout.clearLine();
            process.stdout.cursorTo(0);
            process.stdout.write(`Downloaded ${progress} bytes`);
          }
        })
        .pipe(fs.createWriteStream("data_session.zip"));
    })
    .catch((err) => {
      console.error(JSON.stringify(err));
    });
};
initSession();

// Socket IO
waSocket.on("connection", function (socket) {
  console.log("socket connected");
  if (fileSession) init(socket);
  else {
    const checkSessionFile = setInterval(() => {
      if (fileSession) {
        clearInterval(checkSessionFile);
        init(socket);
      }
    }, 500);
  }
  socket.on("create-session", async function (data) {
    console.log("Create session: " + data.id);
    await saveSession(data.id, data.description, null);
    createSession(data.id, data.description, "");
  });
  socket.on("remove-session", function (data) {
    console.log("Request remove session: " + data.id);
    const client = indexClient.client;
    // Menghapus pada file sessions
    removeSession(data.id);
    client.destroy().then(async () => {
      await sleep(500);
      if (fs.existsSync("./data_session/session-" + data.id)) {
        fs.rmdirSync("./data_session/session-" + data.id, {
          recursive: true,
          force: true,
        });
        await sleep(500);
        fs.rmdir(
          "./data_session/session-" + data.id,
          { recursive: true, force: true },
          (err) => {
            if (err) {
              return console.log("error occurred in deleting directory", err);
            }

            console.log("Session deleted successfully");
            waSocket.emit("remove-session", data.id);
          }
        );
      }
    });
  });
});

async function sleep(millis) {
  return new Promise((resolve) => setTimeout(resolve, millis));
}
module.exports = {
  whatsappPOSThandler,
  whatsappGEThandler,
};
