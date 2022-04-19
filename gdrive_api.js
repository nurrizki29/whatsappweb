const path = require("path");
const fs = require("fs");
const mime = require("mime-types");
const AdmZip = require("adm-zip");
const axios = require("axios");
const { google } = require("googleapis");
const credentials = require("./credentials.json");
const scopes = ["https://www.googleapis.com/auth/drive"];
const auth = new google.auth.JWT(
  credentials.client_email,
  null,
  credentials.private_key,
  scopes
);
const gdrive = google.drive({ version: "v3", auth });
const finalPath = path.resolve(__dirname, "./data_session.zip");
//---
var fileId = null;
let progress = 0;
const cariSessionFile = async () => {
  const files = await gdrive.files.list({});
  if (files.data.files.length) {
    files.data.files.map((file) => {
      if (file.name === "data_session.zip") fileId = file.id;
    });
  }
  return fileId;
};
const downloadSessionBackup = async () => {
  await cariSessionFile();
  await gdrive.files
    .get({ fileId, alt: "media" }, { responseType: "stream" })
    .then((res) => {
      res.data
        .on("end", async () => {
          console.log("Done downloading file.");
          const deleteFile = await gdrive.files.emptyTrash();
          if (deleteFile.status == 200) {
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
        })
        .on("error", (err) => {
          console.error("Error Downloading File Session, opening new session");
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
const uploadSessionBackup = async () => {
  var zip = new AdmZip();
  zip.addLocalFolder("./data_session");
  zip.writeZip("./data_session.zip");
  console.log("Compression Success");
  const file = fs.createReadStream("./data_session.zip"); //too big to upload
  await cariSessionFile();
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
        mimeType: mime.lookup(finalPath),
        parents: ["1zl3xCmn2SxVvTHeP9IZpHX7QYeHcBy1Z"],
      },
      media: {
        mimeType: mime.lookup(finalPath),
        body: fs.createReadStream(finalPath),
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

module.exports = {
  downloadSessionBackup,
  uploadSessionBackup,
  cariSessionFile,
  gdrive,
};
