const express = require("express");
const http = require("http");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { promisify } = require("util");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const multer = require("multer");
const Database = require("better-sqlite3");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 64 * 1024 });
const scrypt = promisify(crypto.scrypt);
const dbPath = process.env.DB_PATH || path.join(__dirname, "data", "chat.db");
const dataDir = path.dirname(dbPath);
const uploadDir = path.join(dataDir, "uploads");
fs.mkdirSync(uploadDir, { recursive: true });

const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("busy_timeout = 5000");
db.pragma("foreign_keys = ON");
db.exec(`
  CREATE TABLE IF NOT EXISTS rooms (code TEXT PRIMARY KEY, created_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT, room_code TEXT NOT NULL,
    sender_name TEXT NOT NULL, sender_client_id TEXT NOT NULL,
    message_text TEXT NOT NULL, created_at INTEGER NOT NULL,
    FOREIGN KEY(room_code) REFERENCES rooms(code)
  );
  CREATE INDEX IF NOT EXISTS idx_messages_room_id ON messages(room_code, id);
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, username TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL, password_hash TEXT NOT NULL, avatar_color TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user', banned INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('direct','group')),
    title TEXT, created_by TEXT NOT NULL REFERENCES users(id), created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS conversation_members (
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    joined_at INTEGER NOT NULL, PRIMARY KEY(conversation_id,user_id)
  );
  CREATE TABLE IF NOT EXISTS chat_messages (
    id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    sender_id TEXT NOT NULL REFERENCES users(id), body TEXT NOT NULL DEFAULT '',
    attachment_id TEXT, created_at INTEGER NOT NULL, deleted_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_chat_messages_conversation ON chat_messages(conversation_id,created_at);
  CREATE TABLE IF NOT EXISTS attachments (
    id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id),
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    original_name TEXT NOT NULL, stored_name TEXT NOT NULL, mime_type TEXT NOT NULL,
    size INTEGER NOT NULL, created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS reports (
    id TEXT PRIMARY KEY, reporter_id TEXT NOT NULL REFERENCES users(id),
    message_id TEXT REFERENCES chat_messages(id) ON DELETE SET NULL,
    reason TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open', created_at INTEGER NOT NULL,
    reviewed_by TEXT REFERENCES users(id), reviewed_at INTEGER
  );
`);

app.disable("x-powered-by");
app.set("trust proxy", process.env.TRUST_PROXY === "1" ? 1 : false);
app.use(helmet({
  contentSecurityPolicy: { directives: {
    defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'"],
    imgSrc: ["'self'", "data:", "blob:"], connectSrc: ["'self'", "ws:", "wss:"],
    fontSrc: ["'self'"], objectSrc: ["'none'"], frameAncestors: ["'none'"],
    formAction: ["'self'"], baseUri: ["'self'"]
  } }
}));
app.use(express.json({ limit: "20kb" }));
app.use("/api", rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: true, legacyHeaders: false }));
app.use("/api/auth", rateLimit({ windowMs: 15 * 60_000, limit: 12, standardHeaders: true, legacyHeaders: false }));

const SESSION_MS = 7 * 24 * 60 * 60 * 1000;
const COOKIE = "neon_session";
const COOKIE_SECRET = process.env.SESSION_SECRET || "";
if (process.env.NODE_ENV === "production" && COOKIE_SECRET.length < 32) {
  console.warn("WARNUNG: SESSION_SECRET sollte in Produktion gesetzt werden (mindestens 32 Zeichen).");
}
const sessionSecret = COOKIE_SECRET.length >= 32 ? COOKIE_SECRET : crypto.randomBytes(48).toString("hex");
const allowedMimes = new Set(["image/jpeg","image/png","image/gif","image/webp","application/pdf","text/plain"]);
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadDir),
    filename: (_req, _file, cb) => cb(null, crypto.randomUUID())
  }),
  limits: { fileSize: 8 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => cb(null, allowedMimes.has(file.mimetype))
});

