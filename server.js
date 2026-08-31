// server.js — the "brain" of the chat app.
// It runs the website, checks the passcode, and passes messages
// between the two people in real time.

const express = require("express");
const http = require("http");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// ---- SETTINGS ----
const PASSCODE = "nikupatle24";      // your secret passcode
const MAX_PEOPLE = 2;                // only 2 people allowed in the room
// -------------------

let connectedUsers = {}; // socket.id -> name, for people currently connected

// ---- MESSAGE STORAGE ----
const MESSAGES_FILE = path.join(__dirname, "messages.json");
const MAX_STORED_MESSAGES = 500;

function loadMessages() {
  try {
    return JSON.parse(fs.readFileSync(MESSAGES_FILE, "utf8"));
  } catch (e) {
    return [];
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

app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

io.on("connection", (socket) => {
  let joined = false;
  let loggedOut = false;

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
    socket.emit("join-success", { name: connectedUsers[socket.id] });
    socket.emit("chat-history", chatHistory);
    io.emit("system-message", `${connectedUsers[socket.id]} joined the chat.`);
  });

  // A new chat message
  socket.on("chat-message", (msg) => {
    if (!joined || !msg || !msg.trim()) return;
    const messageData = {
      id: crypto.randomUUID(),
      name: connectedUsers[socket.id],
      text: msg.trim(),
      time: new Date().toLocaleTimeString(),
      seen: false,
      edited: false,
      deleted: false,
    };
    chatHistory.push(messageData);
    saveMessages(chatHistory);
    io.emit("chat-message", messageData);
  });

  // The other person confirms they've seen a message
  socket.on("message-seen", ({ id }) => {
    const m = chatHistory.find((m) => m.id === id);
    if (m && !m.seen) {
      m.seen = true;
      saveMessages(chatHistory);
      io.emit("message-seen", { id });
    }
  });

  // Editing your own message
  socket.on("edit-message", ({ id, text }) => {
    if (!joined || !text || !text.trim()) return;
    const m = chatHistory.find((m) => m.id === id);
    if (m && m.name === connectedUsers[socket.id] && !m.deleted) {
      m.text = text.trim();
      m.edited = true;
      saveMessages(chatHistory);
      io.emit("message-edited", { id, text: m.text });
    }
  });

  // Deleting your own message
  socket.on("delete-message", ({ id }) => {
    if (!joined) return;
    const m = chatHistory.find((m) => m.id === id);
    if (m && m.name === connectedUsers[socket.id]) {
      m.deleted = true;
      m.text = "";
      saveMessages(chatHistory);
      io.emit("message-deleted", { id });
    }
  });

  // Typing indicator
  socket.on("typing", () => {
    if (!joined) return;
    socket.broadcast.emit("typing", { name: connectedUsers[socket.id] });
  });

  socket.on("stop-typing", () => {
    if (!joined) return;
    socket.broadcast.emit("stop-typing", { name: connectedUsers[socket.id] });
  });

  // Explicit logout (button press)
  socket.on("logout", () => {
    if (joined && !loggedOut) {
      loggedOut = true;
      io.emit("system-message", `${connectedUsers[socket.id]} logged out.`);
      delete connectedUsers[socket.id];
      joined = false;
    }
  });

  // Tab/browser closed, or connection dropped, without pressing logout
  socket.on("disconnect", () => {
    if (joined && !loggedOut) {
      io.emit("system-message", `${connectedUsers[socket.id]} left the browser without logging out.`);
      delete connectedUsers[socket.id];
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Chat server running on port ${PORT}`));
