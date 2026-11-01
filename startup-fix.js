const fs = require("fs");
const path = require("path");

function read(name) {
  return fs.readFileSync(path.join(__dirname, name), "utf8");
}
function write(name, content) {
  fs.writeFileSync(path.join(__dirname, name), content, "utf8");
}

function patchIndex() {
  let s = read("public/index.html");
  if (!s.includes('id="usernameRegister"')) {
    const marker = '<div id="registerFields" class="field hidden"><label for="registerName">ANZEIGENAME</label><input id="registerName" maxlength="24" autocomplete="nickname" placeholder="Wie sollen dich andere sehen?"></div>';
    const replacement = '<div id="registerFields" class="field hidden"><label for="registerName">ANZEIGENAME</label><input id="registerName" name="displayName" maxlength="24" autocomplete="nickname" spellcheck="false" placeholder="Wie sollen dich andere sehen?"></div><div id="registerUsernameField" class="field hidden"><label for="usernameRegister">BENUTZERNAME</label><input id="usernameRegister" name="username" maxlength="24" minlength="3" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" placeholder="z. B. creator"></div>';
    if (s.includes(marker)) s = s.replace(marker, replacement);
  }
  s = s.replace(/<input id="loginName"[^>]*>/, '<input id="loginName" name="email" type="text" required maxlength="254" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" placeholder="du@beispiel.de">');
  write("public/index.html", s);
}

function patchApp() {
  let s = read("public/app.js");
  const setStart = s.indexOf("function setAuthMode(mode) {");
  const setEnd = s.indexOf("\nasync function onAuthSubmit", setStart);
  if (setStart >= 0 && setEnd > setStart) {
    const fn = `function setAuthMode(mode) {
  const register = mode === "register";
  $("loginTab").classList.toggle("active",!register); $("registerTab").classList.toggle("active",register);
  $("registerFields").classList.toggle("hidden",!register);
  $("registerUsernameField")?.classList.toggle("hidden",!register);
  $("authKicker").textContent = register ? "DEIN NEUES KAPITEL" : "WILLKOMMEN ZURÜCK";
  $("authTitle").textContent = register ? "Schön, dich kennenzulernen." : "Schön, dass du da bist.";
  $("authSubtitle").textContent = register ? "Erstelle dein Konto und finde deine Leute." : "Melde dich an und setze deine Gespräche fort.";
  $("authSubmit").innerHTML = register ? 'Konto erstellen <span>↗</span>' : 'Anmelden <span>↗</span>';
  $("loginName").type = register ? "email" : "text";
  $("loginName").autocomplete = register ? "email" : "username";
  $("loginName").name = register ? "email" : "login";
  $("loginName").placeholder = "du@beispiel.de";
  $("password").autocomplete = register ? "new-password" : "current-password";
  $("password").minLength = register ? 10 : 1;
  showError("authError","");
  $("authForm").dataset.mode = mode;
}`;
    s = s.slice(0, setStart) + fn + s.slice(setEnd);
  }

  const authStart = s.indexOf("async function onAuthSubmit(event) {");
  const authEnd = s.indexOf("\nfunction enterMessenger()", authStart);
  if (authStart >= 0 && authEnd > authStart) {
    const fn = `async function onAuthSubmit(event) {
  event.preventDefault(); showError("authError","");
  const register = $("authForm").dataset.mode === "register";
  const login = $("loginName").value.trim();
  const password = $("password").value;
  const button = $("authSubmit"); button.disabled = true;
  try {
    const payload = register
      ? {email:login,username:$("usernameRegister").value.trim(),displayName:$("registerName").value.trim(),password}
      : {login,password};
    if (register) {
      if (!/^[A-Za-z0-9_]{3,24}$/.test(payload.username)) throw new Error("Der Benutzername darf 3–24 Zeichen lang sein und nur Buchstaben, Zahlen oder _ enthalten.");
      if (payload.displayName.length < 2) throw new Error("Dein Anzeigename muss mindestens 2 Zeichen lang sein.");
      if (!/^\\S+@\\S+\\.\\S+$/.test(payload.email)) throw new Error("Bitte gib eine gültige E-Mail-Adresse ein.");
    }
    const result = await api(register ? "/api/auth/register" : "/api/auth/login",{method:"POST",body:JSON.stringify(payload)});
    if(register && result.pendingVerification){showError("authError",result.message);if(result.developmentVerificationUrl){showError("authError",result.message+" Entwicklungslink: "+result.developmentVerificationUrl);} $("resendVerificationBtn").classList.remove("hidden");return;}
    state.user = result.user; enterMessenger(); await refreshConversations(); maybeJoinInviteRoom();
  } catch (error) { showError("authError",error.message); if(error.message.toLowerCase().includes("bestätige zuerst")) $("resendVerificationBtn").classList.remove("hidden"); }
  finally { button.disabled = false; }
}`;
    s = s.slice(0, authStart) + fn + s.slice(authEnd);
  }
  write("public/app.js", s);
}

function patchStyle() {
  let s = read("public/style.css");
  if (!s.includes("NEON AUTOFILL FIX")) {
    s += `\n\n/* NEON AUTOFILL FIX */
.auth-card input:-webkit-autofill,
.auth-card input:-webkit-autofill:hover,
.auth-card input:-webkit-autofill:focus,
.auth-card input:autofill {
  -webkit-text-fill-color: #f7f5ff !important;
  caret-color: #f7f5ff;
  -webkit-box-shadow: 0 0 0 1000px #181722 inset !important;
  box-shadow: 0 0 0 1000px #181722 inset !important;
  border-color: rgba(139,124,255,.65) !important;
}
.auth-card input::placeholder { color: rgba(247,245,255,.38); }
`;
  }
  write("public/style.css", s);
}

patchIndex();
patchApp();
patchStyle();
require("./server.js");
