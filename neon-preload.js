const Module = require("module");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const OriginalLoad = Module._load;
let capturedApp = null;
let capturedIO = null;
let installed = false;

function sessionAdmin(req) {
  try {
    const cookie = String(req.headers.cookie || "").match(/(?:^|;\s*)neon_session=([^;]+)/)?.[1];
    if (!cookie) return null;
    const token = decodeURIComponent(cookie).split(".")[0];
    if (!token) return null;
    const Database = OriginalLoad("better-sqlite3", module, false);
    const dbPath = process.env.DB_PATH || path.join(process.cwd(), "data", "chat.db");
    const db = new Database(dbPath, { readonly: true });
    const row = db.prepare(`SELECT u.id,u.email,u.username,u.display_name AS displayName,u.role,u.banned
      FROM sessions s JOIN users u ON u.id=s.user_id
      WHERE s.token_hash=? AND s.expires_at>?`).get(crypto.createHash("sha256").update(token).digest("hex"), Date.now());
    db.close();
    return row && !row.banned ? row : null;
  } catch (_) { return null; }
}

function install() {
  if (installed || !capturedApp) return;
  installed = true;
  const app = capturedApp;
  app.post("/api/admin/broadcasts", (req, res) => {
    const user = sessionAdmin(req);
    if (!user) return res.status(401).json({ error: "Bitte melde dich erneut an." });
    if (user.role !== "admin") return res.status(403).json({ error: "Nur für Admins." });
    const body = req.body || {};
    const clean = (v, max) => String(v ?? "").normalize("NFKC").replace(/[\\u0000-\\u001f\\u007f]/g, "").trim().slice(0, max);
    const message = clean(body.message, 280);
    if (!message) return res.status(400).json({ error: "Schreibe eine Nachricht für das Live-Event." });
    const payload = {
      id: crypto.randomUUID(),
      title: clean(body.title, 60) || "NEON LIVE",
      message,
      style: ["spotlight","celebrate","alert"].includes(body.style) ? body.style : "spotlight",
      durationMs: Math.max(4000, Math.min(20000, Number(body.durationMs) || 9000)),
      sender: user.displayName || user.username,
      createdAt: Date.now()
    };
    if (capturedIO) capturedIO.emit("global-spotlight", payload);
    res.json({ broadcast: payload });
  });

  app.get("/neon-mega.js", (_req, res) => {
    res.type("application/javascript").send(fs.readFileSync(path.join(process.cwd(), "public", "neon-mega.js"), "utf8"));
  });
  app.get("/neon-mega.css", (_req, res) => {
    res.type("text/css").send(fs.readFileSync(path.join(process.cwd(), "public", "neon-mega.css"), "utf8"));
  });

  const originalUse = app.use;
  const inject = (req, res, next) => {
    const originalEnd = res.end;
    const chunks = [];
    res.write = function(chunk, enc) { if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, enc)); };
    res.end = function(chunk, enc) {
      if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, enc));
      const type = String(res.getHeader("content-type") || "");
      if (type.includes("text/html")) {
        let html = Buffer.concat(chunks).toString("utf8");
        if (!html.includes("/neon-mega.js")) html = html.replace("</head>", '<link rel="stylesheet" href="/neon-mega.css"></head>').replace("</body>", '<script src="/neon-mega.js"></script></body>');
        res.setHeader("content-length", Buffer.byteLength(html));
        return originalEnd.call(res, html, "utf8");
      }
      return originalEnd.call(res, Buffer.concat(chunks));
    };
    next();
  };
  // Put the injector immediately before the first static-file middleware so index.html is decorated.
  const stack = app._router?.stack || [];
  const staticIndex = stack.findIndex(layer => String(layer.name || "").toLowerCase().includes("static"));
  if (staticIndex >= 0) stack.splice(staticIndex, 0, { route: undefined, name: "neonMegaInject", handle: inject });
  else app.use(inject);
}

Module._load = function(request, parent, isMain) {
  const loaded = OriginalLoad.apply(this, arguments);
  if (request === "express" && typeof loaded === "function" && !loaded.__neonWrapped) {
    const wrapped = function() {
      capturedApp = loaded.apply(this, arguments);
      setImmediate(install);
      return capturedApp;
    };
    Object.setPrototypeOf(wrapped, loaded);
    Object.assign(wrapped, loaded);
    wrapped.__neonWrapped = true;
    return wrapped;
  }
  if (request === "socket.io" && loaded?.Server && !loaded.__neonWrapped) {
    const OriginalServer = loaded.Server;
    class NeonServer extends OriginalServer {
      constructor(...args) { super(...args); capturedIO = this; }
    }
    loaded.Server = NeonServer;
    loaded.__neonWrapped = true;
  }
  return loaded;
};
