// server.js — the "brain" of the chat app.

const express = require("express");
const http = require("http");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 5 * 1024 * 1024 });

// ---- ACCOUNTS ----
const USERS = {
  "Niku Patle": "niku24patle",
  "Kinjal": "Kittu22",
};
const MAX_PEOPLE = 2;

// ---- SETTINGS ----
// When this chat "expires" — just for the countdown banner, doesn't delete anything by itself.
const EXPIRY_DATE = "2026-09-30"; // change this anytime
// Messages older than this are auto-removed to keep it temporary
const MAX_MESSAGE_AGE_DAYS = 30;
// -------------------

let connectedUsers = {}; // socket.id -> name

// ---- MESSAGE STORAGE ----
const MESSAGES_FILE = path.join(__dirname, "messages.json");
const STATE_FILE = path.join(__dirname, "state.json");
const MAX_STORED_MESSAGES = 1000;

function loadJSON(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    return fallback;
  }
}
function saveJSON(file, data) {
  fs.writeFile(file, JSON.stringify(data), (err) => {
    if (err) console.log(`Could not save ${file}:`, err.message);
  });
}

let chatHistory = loadJSON(MESSAGES_FILE, []);
let state = loadJSON(STATE_FILE, {
  pinnedMessageId: null,
  presence: Object.fromEntries(Object.keys(USERS).map((n) => [n, { online: false, lastSeen: null }])),
});

function saveMessages() { saveJSON(MESSAGES_FILE, chatHistory.slice(-MAX_STORED_MESSAGES)); }
function saveState() { saveJSON(STATE_FILE, state); }

function removeOldMessages() {
  const cutoff = Date.now() - MAX_MESSAGE_AGE_DAYS * 24 * 60 * 60 * 1000;
  const before = chatHistory.length;
  chatHistory = chatHistory.filter((m) => m.createdAt >= cutoff);
  if (chatHistory.length !== before) saveMessages();
}
removeOldMessages();
setInterval(removeOldMessages, 60 * 60 * 1000); // check every hour

// --------------------------

app.use(express.static(path.join(__dirname, "public")));
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

function displayTime() {
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

io.on("connection", (socket) => {
  let joined = false;
  let loggedOut = false;
  let myName = null;

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
    myName = name;
    connectedUsers[socket.id] = name;
    state.presence[name] = { online: true, lastSeen: null };
    saveState();

    socket.emit("join-success", {
      name,
      expiryDate: EXPIRY_DATE,
      pinnedMessageId: state.pinnedMessageId,
      presence: state.presence,
    });
    socket.emit("chat-history", chatHistory);
    io.emit("system-message", `${name} joined the chat.`);
    io.emit("presence-update", { name, online: true, lastSeen: null });
  });

  socket.on("chat-message", ({ text, replyTo }) => {
    if (!joined || !text || !text.trim()) return;
    const messageData = {
      id: crypto.randomUUID(),
      type: "text",
      name: myName,
      text: text.trim(),
      time: displayTime(),
      createdAt: Date.now(),
      seen: false,
      edited: false,
      deleted: false,
      replyTo: replyTo || null,
      reactions: {},
    };
    chatHistory.push(messageData);
    saveMessages();
    io.emit("chat-message", messageData);
  });

  socket.on("chat-image", ({ image, replyTo }) => {
    if (!joined || !image) return;
    const messageData = {
      id: crypto.randomUUID(),
      type: "image",
      name: myName,
      text: image,
      time: displayTime(),
      createdAt: Date.now(),
      seen: false,
      edited: false,
      deleted: false,
      replyTo: replyTo || null,
      reactions: {},
    };
    chatHistory.push(messageData);
    saveMessages();
    io.emit("chat-message", messageData);
  });

  socket.on("message-seen", ({ id }) => {
    const m = chatHistory.find((m) => m.id === id);
    if (m && !m.seen) {
      m.seen = true;
      saveMessages();
      io.emit("message-seen", { id });
    }
  });

  socket.on("edit-message", ({ id, text }) => {
    if (!joined || !text || !text.trim()) return;
    const m = chatHistory.find((m) => m.id === id);
    if (m && m.type === "text" && m.name === myName && !m.deleted) {
      m.text = text.trim();
      m.edited = true;
      saveMessages();
      io.emit("message-edited", { id, text: m.text });
    }
  });

  socket.on("delete-message", ({ id }) => {
    if (!joined) return;
    const m = chatHistory.find((m) => m.id === id);
    if (m && m.name === myName) {
      m.deleted = true;
      m.text = "";
      saveMessages();
      io.emit("message-deleted", { id });
      if (state.pinnedMessageId === id) {
        state.pinnedMessageId = null;
        saveState();
        io.emit("message-unpinned");
      }
    }
  });

  socket.on("react-message", ({ id, emoji }) => {
    if (!joined) return;
    const m = chatHistory.find((m) => m.id === id);
    if (!m || m.deleted) return;
    if (!m.reactions) m.reactions = {};
    for (const key of Object.keys(m.reactions)) {
      m.reactions[key] = m.reactions[key].filter((n) => n !== myName);
      if (m.reactions[key].length === 0) delete m.reactions[key];
    }
    const alreadyHadThis = m.reactions[emoji] && m.reactions[emoji].includes(myName);
    if (!alreadyHadThis) {
      if (!m.reactions[emoji]) m.reactions[emoji] = [];
      m.reactions[emoji].push(myName);
    }
    saveMessages();
    io.emit("message-reacted", { id, reactions: m.reactions });
  });

  socket.on("pin-message", ({ id }) => {
    if (!joined) return;
    const m = chatHistory.find((m) => m.id === id);
    if (!m || m.deleted) return;
    state.pinnedMessageId = id;
    saveState();
    io.emit("message-pinned", { id, message: m });
  });

  socket.on("unpin-message", () => {
    if (!joined) return;
    state.pinnedMessageId = null;
    saveState();
    io.emit("message-unpinned");
  });

  socket.on("clear-chat", () => {
    if (!joined) return;
    chatHistory = [];
    state.pinnedMessageId = null;
    saveMessages();
    saveState();
    io.emit("chat-cleared");
  });

  socket.on("typing", () => {
    if (!joined) return;
    socket.broadcast.emit("typing", { name: myName });
  });

  socket.on("stop-typing", () => {
    if (!joined) return;
    socket.broadcast.emit("stop-typing", { name: myName });
  });

  function handleLeave(explicitLogout) {
    if (!joined || loggedOut) return;
    loggedOut = true;
    const lastSeen = Date.now();
    state.presence[myName] = { online: false, lastSeen };
    saveState();
    io.emit(
      "system-message",
      explicitLogout ? `${myName} logged out.` : `${myName} left the browser without logging out.`
    );
    io.emit("presence-update", { name: myName, online: false, lastSeen });
    delete connectedUsers[socket.id];
    joined = false;
  }

  socket.on("logout", () => handleLeave(true));
  socket.on("disconnect", () => handleLeave(false));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Chat server running on port ${PORT}`));