function id() { return crypto.randomUUID(); }
function clean(value, max = 100) { return String(value ?? "").normalize("NFKC").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, max); }
function emailClean(value) { return clean(value, 254).toLowerCase(); }
function usernameClean(value) { return clean(value, 24).replace(/\s+/g, " "); }
function sign(token) { return crypto.createHmac("sha256", sessionSecret).update(token).digest("hex"); }
function cookieValue(req) {
  const raw = req.headers.cookie || "";
  const match = raw.match(new RegExp("(?:^|;\\s*)" + COOKIE + "=([^;]+)"));
  if (!match) return null;
  try {
    const [token, signature] = decodeURIComponent(match[1]).split(".");
    if (!token || !signature) return null;
    const a = Buffer.from(signature, "hex"), b = Buffer.from(sign(token), "hex");
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    return token;
  } catch { return null; }
}
function sessionUser(req) {
  const token = cookieValue(req);
  if (!token) return null;
  const row = db.prepare(`SELECT u.id,u.email,u.username,u.display_name AS displayName,u.avatar_color AS avatarColor,u.role,u.banned
    FROM sessions s JOIN users u ON u.id=s.user_id
    WHERE s.token_hash=? AND s.expires_at>? `).get(crypto.createHash("sha256").update(token).digest("hex"), Date.now());
  if (!row || row.banned) return null;
  return row;
}
function requireAuth(req, res, next) {
  const user = sessionUser(req);
  if (!user) return res.status(401).json({ error: "Bitte melde dich erneut an." });
  req.user = user;
  next();
}
function requireAdmin(req, res, next) {
  if (req.user?.role !== "admin") return res.status(403).json({ error: "Nur für Admins." });
  next();
}
function setSession(res, userId) {
  const token = crypto.randomBytes(32).toString("hex");
  const now = Date.now();
  db.prepare("INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)")
    .run(crypto.createHash("sha256").update(token).digest("hex"), userId, now + SESSION_MS, now);
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader("Set-Cookie", `${COOKIE}=${encodeURIComponent(token + "." + sign(token))}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_MS / 1000}${secure}`);
}
function clearSession(req, res) {
  const token = cookieValue(req);
  if (token) db.prepare("DELETE FROM sessions WHERE token_hash=?").run(crypto.createHash("sha256").update(token).digest("hex"));
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader("Set-Cookie", `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`);
}
function publicUser(row) {
  return { id: row.id, username: row.username, displayName: row.display_name || row.displayName,
    avatarColor: row.avatar_color || row.avatarColor, role: row.role || "user" };
}
function isMember(conversationId, userId) {
  return !!db.prepare("SELECT 1 FROM conversation_members WHERE conversation_id=? AND user_id=?").get(conversationId,userId);
}
function conversationSummary(conversationId, userId) {
  const conv = db.prepare("SELECT * FROM conversations WHERE id=?").get(conversationId);
  if (!conv || !isMember(conversationId,userId)) return null;
  const members = db.prepare(`SELECT u.id,u.username,u.display_name,u.avatar_color,u.role FROM users u
    JOIN conversation_members m ON m.user_id=u.id WHERE m.conversation_id=? ORDER BY u.username`).all(conversationId).map(publicUser);
  const last = db.prepare(`SELECT m.id,m.body,m.created_at,m.sender_id,u.username FROM chat_messages m
    JOIN users u ON u.id=m.sender_id WHERE m.conversation_id=? AND m.deleted_at IS NULL ORDER BY m.created_at DESC LIMIT 1`).get(conversationId);
  const other = conv.kind === "direct" ? members.find(m => m.id !== userId) : null;
  return { id: conv.id, kind: conv.kind, title: conv.kind === "group" ? conv.title : (other?.displayName || other?.username || "Direktchat"),
    members, lastMessage: last ? { body: last.body || (last.attachment_id ? "Datei" : ""), time: last.created_at, sender: last.username } : null };
}
function emitConversation(conversationId, event, payload) {
  const members = db.prepare("SELECT user_id FROM conversation_members WHERE conversation_id=?").all(conversationId);
  for (const member of members) io.to("user:" + member.user_id).emit(event, payload);
}
function getRoomUsers(code) {
  const memberIds = io.sockets.adapter.rooms.get(code);
  if (!memberIds) return [];
  const users = [];
  for (const socketId of memberIds) {
    const client = io.sockets.sockets.get(socketId);
    if (client && client.data.roomCode && client.data.name) users.push({ id: client.data.clientId, name: client.data.name });
  }
  return users.sort((a,b) => a.name.localeCompare(b.name));
}
function broadcastUsers(code) { io.to(code).emit("room-users", getRoomUsers(code)); }

