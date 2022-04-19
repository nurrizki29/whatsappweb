const express = require("express");
const http = require("http");
const port = process.env.PORT || 8000;
const app = express();
const server = http.createServer(app);
const socketIO = require("socket.io");
const io = socketIO(server);

module.exports = {
  app,
  server,
  socketIO,
  io,
};
