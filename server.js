// server.js — the "brain" of the chat app.
// It runs the website, checks the passcode, and passes messages
// between the two people in real time.

const express = require("express");
const http = require("http");
const path = require("path");
const fs = require("fs");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// ---- SETTINGS ----
const PASSCODE = "nikupatle24";      // your secret passcode
const MAX_PEOPLE = 2;                // only 2 people allowed in the room
// -------------------

let connectedUsers = {}; // keeps track of who is currently in the chat

// ---- MESSAGE STORAGE ----
// Messages are saved to a file called messages.json so they survive
// the server going to sleep and waking back up. (They will be lost
// only if you redeploy the app or delete the service.)
const MESSAGES_FILE = path.join(__dirname, "messages.json");
const MAX_STORED_MESSAGES = 500; // keep the file from growing forever

function loadMessages() {
  try {
    const data = fs.readFileSync(MESSAGES_FILE, "utf8");
    return JSON.parse(data);
  } catch (e) {
    return []; // no file yet, or unreadable — start fresh
  }
}

function saveMessages(messages) {
  const trimmed = messages.slice(-MAX_STORED_MESSAGES);
  fs.writeFile(MESSAGES_FILE, JSON.stringify(trimmed), (err) => {
    if (err) console.log("Could not save messages:", err.message);
  });
}

let chatHistory = loadMessages();
// --------------------------

// Serve the webpage (the HTML/CSS/JS in the "public" folder)
app.use(express.static(path.join(__dirname, "public")));

// Explicitly send index.html for the homepage (belt-and-suspenders fix)
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
    socket.emit("chat-history", chatHistory); // send past messages to the person who just joined
    io.emit("system-message", `${connectedUsers[socket.id]} joined the chat.`);
  });

  socket.on("chat-message", (msg) => {
    if (!joined) return;
    const messageData = {
      name: connectedUsers[socket.id],
      text: msg,
      time: new Date().toLocaleTimeString(),
    };
    chatHistory.push(messageData);
    saveMessages(chatHistory);
    io.emit("chat-message", messageData);
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
