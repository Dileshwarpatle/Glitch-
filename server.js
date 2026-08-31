// server.js — the "brain" of the chat app.
// It runs the website, checks the passcode, and passes messages
// between the two people in real time.

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// ---- SETTINGS YOU CAN CHANGE ----
const PASSCODE = "nikupatle24";      // <-- set your own secret passcode here
const MAX_PEOPLE = 2;                // only 2 people allowed in the room
// ----------------------------------

let connectedUsers = {}; // keeps track of who is currently in the chat

// Serve the webpage (the HTML/CSS/JS in the "public" folder)
app.use(express.static("public"));

io.on("connection", (socket) => {
  let joined = false;

  // When someone tries to join with a name + passcode
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

  // When a message is sent
  socket.on("chat-message", (msg) => {
    if (!joined) return; // ignore messages from people who haven't joined properly
    io.emit("chat-message", {
      name: connectedUsers[socket.id],
      text: msg,
      time: new Date().toLocaleTimeString(),
    });
  });

  // When someone closes the tab / disconnects
  socket.on("disconnect", () => {
    if (joined) {
      io.emit("system-message", `${connectedUsers[socket.id]} left the chat.`);
      delete connectedUsers[socket.id];
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Chat server running on port ${PORT}`));
