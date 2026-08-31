// server.js — the "brain" of the chat app.
// It runs the website, checks each person's name+password, and passes
// messages (including images) between everyone in real time.

const express = require("express");
const http = require("http");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

// Allow slightly bigger messages so small images can be sent as base64 text
const io = new Server(server, {
  maxHttpBufferSize: 5 * 1024 * 1024, // 5 MB per message
});

// ---- ACCOUNTS ----
// Only these 2 exact name + password pairs can log in.
// To change a password later, just edit the value here and redeploy.
const USERS = {
  "Niku Patle": "niku24patle",
  "Kinjal": "Kittu22",
};
const MAX_PEOPLE = 2; // both accounts can be online together
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

  socket.on("join", ({ name, password }) => {
    const correctPassword = USERS[name];
    if (!correctPassword || password !== correctPassword) {
      socket.emit("join-error", "Wrong name or password.");
      return;
    }
    if (Object.keys(connectedUsers).length >= MAX_PEOPLE) {
      socket.emit("join-error", "Chat room is full.");
      return;
    }

    joined = true;
    connectedUsers[socket.id] = name;
    socket.emit("join-success", { name });
    socket.emit("chat-history", chatHistory);
    io.emit("system-message", `${name} joined the chat.`);
  });

  // A new text message
  socket.on("chat-message", (msg) => {
    if (!joined || !msg || !msg.trim()) return;
    const messageData = {
      id: crypto.randomUUID(),
      type: "text",
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

  // A new image message (sent as a base64 data URL from the browser)
  socket.on("chat-image", (imageData) => {
    if (!joined || !imageData) return;
    const messageData = {
      id: crypto.randomUUID(),
      type: "image",
      name: connectedUsers[socket.id],
      text: imageData, // holds the image data URL
      time: new Date().toLocaleTimeString(),
      seen: false,
      edited: false,
      deleted: false,
    };
    chatHistory.push(messageData);
    saveMessages(chatHistory);
    io.emit("chat-message", messageData);
  });

  // Anyone else seeing a message marks it as seen (blue tick)
  socket.on("message-seen", ({ id }) => {
    const m = chatHistory.find((m) => m.id === id);
    if (m && !m.seen) {
      m.seen = true;
      saveMessages(chatHistory);
      io.emit("message-seen", { id });
    }
  });

  // Editing your own text message
  socket.on("edit-message", ({ id, text }) => {
    if (!joined || !text || !text.trim()) return;
    const m = chatHistory.find((m) => m.id === id);
    if (m && m.type === "text" && m.name === connectedUsers[socket.id] && !m.deleted) {
      m.text = text.trim();
      m.edited = true;
      saveMessages(chatHistory);
      io.emit("message-edited", { id, text: m.text });
    }
  });

  // Deleting your own message (text or image)
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
