const express = require("express");
const http = require("http");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const Database = require("better-sqlite3");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 25 * 1024 });

const dbPath = process.env.DB_PATH || path.join(__dirname, "data", "chat.db");
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("busy_timeout = 5000");

db.exec(`
  CREATE TABLE IF NOT EXISTS rooms (
    code TEXT PRIMARY KEY,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_code TEXT NOT NULL,
    sender_name TEXT NOT NULL,
    sender_client_id TEXT NOT NULL,
    message_text TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY(room_code) REFERENCES rooms(code)
  );
  CREATE INDEX IF NOT EXISTS idx_messages_room_id ON messages(room_code, id);
`);

app.disable("x-powered-by");
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'", "ws:", "wss:"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"]
    }
  }
}));
app.use(express.json({ limit: "10kb" }));
app.use("/api", rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false
}));
app.use(express.static(path.join(__dirname, "public")));

const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function makeCode() {
  let code;
  do {
    code = Array.from({ length: 8 }, () =>
      alphabet[crypto.randomInt(alphabet.length)]
    ).join("");
  } while (db.prepare("SELECT 1 FROM rooms WHERE code = ?").get(code));
  return code;
}

function cleanName(value) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, 24);
}

function cleanText(value) {
  return String(value || "").trim().slice(0, 2000);
}

function getRoomUsers(code) {
  const memberIds = io.sockets.adapter.rooms.get(code);
  if (!memberIds) return [];

  const users = [];
  for (const socketId of memberIds) {
    const client = io.sockets.sockets.get(socketId);
    if (client && client.data.roomCode === code && client.data.name) {
      users.push({ id: client.data.clientId, name: client.data.name });
    }
  }
  return users.sort((a, b) => a.name.localeCompare(b.name));
}

function getRecentMessages(code, limit = 100) {
  return db.prepare(`
    SELECT id,
           sender_name AS name,
           sender_client_id AS clientId,
           message_text AS text,
           created_at AS time
    FROM messages
    WHERE room_code = ?
    ORDER BY id DESC
    LIMIT ?
  `).all(code, limit).reverse();
}

function broadcastUsers(code) {
  io.to(code).emit("room-users", getRoomUsers(code));
}

app.post("/api/rooms", (req, res) => {
  const code = makeCode();
  db.prepare("INSERT INTO rooms (code, created_at) VALUES (?, ?)").run(code, Date.now());
  res.status(201).json({ code });
});

app.get("/api/rooms/:code", (req, res) => {
  const code = String(req.params.code || "").toUpperCase();
  const room = db.prepare("SELECT code FROM rooms WHERE code = ?").get(code);
  res.json({ exists: Boolean(room) });
});

io.on("connection", socket => {
  socket.data.recentMessageTimes = [];

  socket.on("join-room", ({ code, name, clientId } = {}) => {
    if (socket.data.roomCode) {
      socket.emit("join-error", "Du bist bereits in einem Raum. Lade die Seite neu, um zu wechseln.");
      return;
    }

    code = String(code || "").trim().toUpperCase();
    name = cleanName(name);
    clientId = String(clientId || "").slice(0, 80);

    if (!/^[A-Z0-9]{8}$/.test(code) || !name || !/^[A-Za-z0-9_-]{8,80}$/.test(clientId)) {
      socket.emit("join-error", "Bitte gib einen gültigen Raum-Code, Namen und lade die Seite neu.");
      return;
    }

    const roomExists = db.prepare("SELECT 1 FROM rooms WHERE code = ?").get(code);
    if (!roomExists) {
      socket.emit("join-error", "Dieser Raum existiert nicht. Prüfe den Code oder den Einladungslink.");
      return;
    }

    socket.data.roomCode = code;
    socket.data.name = name;
    socket.data.clientId = clientId;
    socket.join(code);

    socket.emit("joined", {
      code,
      name,
      clientId,
      messages: getRecentMessages(code, 100)
    });
    broadcastUsers(code);
  });

  socket.on("chat-message", ({ text } = {}) => {
    const code = socket.data.roomCode;
    const name = socket.data.name;
    const clientId = socket.data.clientId;
    if (!code || !name || !clientId) return;

    const messageText = cleanText(text);
    if (!messageText) return;

    const now = Date.now();
    socket.data.recentMessageTimes = socket.data.recentMessageTimes.filter(t => now - t < 10000);
    if (socket.data.recentMessageTimes.length >= 12) {
      socket.emit("chat-warning", "Du sendest sehr schnell. Warte kurz und versuche es erneut.");
      return;
    }
    socket.data.recentMessageTimes.push(now);

    const result = db.prepare(`
      INSERT INTO messages (room_code, sender_name, sender_client_id, message_text, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(code, name, clientId, messageText, now);

    io.to(code).emit("new-message", {
      id: Number(result.lastInsertRowid),
      name,
      clientId,
      text: messageText,
      time: now
    });
  });

  socket.on("disconnect", () => {
    const code = socket.data.roomCode;
    if (code) broadcastUsers(code);
  });
});

const port = Number(process.env.PORT || 3000);
server.listen(port, "0.0.0.0", () => {
  console.log(`NEON Gruppenchat läuft auf Port ${port}`);
});
