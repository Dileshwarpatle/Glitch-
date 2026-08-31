// server.js — the "brain" of the chat app.
// It runs the website, checks the passcode, and passes messages
// between the two people in real time.

const express = require("express");
const http = require("http");
const path = require("path");
const fs = require("fs");
const { Server } = require("socket.io");

// ---- DEBUG: show exactly what files exist where Render runs the app ----
console.log("Current folder (__dirname):", __dirname);
console.log("Files in root:", fs.readdirSync(__dirname));
try {
  console.log("Files in public folder:", fs.readdirSync(path.join(__dirname, "public")));
} catch (e) {
  console.log("PROBLEM: no 'public' folder found here:", e.message);
}
// --------------------------------------------------------------------

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// ---- SETTINGS ----
const PASSCODE = "nikupatle24";      // your secret passcode
const MAX_PEOPLE = 2;                // only 2 people allowed in the room
// -------------------

let connectedUsers = {};

app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

io.on("connection", (socket) => {
  let joined = false;

  socket.on("join", ({ name, passcode }) => {
    if (passcode !== PASSCODE) {
      socket.emit("join-error", "Wrong passcode.");
      return;
    }
    if (Object.keys(connectedUsers).length >= MAX_PEOPLE) {
      socket.emit("join-error", "Chat room is full (max 2 people).");
      return;
    }

    joined = true;
    connectedUsers[socket.id] = name || "Anonymous";
    socket.emit("join-success");
    io.emit("system-message", `${connectedUsers[socket.id]} joined the chat.`);
  });

  socket.on("chat-message", (msg) => {
    if (!joined) return;
    io.emit("chat-message", {
      name: connectedUsers[socket.id],
      text: msg,
      time: new Date().toLocaleTimeString(),
    });
  });

  socket.on("disconnect", () => {
    if (joined) {
      io.emit("system-message", `${connectedUsers[socket.id]} left the chat.`);
      delete connectedUsers[socket.id];
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Chat server running on port ${PORT}`));