app.get("/api/health", (_req,res) => res.json({ ok: true }));
app.post("/api/auth/register", async (req,res) => {
  const email = emailClean(req.body?.email);
  const username = clean(req.body?.username, 24).toLowerCase();
  const displayName = usernameClean(req.body?.displayName || req.body?.username);
  const password = String(req.body?.password || "");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: "Bitte gib eine gültige E-Mail-Adresse ein." });
  if (!/^[a-z0-9_]{3,24}$/.test(username)) return res.status(400).json({ error: "Benutzername: 3–24 Zeichen, nur Buchstaben, Zahlen und _." });
  if (password.length < 10 || password.length > 128) return res.status(400).json({ error: "Das Passwort muss 10 bis 128 Zeichen lang sein." });
  if (db.prepare("SELECT 1 FROM users WHERE email=? OR username=?").get(email,username)) return res.status(409).json({ error: "E-Mail oder Benutzername ist bereits vergeben." });
  try {
    const salt = crypto.randomBytes(16);
    const derived = await scrypt(password, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
    const userId = id();
    const role = process.env.ADMIN_EMAIL && email === emailClean(process.env.ADMIN_EMAIL) ? "admin" : "user";
    const color = ["#8b7cff","#48c6ef","#f59eae","#55d6a7","#f3b562"][crypto.randomInt(5)];
    db.prepare("INSERT INTO users(id,email,username,display_name,password_hash,avatar_color,role,created_at) VALUES(?,?,?,?,?,?,?,?)")
      .run(userId,email,username,displayName,salt.toString("hex")+":"+derived.toString("hex"),color,role,Date.now());
    setSession(res,userId);
    res.status(201).json({ user: publicUser(db.prepare("SELECT * FROM users WHERE id=?").get(userId)) });
  } catch (error) {
    if (String(error.message).includes("UNIQUE")) return res.status(409).json({ error: "E-Mail oder Benutzername ist bereits vergeben." });
    console.error("Registrierung fehlgeschlagen:", error.message);
    res.status(500).json({ error: "Registrierung fehlgeschlagen." });
  }
});
app.post("/api/auth/login", async (req,res) => {
  const login = clean(req.body?.login,254).toLowerCase();
  const password = String(req.body?.password || "");
  const user = db.prepare("SELECT * FROM users WHERE email=? OR username=?").get(login,login);
  if (!user || user.banned) return res.status(401).json({ error: "Anmeldedaten stimmen nicht oder das Konto ist gesperrt." });
  try {
    const [saltHex, hashHex] = user.password_hash.split(":");
    const actual = await scrypt(password,saltHex ? Buffer.from(saltHex,"hex") : "",64,{N:16384,r:8,p:1,maxmem:64*1024*1024});
    const expected = Buffer.from(hashHex || "", "hex");
    if (actual.length !== expected.length || !crypto.timingSafeEqual(actual,expected)) return res.status(401).json({ error: "Anmeldedaten stimmen nicht oder das Konto ist gesperrt." });
    setSession(res,user.id);
    res.json({ user: publicUser(user) });
  } catch { res.status(401).json({ error: "Anmeldedaten stimmen nicht oder das Konto ist gesperrt." }); }
});
app.post("/api/auth/logout", (req,res) => { clearSession(req,res); res.json({ ok:true }); });
app.get("/api/auth/me", requireAuth, (req,res) => res.json({ user: req.user }));
app.patch("/api/profile", requireAuth, (req,res) => {
  const displayName = usernameClean(req.body?.displayName);
  const avatarColor = clean(req.body?.avatarColor, 20);
  const colors = new Set(["#8b7cff","#48c6ef","#f59eae","#55d6a7","#f3b562","#fb7185","#60a5fa"]);
  if (displayName.length < 2 || displayName.length > 24) return res.status(400).json({ error: "Anzeigename muss 2–24 Zeichen lang sein." });
  if (!colors.has(avatarColor)) return res.status(400).json({ error: "Ungültige Avatar-Farbe." });
  db.prepare("UPDATE users SET display_name=?,avatar_color=? WHERE id=?").run(displayName,avatarColor,req.user.id);
  res.json({ user: publicUser(db.prepare("SELECT * FROM users WHERE id=?").get(req.user.id)) });
});
app.get("/api/users", requireAuth, (req,res) => {
  const q = clean(req.query.q,32).toLowerCase();
  if (q.length < 2) return res.json({ users: [] });
  const users = db.prepare("SELECT id,username,display_name,avatar_color,role FROM users WHERE banned=0 AND id<>? AND (username LIKE ? OR display_name LIKE ?) ORDER BY username LIMIT 20")
    .all(req.user.id,"%"+q+"%","%"+q+"%").map(publicUser);
  res.json({ users });
});
app.get("/api/conversations", requireAuth, (req,res) => {
  const ids = db.prepare("SELECT conversation_id FROM conversation_members WHERE user_id=?").all(req.user.id);
  res.json({ conversations: ids.map(x=>conversationSummary(x.conversation_id,req.user.id)).filter(Boolean).sort((a,b)=>(b.lastMessage?.time||0)-(a.lastMessage?.time||0)) });
});
app.post("/api/conversations", requireAuth, (req,res) => {
  const kind = req.body?.kind === "group" ? "group" : "direct";
  const rawIds = Array.isArray(req.body?.members) ? req.body.members : [];
  const memberIds = [...new Set([req.user.id,...rawIds.map(x=>clean(x,64)).filter(Boolean)])].slice(0,21);
  if (kind === "direct" && memberIds.length !== 2) return res.status(400).json({ error: "Für einen Direktchat wähle genau eine andere Person." });
  if (kind === "group" && memberIds.length < 2) return res.status(400).json({ error: "Eine Gruppe braucht mindestens eine weitere Person." });
  if (kind === "group" && memberIds.length > 20) return res.status(400).json({ error: "Eine Gruppe darf maximal 20 Mitglieder haben." });
  const users = db.prepare("SELECT id FROM users WHERE banned=0 AND id IN ("+memberIds.map(()=>"?").join(",")+")").all(...memberIds);
  if (users.length !== memberIds.length) return res.status(400).json({ error: "Mindestens ein Konto ist nicht verfügbar." });
  if (kind === "direct") {
    const existing = db.prepare(`SELECT c.id FROM conversations c
      JOIN conversation_members a ON a.conversation_id=c.id AND a.user_id=?
      JOIN conversation_members b ON b.conversation_id=c.id AND b.user_id=?
      WHERE c.kind='direct' LIMIT 1`).get(memberIds[0],memberIds[1]);
    if (existing) return res.json({ conversation: conversationSummary(existing.id,req.user.id) });
  }
  const title = kind === "group" ? clean(req.body?.title,48) : null;
  if (kind === "group" && title.length < 2) return res.status(400).json({ error: "Der Gruppenname muss mindestens 2 Zeichen lang sein." });
  const conversationId=id(), now=Date.now();
  const create = db.transaction(() => {
    db.prepare("INSERT INTO conversations(id,kind,title,created_by,created_at) VALUES(?,?,?,?,?)").run(conversationId,kind,title,req.user.id,now);
    const add = db.prepare("INSERT INTO conversation_members(conversation_id,user_id,joined_at) VALUES(?,?,?)");
    memberIds.forEach(userId=>add.run(conversationId,userId,now));
  });
  create();
  const conversation = conversationSummary(conversationId,req.user.id);
  emitConversation(conversationId,"conversation-updated",conversation);
  res.status(201).json({ conversation });
});
app.get("/api/conversations/:id/messages", requireAuth, (req,res) => {
  const conversationId=clean(req.params.id,64);
  if (!isMember(conversationId,req.user.id)) return res.status(404).json({ error:"Chat nicht gefunden." });
  const before = Number(req.query.before) || Date.now()+1;
  const messages = db.prepare(`SELECT m.id,m.body,m.created_at AS time,m.sender_id AS senderId,m.attachment_id AS attachmentId,
    u.username,u.display_name AS displayName,u.avatar_color AS avatarColor
    FROM chat_messages m JOIN users u ON u.id=m.sender_id
    WHERE m.conversation_id=? AND m.deleted_at IS NULL AND m.created_at<?
    ORDER BY m.created_at DESC LIMIT 100`).all(conversationId,before).reverse().map(m=>({
      id:m.id,body:m.body,time:m.time,senderId:m.senderId,
      sender:{id:m.senderId,username:m.username,displayName:m.displayName,avatarColor:m.avatarColor},
      attachment:m.attachmentId ? db.prepare("SELECT id,original_name AS name,mime_type AS type,size FROM attachments WHERE id=?").get(m.attachmentId) : null
    }));
  res.json({ messages });
});
app.post("/api/conversations/:id/upload", requireAuth, (req,res) => {
  const conversationId=clean(req.params.id,64);
  if (!isMember(conversationId,req.user.id)) return res.status(404).json({ error:"Chat nicht gefunden." });
  upload.single("file")(req,res,err=>{
    if (err) return res.status(400).json({ error: err.code === "LIMIT_FILE_SIZE" ? "Datei darf höchstens 8 MB groß sein." : "Dateityp nicht erlaubt. Erlaubt sind Bilder, PDF und Textdateien." });
    if (!req.file) return res.status(400).json({ error:"Bitte wähle eine erlaubte Datei aus." });
    const attachmentId=id(), now=Date.now(), body=clean(req.body?.message,2000);
    try {
      db.prepare("INSERT INTO attachments(id,owner_id,conversation_id,original_name,stored_name,mime_type,size,created_at) VALUES(?,?,?,?,?,?,?,?)")
        .run(attachmentId,req.user.id,conversationId,clean(path.basename(req.file.originalname),140)||"Datei",req.file.filename,req.file.mimetype,req.file.size,now);
      const messageId=id();
      db.prepare("INSERT INTO chat_messages(id,conversation_id,sender_id,body,attachment_id,created_at) VALUES(?,?,?,?,?,?)")
        .run(messageId,conversationId,req.user.id,body,attachmentId,now);
      const message = db.prepare(`SELECT u.id AS senderId,u.username,u.display_name AS displayName,u.avatar_color AS avatarColor
        FROM users u WHERE u.id=?`).get(req.user.id);
      const payload={id:messageId,body,time:now,senderId:req.user.id,sender:{id:req.user.id,username:message.username,displayName:message.displayName,avatarColor:message.avatarColor},
        attachment:{id:attachmentId,name:clean(path.basename(req.file.originalname),140)||"Datei",type:req.file.mimetype,size:req.file.size,url:"/api/attachments/"+attachmentId}};
      emitConversation(conversationId,"new-chat-message",{conversationId,message:payload});
      res.status(201).json({ message:payload });
    } catch (error) {
      fs.unlink(req.file.path,()=>{});
      console.error("Upload fehlgeschlagen:",error.message);
      res.status(500).json({ error:"Datei konnte nicht gespeichert werden." });
    }
  });
});
app.get("/api/attachments/:id", requireAuth, (req,res) => {
  const attachment=db.prepare("SELECT * FROM attachments WHERE id=?").get(clean(req.params.id,64));
  if (!attachment || !isMember(attachment.conversation_id,req.user.id)) return res.status(404).json({ error:"Datei nicht gefunden." });
  const filePath=path.join(uploadDir,attachment.stored_name);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error:"Datei ist nicht mehr verfügbar." });
  res.setHeader("Content-Type",attachment.mime_type);
  res.setHeader("X-Content-Type-Options","nosniff");
  res.setHeader("Content-Disposition", "attachment; filename*=UTF-8''"+encodeURIComponent(attachment.original_name));
  res.sendFile(filePath);
});
app.post("/api/messages/:id/report", requireAuth, (req,res) => {
  const messageId=clean(req.params.id,64), reason=clean(req.body?.reason,240);
  const message=db.prepare("SELECT conversation_id FROM chat_messages WHERE id=? AND deleted_at IS NULL").get(messageId);
  if (!message || !isMember(message.conversation_id,req.user.id)) return res.status(404).json({ error:"Nachricht nicht gefunden." });
  const already=db.prepare("SELECT 1 FROM reports WHERE reporter_id=? AND message_id=? AND status='open'").get(req.user.id,messageId);
  if (already) return res.status(409).json({ error:"Du hast diese Nachricht bereits gemeldet." });
  db.prepare("INSERT INTO reports(id,reporter_id,message_id,reason,created_at) VALUES(?,?,?,?,?)").run(id(),req.user.id,messageId,reason||"Keine Begründung angegeben",Date.now());
  res.status(201).json({ ok:true });
});
app.get("/api/admin/overview", requireAuth, requireAdmin, (_req,res) => {
  res.json({
    users:db.prepare("SELECT id,username,display_name AS displayName,email,role,banned,created_at AS createdAt FROM users ORDER BY created_at DESC LIMIT 200").all(),
    reports:db.prepare(`SELECT r.id,r.reason,r.status,r.created_at AS createdAt,r.message_id AS messageId,
      reporter.username AS reporter, m.body, author.username AS author
      FROM reports r JOIN users reporter ON reporter.id=r.reporter_id
      LEFT JOIN chat_messages m ON m.id=r.message_id LEFT JOIN users author ON author.id=m.sender_id
      ORDER BY CASE r.status WHEN 'open' THEN 0 ELSE 1 END,r.created_at DESC LIMIT 200`).all()
  });
});
app.post("/api/admin/reports/:id/resolve", requireAuth, requireAdmin, (req,res) => {
  db.prepare("UPDATE reports SET status='resolved',reviewed_by=?,reviewed_at=? WHERE id=?").run(req.user.id,Date.now(),clean(req.params.id,64));
  res.json({ ok:true });
});
app.delete("/api/admin/messages/:id", requireAuth, requireAdmin, (req,res) => {
  const message=db.prepare("SELECT id,conversation_id,attachment_id FROM chat_messages WHERE id=?").get(clean(req.params.id,64));
  if (!message) return res.status(404).json({ error:"Nachricht nicht gefunden." });
  db.prepare("UPDATE chat_messages SET deleted_at=?,body='[Nachricht von Moderation entfernt]',attachment_id=NULL WHERE id=?").run(Date.now(),message.id);
  if (message.attachment_id) {
    const attachment=db.prepare("SELECT stored_name FROM attachments WHERE id=?").get(message.attachment_id);
    if (attachment) fs.unlink(path.join(uploadDir,attachment.stored_name),()=>{});
    db.prepare("DELETE FROM attachments WHERE id=?").run(message.attachment_id);
  }
  emitConversation(message.conversation_id,"message-removed",{conversationId:message.conversation_id,messageId:message.id});
  res.json({ ok:true });
});
app.post("/api/admin/users/:id/ban", requireAuth, requireAdmin, (req,res) => {
  const target=clean(req.params.id,64);
  if (target===req.user.id) return res.status(400).json({ error:"Du kannst dein eigenes Konto nicht sperren." });
  db.prepare("UPDATE users SET banned=1 WHERE id=? AND role<>'admin'").run(target);
  db.prepare("DELETE FROM sessions WHERE user_id=?").run(target);
  for (const s of io.sockets.sockets.values()) if (s.data.userId===target) s.disconnect(true);
  res.json({ ok:true });
});
app.use(express.static(path.join(__dirname,"public"),{ etag:true, maxAge:process.env.NODE_ENV==="production"?"1h":0 }));

