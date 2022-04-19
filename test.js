const fs = require("fs");
const cron = require("node-cron");

if (fs.existsSync("./.wwebjs_auth/"))
  fs.rmdirSync("./.wwebjs_auth/", { recursive: true });
if (fs.existsSync("./test.jpeg")) fs.unlinkSync("./test.jpeg");

cron.schedule("* * * * *", () => {
  console.log("running a task every minute");
});
