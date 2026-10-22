const $ = id => document.getElementById(id);

const state = {
  socket: null,
  code: "",
  name: "",
  clientId: "",
  messages: [],
  users: []
};

function showError(text) {
  $("homeError").textContent = text || "";
}

function toast(text) {
  $("toast").textContent = text;
  $("toast").classList.remove("hidden");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => $("toast").classList.add("hidden"), 2400);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#039;"
  }[char]));
}

function getClientId() {
  let id = localStorage.getItem("neon_group_client_id");
  if (!id) {
    id = (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`)
      .replace(/[^A-Za-z0-9_-]/g, "");
    localStorage.setItem("neon_group_client_id", id);
  }
  return id.slice(0, 80);
}

function getInviteLink() {
  return `${location.origin}${location.pathname}?room=${encodeURIComponent(state.code)}`;
}

async function copyInvite() {
  const link = getInviteLink();
  try {
    await navigator.clipboard.writeText(link);
    toast("Einladungslink kopiert.");
  } catch {
    window.prompt("Kopiere diesen Einladungslink:", link);
  }
}

async function createRoom() {
  showError("");
  const name = $("nameInput").value.trim();
  if (!name) {
    showError("Gib zuerst deinen Namen ein.");
    return;
  }

  $("createBtn").disabled = true;
  try {
    const response = await fetch("/api/rooms", { method: "POST" });
    if (!response.ok) throw new Error("Raum konnte nicht erstellt werden.");
    const result = await response.json();
    state.name = name;
    state.code = result.code;
    localStorage.setItem("neon_group_name", name);
    $("createdCode").textContent = result.code;
    $("createdBox").classList.remove("hidden");
    $("joinBox").classList.add("hidden");
    showError("");
  } catch {
    showError("Server nicht erreichbar. Öffne die Website über deinen gehosteten Link.");
  } finally {
    $("createBtn").disabled = false;
  }
}

function enterRoom(rawCode) {
  showError("");
  const name = $("nameInput").value.trim().replace(/\s+/g, " ").slice(0, 24);
  const code = String(rawCode || "").trim().toUpperCase();

  if (!name) {
    showError("Gib zuerst deinen Namen ein.");
    return;
  }
  if (!/^[A-Z0-9]{8}$/.test(code)) {
    showError("Der Raum-Code muss 8 Zeichen haben.");
    return;
  }

  state.name = name;
  state.code = code;
  state.clientId = getClientId();
  localStorage.setItem("neon_group_name", name);

  if (state.socket) state.socket.disconnect();
  state.messages = [];
  state.users = [];

  $("joinBtn").disabled = true;
  $("createBtn").disabled = true;
  state.socket = io();

  state.socket.on("connect", () => {
    state.socket.emit("join-room", {
      code: state.code,
      name: state.name,
      clientId: state.clientId
    });
  });

  state.socket.on("joined", data => {
    state.code = data.code;
    state.name = data.name;
    state.clientId = data.clientId;
    state.messages = Array.isArray(data.messages) ? data.messages : [];

    $("home").classList.add("hidden");
    $("chatScreen").classList.remove("hidden");
    $("roomCodeLabel").textContent = state.code;
    $("myName").textContent = state.name;
    $("messageInput").disabled = false;
    $("sendBtn").disabled = false;
    renderMessages();
    $("messageInput").focus();
  });

  state.socket.on("room-users", users => {
    state.users = Array.isArray(users) ? users : [];
    renderUsers();
  });

  state.socket.on("new-message", message => {
    state.messages.push(message);
    if (state.messages.length > 100) state.messages.shift();
    renderMessages();
  });

  state.socket.on("join-error", message => {
    showError(message);
    $("joinBtn").disabled = false;
    $("createBtn").disabled = false;
  });

  state.socket.on("chat-warning", message => toast(message));

  state.socket.on("disconnect", () => {
    if (!$("chatScreen").classList.contains("hidden")) {
      toast("Verbindung unterbrochen. Versuche erneut zu verbinden …");
    }
  });

  state.socket.on("connect_error", () => {
    showError("Verbindung fehlgeschlagen. Prüfe deine Internetverbindung.");
    $("joinBtn").disabled = false;
    $("createBtn").disabled = false;
  });
}

function renderUsers() {
  const list = $("userList");
  list.innerHTML = "";
  $("onlineCount").textContent = state.users.length;

  for (const user of state.users) {
    const row = document.createElement("div");
    row.className = "user";

    const avatar = document.createElement("div");
    avatar.className = "avatar";
    avatar.textContent = (user.name || "?").trim().slice(0, 1).toUpperCase();

    const name = document.createElement("span");
    name.textContent = user.name + (user.id === state.clientId ? " (du)" : "");

    row.append(avatar, name);
    list.appendChild(row);
  }

  if (!state.users.length) {
    const note = document.createElement("div");
    note.className = "small muted";
    note.textContent = "Noch niemand online.";
    list.appendChild(note);
  }
}

function renderMessages() {
  const box = $("messages");
  box.innerHTML = "";

  if (!state.messages.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    const icon = document.createElement("div");
    icon.className = "empty-icon";
    icon.textContent = "✦";
    const title = document.createElement("h3");
    title.textContent = "Willkommen in deinem Space";
    const paragraph = document.createElement("p");
    paragraph.textContent = "Schreib die erste Nachricht oder lade deine Freunde ein.";
    empty.append(icon, title, paragraph);
    box.appendChild(empty);
    return;
  }

  const dayLabel = document.createElement("div");
  dayLabel.className = "day-label";
  dayLabel.textContent = "NACHRICHTEN IM RAUM";
  box.appendChild(dayLabel);

  for (const message of state.messages) {
    const mine = message.clientId === state.clientId;
    const row = document.createElement("div");
    row.className = "message" + (mine ? " mine" : "");

    const avatar = document.createElement("div");
    avatar.className = "avatar";
    avatar.textContent = (message.name || "?").trim().slice(0, 1).toUpperCase();

    const bubble = document.createElement("div");
    bubble.className = "bubble";

    const sender = document.createElement("div");
    sender.className = "message-name";
    sender.textContent = message.name || "Gast";

    const text = document.createElement("div");
    text.className = "message-text";
    text.textContent = message.text || "";

    const time = document.createElement("div");
    time.className = "message-time";
    time.textContent = new Date(message.time).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit"
    });

    bubble.append(sender, text, time);
    row.append(avatar, bubble);
    box.appendChild(row);
  }

  box.scrollTop = box.scrollHeight;
}

function sendMessage() {
  const input = $("messageInput");
  const text = input.value.trim();
  if (!text || !state.socket || !state.socket.connected) {
    if (!state.socket || !state.socket.connected) toast("Du bist gerade nicht verbunden.");
    return;
  }

  state.socket.emit("chat-message", { text });
  input.value = "";
}

$("createBtn").addEventListener("click", createRoom);
$("showJoinBtn").addEventListener("click", () => {
  $("joinBox").classList.toggle("hidden");
  $("createdBox").classList.add("hidden");
  $("codeInput").focus();
});
$("joinBtn").addEventListener("click", () => enterRoom($("codeInput").value));
$("enterBtn").addEventListener("click", () => enterRoom(state.code));
$("copyBtn").addEventListener("click", copyInvite);
$("copyChatLinkBtn").addEventListener("click", copyInvite);
$("mailBtn").addEventListener("click", () => {
  const subject = encodeURIComponent("Komm in unseren NEON Gruppenchat");
  const body = encodeURIComponent(
    `Hey! Komm in unseren Gruppenchat:\n\n${getInviteLink()}\n\nRaum-Code: ${state.code}`
  );
  location.href = `mailto:?subject=${subject}&body=${body}`;
});
$("messageForm").addEventListener("submit", event => {
  event.preventDefault();
  sendMessage();
});
$("codeInput").addEventListener("input", event => {
  event.target.value = event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
});
$("nameInput").addEventListener("change", () => {
  localStorage.setItem("neon_group_name", $("nameInput").value.trim());
});

const savedName = localStorage.getItem("neon_group_name");
if (savedName) $("nameInput").value = savedName;

const inviteCode = new URLSearchParams(location.search).get("room");
if (inviteCode) {
  $("joinBox").classList.remove("hidden");
  $("codeInput").value = inviteCode.toUpperCase().slice(0, 8);
}