const alphabet="ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function makeCode() {
  let code;
  do { code=Array.from({length:8},()=>alphabet[crypto.randomInt(alphabet.length)]).join(""); }
  while(db.prepare("SELECT 1 FROM rooms WHERE code=?").get(code));
  return code;
}
function cleanName(value) { return clean(value,24).replace(/\s+/g," "); }
function cleanText(value) { return clean(value,2000); }
app.post("/api/rooms",(req,res)=>{
  const code=makeCode();
  db.prepare("INSERT INTO rooms(code,created_at) VALUES(?,?)").run(code,Date.now());
  res.status(201).json({code});
});
app.get("/api/rooms/:code",(req,res)=>{
  const code=clean(req.params.code,8).toUpperCase();
  res.json({exists:!!db.prepare("SELECT 1 FROM rooms WHERE code=?").get(code)});
});

io.on("connection",socket=>{
  socket.data.recentMessageTimes=[];
  const token=cookieValue({headers:{cookie:socket.handshake.headers.cookie||""}});
  if (token) {
    const user=sessionUser({headers:{cookie:socket.handshake.headers.cookie||""}});
    if (user) {
      socket.data.userId=user.id;
      socket.join("user:"+user.id);
    }
  }
  socket.on("join-conversation",({conversationId}={})=>{
    if (!socket.data.userId || !isMember(clean(conversationId,64),socket.data.userId)) return;
    socket.join("conversation:"+conversationId);
  });
  socket.on("chat-message",({conversationId,text}={})=>{
    const userId=socket.data.userId;
    conversationId=clean(conversationId,64);
    const body=cleanText(text);
    if (!userId || !body || !isMember(conversationId,userId)) return;
    const now=Date.now();
    socket.data.recentMessageTimes=socket.data.recentMessageTimes.filter(t=>now-t<10000);
    if (socket.data.recentMessageTimes.length>=12) { socket.emit("chat-warning","Du sendest sehr schnell. Warte kurz."); return; }
    socket.data.recentMessageTimes.push(now);
    const messageId=id();
    db.prepare("INSERT INTO chat_messages(id,conversation_id,sender_id,body,created_at) VALUES(?,?,?,?,?)").run(messageId,conversationId,userId,body,now);
    const sender=db.prepare("SELECT id,username,display_name AS displayName,avatar_color AS avatarColor FROM users WHERE id=?").get(userId);
    emitConversation(conversationId,"new-chat-message",{conversationId,message:{id:messageId,body,time:now,senderId:userId,sender}});
    const summaryIds=db.prepare("SELECT user_id FROM conversation_members WHERE conversation_id=?").all(conversationId);
    for (const member of summaryIds) io.to("user:"+member.user_id).emit("conversation-activity",{conversationId,time:now,body,sender:sender.username});
  });
  socket.on("join-room",({code,name,clientId}={})=>{
    if(socket.data.roomCode){socket.emit("join-error","Du bist bereits in einem Raum. Lade die Seite neu, um zu wechseln.");return;}
    code=clean(code,8).toUpperCase();name=cleanName(name);clientId=clean(clientId,80);
    if(!/^[A-Z0-9]{8}$/.test(code)||!name||!/^[A-Za-z0-9_-]{8,80}$/.test(clientId)){socket.emit("join-error","Bitte gib einen gültigen Raum-Code und Namen ein.");return;}
    if(!db.prepare("SELECT 1 FROM rooms WHERE code=?").get(code)){socket.emit("join-error","Dieser Raum existiert nicht. Prüfe den Code.");return;}
    socket.data.roomCode=code;socket.data.name=name;socket.data.clientId=clientId;socket.join(code);
    const messages=db.prepare("SELECT id,sender_name AS name,sender_client_id AS clientId,message_text AS text,created_at AS time FROM messages WHERE room_code=? ORDER BY id DESC LIMIT 100").all(code).reverse();
    socket.emit("joined",{code,name,clientId,messages});broadcastUsers(code);
  });
  socket.on("legacy-chat-message",({text}={})=>{
    const code=socket.data.roomCode,name=socket.data.name,clientId=socket.data.clientId;
    const messageText=cleanText(text);
    if(!code||!name||!clientId||!messageText)return;
    const now=Date.now();
    socket.data.recentMessageTimes=socket.data.recentMessageTimes.filter(t=>now-t<10000);
    if(socket.data.recentMessageTimes.length>=12){socket.emit("chat-warning","Du sendest sehr schnell. Warte kurz.");return;}
    socket.data.recentMessageTimes.push(now);
    const result=db.prepare("INSERT INTO messages(room_code,sender_name,sender_client_id,message_text,created_at) VALUES(?,?,?,?,?)").run(code,name,clientId,messageText,now);
    io.to(code).emit("new-message",{id:Number(result.lastInsertRowid),name,clientId,text:messageText,time:now});
  });
  socket.on("disconnect",()=>{if(socket.data.roomCode)broadcastUsers(socket.data.roomCode);});
});

const port=Number(process.env.PORT||3000);
server.listen(port,"0.0.0.0",()=>console.log("NEON Messenger läuft auf Port "+port));
