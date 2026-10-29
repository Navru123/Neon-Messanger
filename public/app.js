const $ = id => document.getElementById(id);
const state = {
  user: null, socket: null, conversations: [], activeConversation: null,
  messages: [], users: [], selectedUsers: new Set(), groupMode: false,
  filter: "all", selectedColor: "#8b7cff", lastMessageId: null, toastTimer: null,
  roomCode: "", roomMessages: [], roomUsers: [], accountAction: null, accountToken: null
};
const COLORS = ["#8b7cff","#48c6ef","#f59eae","#55d6a7","#f3b562","#fb7185","#60a5fa"];
const views = ["welcomeView","chatView","peopleView","eventsView","profileView","adminView"];

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}
function shortTime(time) {
  if (!time) return "";
  const date = new Date(Number(time));
  const today = new Date();
  if (date.toDateString() === today.toDateString()) return date.toLocaleTimeString("de-DE",{hour:"2-digit",minute:"2-digit"});
  return date.toLocaleDateString("de-DE",{day:"2-digit",month:"2-digit"});
}
function avatarMarkup(user, extra = "") {
  const name = user?.displayName || user?.display_name || user?.username || "?";
  const color = COLORS.includes(user?.avatarColor || user?.avatar_color) ? (user.avatarColor || user.avatar_color) : "#8b7cff";
  const avatarUrl=user?.avatarUrl||user?.avatar_url;
  return '<div class="avatar '+extra+'" style="--avatar-color:'+color+'">'+(avatarUrl?'<img src="'+escapeHtml(avatarUrl)+'" alt="" loading="lazy">':escapeHtml(name.slice(0,1).toUpperCase()))+'</div>';
}
function showToast(message) {
  const toast = $("toast"); toast.textContent = message; toast.classList.remove("hidden");
  clearTimeout(state.toastTimer); state.toastTimer = setTimeout(()=>toast.classList.add("hidden"),2800);
}
function showError(id,message) { $(id).textContent = message || ""; }
async function api(url, options = {}) {
  const headers = new Headers(options.headers || {});
  if (options.body && !(options.body instanceof FormData)) headers.set("Content-Type","application/json");
  const response = await fetch(url,{...options,headers,credentials:"same-origin"});
  const data = await response.json().catch(()=>({error:"Ungültige Serverantwort."}));
  if (!response.ok) throw new Error(data.error || "Die Anfrage ist fehlgeschlagen.");
  return data;
}
function setAuthMode(mode) {
  const register = mode === "register";
  $("loginTab").classList.toggle("active",!register); $("registerTab").classList.toggle("active",register);
  $("registerFields").classList.toggle("hidden",!register);
  $("authKicker").textContent = register ? "DEIN NEUES KAPITEL" : "WILLKOMMEN ZURÜCK";
  $("authTitle").textContent = register ? "Schön, dich kennenzulernen." : "Schön, dass du da bist.";
  $("authSubtitle").textContent = register ? "Erstelle dein Konto und finde deine Leute." : "Melde dich an und setze deine Gespräche fort.";
  $("authSubmit").innerHTML = register ? 'Konto erstellen <span>↗</span>' : 'Anmelden <span>↗</span>';
  $("loginName").autocomplete = register ? "email" : "username";
  $("loginLabel").textContent = register ? "E-MAIL-ADRESSE" : "E-MAIL ODER BENUTZERNAME";
  $("loginName").placeholder = register ? "du@beispiel.de" : "du@beispiel.de";
  $("password").autocomplete = register ? "new-password" : "current-password";
  $("password").minLength = register ? 10 : 1;
  showError("authError","");
  $("authForm").dataset.mode = mode;
}
async function onAuthSubmit(event) {
  event.preventDefault(); showError("authError","");
  const register = $("authForm").dataset.mode === "register";
  const login = $("loginName").value.trim();
  const password = $("password").value;
  const button = $("authSubmit"); button.disabled = true;
  try {
    const payload = register
      ? {email:login,username:login.includes("@") ? "" : login,displayName:$("registerName").value.trim(),password}
      : {login,password};
    if (register) {
      // Registration uses a dedicated username field: the login input is the email.
      payload.email = login;
      payload.username = $("usernameRegister")?.value?.trim() || "";
      if (!payload.username) {
        const existing = $("registerName").value.trim();
        payload.username = existing.toLowerCase().replace(/[^a-z0-9_]/g,"").slice(0,24);
      }
      payload.displayName = $("registerName").value.trim();
      if (!payload.username || payload.username.length < 3) throw new Error("Bitte verwende für den Benutzernamen mindestens 3 Buchstaben, Zahlen oder _.");
      if (payload.displayName.length < 2) throw new Error("Dein Anzeigename muss mindestens 2 Zeichen lang sein.");
    }
    const result = await api(register ? "/api/auth/register" : "/api/auth/login",{method:"POST",body:JSON.stringify(payload)});
    if(register && result.pendingVerification){showError("authError",result.message);if(result.developmentVerificationUrl){showError("authError",result.message+" Entwicklungslink: "+result.developmentVerificationUrl);} $("resendVerificationBtn").classList.remove("hidden");return;}
    state.user = result.user; enterMessenger(); await refreshConversations(); maybeJoinInviteRoom();
  } catch (error) { showError("authError",error.message); if(error.message.toLowerCase().includes("bestätige zuerst")) $("resendVerificationBtn").classList.remove("hidden"); }
  finally { button.disabled = false; }
}
function enterMessenger() {
  $("authScreen").classList.add("hidden"); $("messenger").classList.remove("hidden");
  if (state.user.role === "admin") $("adminRail").classList.remove("hidden");
  else $("adminRail").classList.add("hidden");
  renderUserProfile(); connectSocket(); showView("chats");
}
function connectSocket() {
  if (state.socket) state.socket.disconnect();
  state.socket = io({transports:["websocket","polling"]});
  state.socket.on("connect",()=>{});
  state.socket.on("joined",data=>{
    state.roomCode=data.code;state.roomMessages=Array.isArray(data.messages)?data.messages:[];state.roomUsers=[];
    $("legacyRoomPanel").classList.remove("hidden");$("legacyRoomCode").textContent=data.code;
    showError("roomError","");renderLegacyRoomMessages();
  });
  state.socket.on("room-users",users=>{state.roomUsers=Array.isArray(users)?users:[];renderLegacyRoomUsers();});
  state.socket.on("new-message",message=>{
    if(!state.roomCode)return;
    if(!state.roomMessages.some(m=>m.id===message.id))state.roomMessages.push(message);
    if(state.roomMessages.length>100)state.roomMessages.shift();
    renderLegacyRoomMessages();
  });
  state.socket.on("join-error",message=>showError("roomError",message));

  state.socket.on("new-chat-message",payload=>{
    if (!payload?.message || !payload.conversationId) return;
    if (state.activeConversation?.id === payload.conversationId) {
      if (!state.messages.some(m=>m.id===payload.message.id)) state.messages.push(payload.message);
      renderMessages();
    }
    updateConversationPreview(payload.conversationId,payload.message);
  });
  state.socket.on("conversation-activity",payload=>updateConversationActivity(payload));
  // Show newly created conversations immediately when someone starts a chat with this user.
  state.socket.on("conversation-updated",()=>refreshConversations());
  state.socket.on("message-removed",payload=>{
    if (state.activeConversation?.id===payload.conversationId) {
      state.messages=state.messages.filter(m=>m.id!==payload.messageId); renderMessages();
    }
    showToast("Eine Nachricht wurde von der Moderation entfernt.");
  });
  state.socket.on("chat-warning",message=>showToast(message));
  state.socket.on("connect_error",()=>showToast("Verbindung wird erneut aufgebaut …"));
}
function renderUserProfile() {
  const user=state.user;if(!user)return;
  $("footerName").textContent=user.displayName||user.username;
  $("footerHandle").textContent="@"+user.username;
  $("footerAvatar").innerHTML=user.avatarUrl?'<img src="'+escapeHtml(user.avatarUrl)+'" alt="">':escapeHtml((user.displayName||user.username||"N").slice(0,1).toUpperCase());
  $("footerAvatar").style.setProperty("--avatar-color",user.avatarColor||"#8b7cff");
  $("railAvatar").innerHTML=user.avatarUrl?'<img src="'+escapeHtml(user.avatarUrl)+'" alt="">':escapeHtml((user.displayName||user.username||"N").slice(0,1).toUpperCase());
  $("railAvatar").style.setProperty("--avatar-color",user.avatarColor||"#8b7cff");
  $("profileAvatar").innerHTML=user.avatarUrl?'<img src="'+escapeHtml(user.avatarUrl)+'" alt="">':escapeHtml((user.displayName||user.username||"N").slice(0,1).toUpperCase());
  $("profileAvatar").style.setProperty("--avatar-color",user.avatarColor||"#8b7cff");
  $("profileUsername").textContent="@"+user.username;$("profileEmail").textContent=user.email||"Dein NEON-Konto";
  $("displayName").value=user.displayName||user.username;
  state.selectedColor=user.avatarColor||"#8b7cff";
  document.querySelectorAll(".color-option").forEach(b=>b.classList.toggle("selected",b.dataset.color===state.selectedColor));
}
function showView(view) {
  document.querySelectorAll(".rail-button").forEach(b=>b.classList.toggle("active",b.dataset.view===view));
  if (window.matchMedia("(max-width: 650px)").matches) {
    $("chatListPanel").classList.toggle("compact-hidden",["chat","rooms","people","events","profile","admin"].includes(view));
    $("contentArea").classList.toggle("show-chat",view==="chat");
    $("contentArea").classList.toggle("show-utility",["rooms","people","events","profile","admin"].includes(view));
  }
  views.forEach(id=>$(id).classList.add("hidden"));
  if(view==="chats") {
    $("contentArea").classList.remove("show-chat","show-utility");
    if(state.activeConversation) { $("chatView").classList.remove("hidden"); $("welcomeView").classList.add("hidden"); }
    else $("welcomeView").classList.remove("hidden");
  } else if(view==="chat") {
    $("welcomeView").classList.add("hidden");$("chatView").classList.remove("hidden");
  } else if(view==="rooms") $("roomsView").classList.remove("hidden");
  else if(view==="people") $("peopleView").classList.remove("hidden");
  else if(view==="events") { $("eventsView").classList.remove("hidden"); loadEvents(); }
  else if(view==="profile") $("profileView").classList.remove("hidden");
  else if(view==="admin") { $("adminView").classList.remove("hidden"); loadAdmin(); }
}
function maybeJoinInviteRoom() {
  const code=new URLSearchParams(location.search).get("room");
  if(code && /^[A-Za-z0-9]{8}$/.test(code)) {
    showView("rooms");$("roomCodeInput").value=code.toUpperCase();joinLegacyRoom(code);
  }
}
async function refreshConversations() {
  try {
    const result=await api("/api/conversations");state.conversations=result.conversations||[];renderConversationList();
  } catch(error) { if(error.message.includes("anmelden")) return logout(false); showToast(error.message); }
}
function renderConversationList() {
  const list=$("conversationList"), query=$("chatSearch").value.trim().toLowerCase();
  const rows=state.conversations.filter(c=>(state.filter==="all"||c.kind===state.filter)&&(!query||(c.title+" "+(c.lastMessage?.body||"")).toLowerCase().includes(query)));
  if(!rows.length) {list.innerHTML='<div class="empty-list">Noch keine passenden Chats.<br>Starte ein neues Gespräch mit ＋</div>';return;}
  list.innerHTML=rows.map(c=>{
    const active=state.activeConversation?.id===c.id;
    const title=c.kind==="group"?c.title:(c.title||"Direktchat");
    const incoming=!!c.lastMessage && c.lastMessage.sender!==state.user.username;
    const preview=c.lastMessage ? (incoming ? "Neue Nachricht von @"+c.lastMessage.sender+": " : (c.lastMessage.sender===state.user.username?"Du: ":"@"+c.lastMessage.sender+": "))+(c.lastMessage.body||"Datei") : (c.kind==="group"?"Gruppe · "+c.members.length+" Mitglieder":"Noch keine Nachrichten");
    return '<button class="conversation-item '+(active?"active":"")+'" data-conversation="'+escapeHtml(c.id)+'">'+
      avatarMarkup(c.kind==="group"?{displayName:title,avatarColor:"#a998ff"}:(c.members.find(m=>m.id!==state.user.id)||{displayName:title,avatarColor:"#8b7cff"}))+
      '<span class="conversation-copy"><span class="conversation-top"><b>'+escapeHtml(title)+'</b><time>'+escapeHtml(shortTime(c.lastMessage?.time))+'</time></span><span class="conversation-preview">'+escapeHtml(preview)+'</span></span></button>';
  }).join("");
}
async function openConversation(id) {
  const conversation=state.conversations.find(c=>c.id===id);if(!conversation)return;
  state.activeConversation=conversation;state.messages=[];
  renderConversationList();
  $("welcomeView").classList.add("hidden");$("chatView").classList.remove("hidden");
  $("activeTitle").textContent=conversation.title;
  $("activeSubtitle").textContent=conversation.kind==="group"?"Gruppe · "+conversation.members.length+" Mitglieder":"Privater Chat";
  const avatarUser=conversation.kind==="group"?{displayName:conversation.title,avatarColor:"#a998ff"}:(conversation.members.find(m=>m.id!==state.user.id)||state.user);
  $("activeAvatar").textContent=(avatarUser.displayName||avatarUser.username||"N").slice(0,1).toUpperCase();
  $("activeAvatar").style.setProperty("--avatar-color",avatarUser.avatarColor||"#8b7cff");
  $("messageInput").disabled=false;$("sendButton").disabled=false;
  if(state.socket?.connected)state.socket.emit("join-conversation",{conversationId:id});
  if(window.matchMedia("(max-width: 650px)").matches)showView("chat");
  $("messageStream").innerHTML='<div class="loading-state">Nachrichten werden geladen …</div>';
  try {
    const result=await api("/api/conversations/"+encodeURIComponent(id)+"/messages");
    if(state.activeConversation?.id!==id)return;
    state.messages=result.messages||[];renderMessages();
  } catch(error){$("messageStream").innerHTML='<div class="stream-empty">'+escapeHtml(error.message)+'</div>';}
}
function renderMessages() {
  const stream=$("messageStream");
  if(!state.messages.length){stream.innerHTML='<div class="stream-empty"><strong>Der Anfang von etwas Gutem.</strong>Schreib eine Nachricht, um das Gespräch zu starten.</div>';return;}
  stream.innerHTML=state.messages.map(m=>{
    const sender=m.sender||{username:"Unbekannt",displayName:"Unbekannt",avatarColor:"#8b7cff"};
    const mine=m.senderId===state.user.id;
    const attachment=m.attachment?'<a class="attachment-link" href="'+escapeHtml(m.attachment.url||("/api/attachments/"+m.attachment.id))+'" target="_blank" rel="noopener">↧ '+escapeHtml(m.attachment.name)+' <small>('+Math.max(1,Math.round(m.attachment.size/1024))+' KB)</small></a>':"";
    return '<article class="message-row '+(mine?"mine":"")+'">'+avatarMarkup(sender)+
      '<div class="message-body"><div class="message-meta"><b>'+escapeHtml(sender.displayName||sender.username)+'</b><time>'+escapeHtml(shortTime(m.time))+'</time></div>'+
      '<div class="message-bubble">'+escapeHtml(m.body||"")+(attachment?'<br>'+attachment:"")+'</div>'+
      (!mine?'<button class="report-button" data-report="'+escapeHtml(m.id)+'">Nachricht melden</button>':"")+'</div></article>';
  }).join("");
  stream.scrollTop=stream.scrollHeight;
}
async function sendMessage(event) {
  event.preventDefault();const input=$("messageInput"),body=input.value.trim(),conv=state.activeConversation;
  if(!body||!conv||!state.socket?.connected)return;
  state.socket.emit("chat-message",{conversationId:conv.id,text:body});input.value="";input.style.height="auto";
}
async function uploadFile(file) {
  if(!file||!state.activeConversation)return;
  const allowed=["image/jpeg","image/png","image/gif","image/webp","application/pdf","text/plain"];
  if(!allowed.includes(file.type)){showToast("Dieser Dateityp ist nicht erlaubt.");$("fileInput").value="";return;}
  if(file.size>8*1024*1024){showToast("Dateien dürfen höchstens 8 MB groß sein.");$("fileInput").value="";return;}
  const form=new FormData();form.append("file",file);
  $("chatNotice").textContent="Datei wird hochgeladen …";$("chatNotice").classList.remove("hidden");
  try {const result=await api("/api/conversations/"+encodeURIComponent(state.activeConversation.id)+"/upload",{method:"POST",body:form});if(!state.messages.some(m=>m.id===result.message.id))state.messages.push(result.message);renderMessages();showToast("Datei gesendet.");}
  catch(error){showToast(error.message);}
  finally{$("chatNotice").classList.add("hidden");$("fileInput").value="";}
}
function updateConversationPreview(conversationId,message) {
  const c=state.conversations.find(x=>x.id===conversationId);if(!c)return;
  c.lastMessage={body:message.body||"Datei",time:message.time,sender:message.sender?.username||""};
  state.conversations.sort((a,b)=>(b.lastMessage?.time||0)-(a.lastMessage?.time||0));renderConversationList();
}
function updateConversationActivity(payload) {
  if(!payload)return;const c=state.conversations.find(x=>x.id===payload.conversationId);if(!c)return;
  c.lastMessage={body:payload.body||"",time:payload.time,sender:payload.sender||""};
  state.conversations.sort((a,b)=>(b.lastMessage?.time||0)-(a.lastMessage?.time||0));renderConversationList();
}
let peopleTimer=null;
async function searchUsers(query,targetId,mode) {
  const target=$(targetId);if(query.trim().length<2){target.innerHTML=mode==="main"?'<p class="muted-copy">Suche nach einem Namen, um loszulegen.</p>':"";return;}
  try {
    const result=await api("/api/users?q="+encodeURIComponent(query.trim()));
    if(!result.users.length){target.innerHTML='<p class="muted-copy">Keine passenden Konten gefunden.</p>';return;}
    target.innerHTML=result.users.map(u=>{
      const selected=state.selectedUsers.has(u.id);
      return '<button type="button" class="'+(mode==="main"?"person-row":"dialog-person")+(selected?" selected":"")+'" data-user="'+escapeHtml(u.id)+'">'+avatarMarkup(u)+
        '<span class="person-info"><b>'+escapeHtml(u.displayName||u.username)+'</b><span>@'+escapeHtml(u.username)+'</span></span>'+
        (mode==="main"?'<span class="button button-secondary">Chat starten ↗</span>':(state.groupMode?'<span>'+ (selected?"✓":"＋")+'</span>':""))+'</button>';
    }).join("");
  }catch(error){target.innerHTML='<p class="muted-copy">'+escapeHtml(error.message)+'</p>';}
}
function openNewChat() {
  state.selectedUsers.clear();state.groupMode=false;
  $("groupOptions").classList.add("hidden");$("groupModeBtn").textContent="Gruppe erstellen";
  $("dialogSearch").value="";$("dialogResults").innerHTML="";$("groupTitle").value="";
  $("dialogSubmit").disabled=true;showError("dialogError","");
  $("newChatDialog").showModal();$("dialogSearch").focus();
}
async function createConversation(event) {
  event.preventDefault();showError("dialogError","");
  const ids=[...state.selectedUsers];
  if(!state.groupMode&&ids.length!==1){showError("dialogError","Wähle eine Person aus.");return;}
  if(state.groupMode&&ids.length<2){showError("dialogError","Wähle mindestens zwei Personen für eine Gruppe.");return;}
  const title=$("groupTitle").value.trim();
  if(state.groupMode&&title.length<2){showError("dialogError","Gib einen Gruppennamen mit mindestens 2 Zeichen ein.");return;}
  try{
    const result=await api("/api/conversations",{method:"POST",body:JSON.stringify({kind:state.groupMode?"group":"direct",members:ids,title})});
    $("newChatDialog").close();await refreshConversations();
    if(!state.conversations.some(c=>c.id===result.conversation.id))state.conversations.unshift(result.conversation);
    renderConversationList();await openConversation(result.conversation.id);showToast("Chat ist bereit.");
  }catch(error){showError("dialogError",error.message);}
}
function joinLegacyRoom(rawCode) {
  const code=String(rawCode||"").trim().toUpperCase();
  if(!/^[A-Z0-9]{8}$/.test(code)){showError("roomError","Der Raumcode muss genau 8 Zeichen haben.");return;}
  if(!state.socket){showError("roomError","Die Verbindung ist noch nicht bereit.");return;}
  showError("roomError","");
  if(state.roomCode)state.socket.emit("leave-room");
  state.roomCode=code;state.roomMessages=[];state.roomUsers=[];
  $("legacyRoomPanel").classList.remove("hidden");$("legacyRoomCode").textContent=code;
  $("legacyRoomMessages").innerHTML="<div class=\"loading-state\">Raumnachrichten werden geladen …</div>";
  state.socket.emit("join-room",{code,name:state.user.displayName||state.user.username,clientId:state.user.id.replace(/[^A-Za-z0-9_-]/g,"").slice(0,80)});
}
function renderLegacyRoomMessages(){
  const box=$("legacyRoomMessages");if(!box)return;
  if(!state.roomMessages.length){box.innerHTML="<div class=\"stream-empty\"><strong>Der Raum ist bereit.</strong>Schreib die erste Nachricht oder lade deine Leute ein.</div>";return;}
  box.innerHTML="";
  for(const m of state.roomMessages){
    const row=document.createElement("div");row.className="legacy-message";
    const head=document.createElement("div");head.className="legacy-message-head";
    const name=document.createElement("b");name.textContent=m.name||"Unbekannt";
    const time=document.createElement("time");time.textContent=shortTime(m.time);
    const body=document.createElement("p");body.textContent=m.text||"";
    head.append(name,time);row.append(head,body);box.appendChild(row);
  }
  box.scrollTop=box.scrollHeight;
}
function renderLegacyRoomUsers(){
  $("legacyOnlineCount").textContent=state.roomUsers.length;
  const box=$("legacyRoomUsers");box.innerHTML="";
  for(const user of state.roomUsers){
    const chip=document.createElement("span");chip.className="legacy-user";
    chip.textContent=user.name+(user.id===state.user.id?" (du)":"");box.appendChild(chip);
  }
}
async function createLegacyRoom(){
  showError("roomError","");
  try{const result=await api("/api/rooms",{method:"POST",body:JSON.stringify({})});$("roomCodeInput").value=result.code;joinLegacyRoom(result.code);showToast("Raum erstellt. Teile den Code mit deiner Crew.");}
  catch(error){showError("roomError",error.message);}
}
async function copyLegacyRoomInvite(){
  if(!state.roomCode)return;
  const link=location.origin+location.pathname+"?room="+encodeURIComponent(state.roomCode);
  try{await navigator.clipboard.writeText(link);showToast("Einladungslink kopiert.");}
  catch{window.prompt("Kopiere diesen Einladungslink:",link);}
}
function sendLegacyRoomMessage(event){
  event.preventDefault();const input=$("legacyRoomMessage"),text=input.value.trim();
  if(!text||!state.roomCode||!state.socket?.connected){showToast("Du bist gerade nicht verbunden.");return;}
  state.socket.emit("chat-message",{text});input.value="";
}
function showAccountAction(mode){
  state.accountAction=mode;state.accountToken=new URLSearchParams(location.search).get(mode==="reset"?"reset":"verify");
  $("accountActionPanel").classList.remove("hidden");$("accountActionMessage").textContent="";
  $("resetPasswordField").classList.toggle("hidden",mode!=="reset");
  $("accountActionLabel").textContent=mode==="reset"?"E-MAIL-ADRESSE":"E-MAIL-ADRESSE";
  $("accountActionSubmit").textContent=mode==="reset"?"Passwort ändern":mode==="verify"?"E-Mail bestätigen":mode==="resend"?"Link erneut senden":"Link anfordern";
  if(mode==="reset"){$("accountActionLabel").textContent="NEUES PASSWORT";$("accountActionInput").classList.add("hidden");}
  else $("accountActionInput").classList.remove("hidden");
  $("accountActionPanel").scrollIntoView({behavior:"smooth",block:"center"});
}
async function submitAccountAction(){
  const mode=state.accountAction;
  try{
    let result;
    if(mode==="verify")result=await api("/api/auth/verify",{method:"POST",body:JSON.stringify({token:state.accountToken})});
    else if(mode==="reset")result=await api("/api/auth/reset-password",{method:"POST",body:JSON.stringify({token:state.accountToken,password:$("resetPasswordInput").value})});
    else if(mode==="resend")result=await api("/api/auth/resend-verification",{method:"POST",body:JSON.stringify({email:$("accountActionInput").value.trim()})});
    else result=await api("/api/auth/forgot-password",{method:"POST",body:JSON.stringify({email:$("accountActionInput").value.trim()})});
    $("accountActionMessage").textContent=result.message||"Fertig.";
    if(result.developmentVerificationUrl||result.developmentResetUrl)$("accountActionMessage").textContent+=" Entwicklungslink: "+(result.developmentVerificationUrl||result.developmentResetUrl);
    if(mode==="verify"||mode==="reset"){history.replaceState(null,"",location.pathname);$("accountActionSubmit").textContent="Erledigt";}
  }catch(error){$("accountActionMessage").textContent=error.message;}
}
async function uploadAvatar(file){
  if(!file)return;
  if(file.size>2*1024*1024){showError("avatarError","Das Bild darf höchstens 2 MB groß sein.");return;}
  const form=new FormData();form.append("avatar",file);
  try{const result=await api("/api/profile/avatar",{method:"POST",body:form});state.user={...state.user,...result.user};renderUserProfile();await refreshConversations();showError("avatarError","");showToast("Profilbild gespeichert.");}
  catch(error){showError("avatarError",error.message);}
  finally{$("avatarInput").value="";}
}
async function saveProfile(event) {
  event.preventDefault();showError("profileError","");
  try{
    const result=await api("/api/profile",{method:"PATCH",body:JSON.stringify({displayName:$("displayName").value.trim(),avatarColor:state.selectedColor})});
    state.user={...state.user,...result.user};renderUserProfile();await refreshConversations();showToast("Profil gespeichert.");
  }catch(error){showError("profileError",error.message);}
}
async function showChatInfo() {
  const c=state.activeConversation;if(!c)return;
  $("infoTitle").textContent=c.title;
  $("infoDescription").textContent=c.kind==="group"?"Gruppenchat mit "+c.members.length+" Mitgliedern.":"Privates Gespräch. Nur die beiden Teilnehmenden können die Nachrichten sehen.";
  $("infoMembers").innerHTML=c.members.map(m=>'<div class="member-row">'+avatarMarkup(m,'avatar-small')+'<span>'+escapeHtml(m.displayName||m.username)+(m.id===state.user.id?" (du)":"")+'</span></div>').join("");
  $("infoDialog").showModal();
}
async function reportMessage(messageId) {
  const reason=window.prompt("Warum möchtest du diese Nachricht melden? (Optional)");
  if(reason===null)return;
  try{await api("/api/messages/"+encodeURIComponent(messageId)+"/report",{method:"POST",body:JSON.stringify({reason})});showToast("Danke. Die Meldung wurde an die Moderation gesendet.");}
  catch(error){showToast(error.message);}
}
async function loadAdmin() {
  if(state.user?.role!=="admin")return;
  const container=$("adminContent");container.innerHTML='<p class="muted-copy">Moderationsdaten werden geladen …</p>';
  try{
    const data=await api("/api/admin/overview");
    const reports=(data.reports||[]).map(r=>'<div class="admin-item"><div class="admin-item-main"><b>'+escapeHtml(r.author||"Gelöschter Autor")+' · '+escapeHtml(r.status)+'</b><p>'+escapeHtml(r.body||"[Nachricht nicht verfügbar]")+'</p><p>'+escapeHtml(r.reason)+'</p><small>Gemeldet von '+escapeHtml(r.reporter)+' · '+escapeHtml(shortTime(r.createdAt))+'</small></div><div class="admin-actions">'+(r.messageId?'<button class="button button-secondary" data-admin-delete="'+escapeHtml(r.messageId)+'">Nachricht entfernen</button>':"")+(r.status==="open"?'<button class="button button-primary" data-resolve="'+escapeHtml(r.id)+'">Erledigen</button>':"")+'</div></div>').join("");
    const users=(data.users||[]).map(u=>'<div class="admin-item"><div class="admin-item-main"><b>'+escapeHtml(u.displayName||u.username)+' (@'+escapeHtml(u.username)+')</b><p>'+escapeHtml(u.email)+' · '+escapeHtml(u.role)+(u.banned?" · gesperrt":"")+'</p></div><div class="admin-actions">'+(!u.banned&&u.role!=="admin"?'<button class="button button-secondary" data-ban="'+escapeHtml(u.id)+'">Konto sperren</button>':"")+'</div></div>').join("");
    container.innerHTML='<section class="admin-section"><h3>Meldungen ('+(data.reports||[]).filter(r=>r.status==="open").length+' offen)</h3>'+(reports||'<p class="muted-copy" style="padding:16px">Keine Meldungen vorhanden.</p>')+'</section><section class="admin-section"><h3>Konten ('+(data.users||[]).length+')</h3>'+(users||'<p class="muted-copy" style="padding:16px">Keine Konten vorhanden.</p>')+'</section>';
  }catch(error){container.innerHTML='<p class="form-error">'+escapeHtml(error.message)+'</p>';}
}
function formatEventDate(value) {
  return new Date(Number(value)).toLocaleString("de-DE",{weekday:"short",day:"2-digit",month:"long",year:"numeric",hour:"2-digit",minute:"2-digit"});
}
async function loadEvents() {
  const container=$("eventsList");
  if(state.user?.role==="admin") $("eventForm").classList.remove("hidden");
  else $("eventForm").classList.add("hidden");
  container.innerHTML='<p class="muted-copy">Events werden geladen …</p>';
  try {
    const data=await api("/api/events");
    const events=data.events||[];
    container.innerHTML='<section class="admin-section"><h3>Kommende Events ('+events.length+')</h3>'+
      (events.length?events.map(e=>'<article class="admin-item"><div class="admin-item-main"><b>'+escapeHtml(e.title)+'</b><p>'+escapeHtml(formatEventDate(e.startsAt))+'</p>'+(e.location?'<p>📍 '+escapeHtml(e.location)+'</p>':'')+(e.description?'<p>'+escapeHtml(e.description)+'</p>':'')+'<small>Veranstaltet von @'+escapeHtml(e.host)+'</small></div>'+(state.user?.role==="admin"?'<div class="admin-actions"><button class="button button-secondary" data-event-cancel="'+escapeHtml(e.id)+'">Event absagen</button></div>':'')+'</article>').join(""):'<p class="muted-copy" style="padding:16px">Noch keine kommenden Events. Schau später wieder vorbei.</p>')+'</section>';
  } catch(error) {container.innerHTML='<p class="form-error">'+escapeHtml(error.message)+'</p>';}
}
async function createEvent(event) {
  event.preventDefault(); showError("eventError","");
  const button=$("eventForm").querySelector('button[type="submit"]');button.disabled=true;
  try {
    await api("/api/admin/events",{method:"POST",body:JSON.stringify({
      title:$("eventTitle").value.trim(),description:$("eventDescription").value.trim(),
      location:$("eventLocation").value.trim(),startsAt:$("eventDate").value
    })});
    $("eventForm").reset();showToast("Event veröffentlicht.");await loadEvents();
  } catch(error) {showError("eventError",error.message);}
  finally {button.disabled=false;}
}
async function adminAction(button) {
  try{
    if(button.dataset.eventCancel){if(!confirm("Dieses Event wirklich absagen?"))return;await api("/api/admin/events/"+encodeURIComponent(button.dataset.eventCancel),{method:"DELETE"});showToast("Event abgesagt.");await loadEvents();}
    else if(button.dataset.resolve){await api("/api/admin/reports/"+encodeURIComponent(button.dataset.resolve)+"/resolve",{method:"POST",body:JSON.stringify({})});showToast("Meldung erledigt.");}
    else if(button.dataset.adminDelete){if(!confirm("Diese Nachricht wirklich entfernen?"))return;await api("/api/admin/messages/"+encodeURIComponent(button.dataset.adminDelete),{method:"DELETE"});showToast("Nachricht entfernt.");}
    else if(button.dataset.ban){if(!confirm("Dieses Konto sperren? Die Person wird abgemeldet."))return;await api("/api/admin/users/"+encodeURIComponent(button.dataset.ban)+"/ban",{method:"POST",body:JSON.stringify({})});showToast("Konto gesperrt.");}
    await loadAdmin();
  }catch(error){showToast(error.message);}
}
async function logout(showMessage=true) {
  try{await api("/api/auth/logout",{method:"POST",body:JSON.stringify({})});}catch{}
  state.socket?.disconnect();state.user=null;state.conversations=[];state.activeConversation=null;state.messages=[];
  $("messenger").classList.add("hidden");$("authScreen").classList.remove("hidden");setAuthMode("login");
  if(showMessage)showToast("Du wurdest abgemeldet.");
}

$("loginTab").addEventListener("click",()=>setAuthMode("login"));
$("registerTab").addEventListener("click",()=>{
  setAuthMode("register");
  if(!$("usernameRegister")){
    const field=document.createElement("div");field.className="field";field.id="usernameRegisterField";
    field.innerHTML='<label for="usernameRegister">BENUTZERNAME</label><input id="usernameRegister" required minlength="3" maxlength="24" autocomplete="username" placeholder="z. B. neon_fan">';
    $("registerFields").appendChild(field);
  }
});
$("authForm").addEventListener("submit",onAuthSubmit);
$("chatSearch").addEventListener("input",renderConversationList);
document.querySelectorAll(".list-tab").forEach(b=>b.addEventListener("click",()=>{state.filter=b.dataset.filter;document.querySelectorAll(".list-tab").forEach(x=>x.classList.toggle("active",x===b));renderConversationList();}));
$("conversationList").addEventListener("click",e=>{const b=e.target.closest("[data-conversation]");if(b)openConversation(b.dataset.conversation);});
$("newChatBtn").addEventListener("click",openNewChat);$("welcomeNewChat").addEventListener("click",openNewChat);
$("closeDialog").addEventListener("click",()=>$("newChatDialog").close());
$("groupModeBtn").addEventListener("click",()=>{
  state.groupMode=!state.groupMode;state.selectedUsers.clear();$("groupOptions").classList.toggle("hidden",!state.groupMode);
  $("groupModeBtn").textContent=state.groupMode?"Direktchat starten":"Gruppe erstellen";$("dialogSubmit").textContent=state.groupMode?"Gruppe erstellen ↗":"Chat starten ↗";
  $("dialogSubmit").disabled=true;searchUsers($("dialogSearch").value,"dialogResults","dialog");
});
$("dialogSearch").addEventListener("input",()=>{clearTimeout(peopleTimer);peopleTimer=setTimeout(()=>searchUsers($("dialogSearch").value,"dialogResults","dialog"),220);});
$("dialogResults").addEventListener("click",e=>{
  const b=e.target.closest("[data-user]");if(!b)return;const id=b.dataset.user;
  if(state.groupMode){state.selectedUsers.has(id)?state.selectedUsers.delete(id):state.selectedUsers.add(id);searchUsers($("dialogSearch").value,"dialogResults","dialog");}
  else {state.selectedUsers=new Set([id]);$("dialogResults").querySelectorAll("[data-user]").forEach(x=>x.classList.toggle("selected",x===b));}
  $("dialogSubmit").disabled=state.groupMode?state.selectedUsers.size<2:state.selectedUsers.size!==1;
});
$("newChatForm").addEventListener("submit",createConversation);
$("peopleSearch").addEventListener("input",()=>{clearTimeout(peopleTimer);peopleTimer=setTimeout(()=>searchUsers($("peopleSearch").value,"peopleResults","main"),220);});
$("peopleResults").addEventListener("click",async e=>{const b=e.target.closest("[data-user]");if(!b)return;state.selectedUsers=new Set([b.dataset.user]);state.groupMode=false;try{const r=await api("/api/conversations",{method:"POST",body:JSON.stringify({kind:"direct",members:[b.dataset.user]})});await refreshConversations();await openConversation(r.conversation.id);showView("chat");}catch(error){showToast(error.message);}});
document.querySelectorAll(".rail-button,[data-view='profile']").forEach(b=>b.addEventListener("click",()=>showView(b.dataset.view)));
$("backToList").addEventListener("click",()=>showView("chats"));
$("composer").addEventListener("submit",sendMessage);
$("messageInput").addEventListener("keydown",e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();$("composer").requestSubmit();}});
$("messageInput").addEventListener("input",e=>{e.target.style.height="auto";e.target.style.height=Math.min(e.target.scrollHeight,140)+"px";});
$("fileInput").addEventListener("change",e=>uploadFile(e.target.files?.[0]));
$("messageStream").addEventListener("click",e=>{const b=e.target.closest("[data-report]");if(b)reportMessage(b.dataset.report);});
$("chatInfoBtn").addEventListener("click",showChatInfo);
$("reportLastMessage").addEventListener("click",()=>{
  const latest=[...state.messages].reverse().find(m=>m.senderId!==state.user.id);
  $("infoDialog").close();if(latest)reportMessage(latest.id);else showToast("Es gibt keine fremde Nachricht zum Melden.");
});
$("createRoomBtn").addEventListener("click",createLegacyRoom);
$("joinRoomBtn").addEventListener("click",()=>joinLegacyRoom($("roomCodeInput").value));
$("roomCodeInput").addEventListener("input",e=>{e.target.value=e.target.value.toUpperCase().replace(/[^A-Z0-9]/g,"").slice(0,8);});
$("leaveRoomBtn").addEventListener("click",()=>{state.socket?.emit("leave-room");state.roomCode="";state.roomMessages=[];state.roomUsers=[];$("legacyRoomPanel").classList.add("hidden");showToast("Du hast den Raum verlassen.");});
$("copyRoomInviteBtn").addEventListener("click",copyLegacyRoomInvite);
$("legacyRoomComposer").addEventListener("submit",sendLegacyRoomMessage);
$("profileForm").addEventListener("submit",saveProfile);
$("avatarInput").addEventListener("change",e=>uploadAvatar(e.target.files?.[0]));
$("forgotPasswordBtn").addEventListener("click",()=>showAccountAction("forgot"));
$("resendVerificationBtn").addEventListener("click",()=>showAccountAction("resend"));
$("accountActionSubmit").addEventListener("click",submitAccountAction);
document.querySelectorAll(".color-option").forEach(b=>b.addEventListener("click",()=>{
  state.selectedColor=b.dataset.color;document.querySelectorAll(".color-option").forEach(x=>x.classList.toggle("selected",x===b));
  $("profileAvatar").style.setProperty("--avatar-color",state.selectedColor);
}));
$("logoutBtn").addEventListener("click",()=>logout());
$("adminContent").addEventListener("click",e=>{const b=e.target.closest("[data-resolve],[data-admin-delete],[data-ban]");if(b)adminAction(b);});
$("eventsList").addEventListener("click",e=>{const b=e.target.closest("[data-event-cancel]");if(b)adminAction(b);});
$("eventForm").addEventListener("submit",createEvent);
window.addEventListener("resize",()=>{if(!state.activeConversation&&!$("welcomeView").classList.contains("hidden"))showView("chats");});

async function boot() {
  setAuthMode("login");
  const params=new URLSearchParams(location.search);
  if(params.has("verify")){showAccountAction("verify");state.accountToken=params.get("verify");return;}
  else if(params.has("reset")){showAccountAction("reset");state.accountToken=params.get("reset");return;}
  // Registration needs a separate username field; keep it visible only in registration mode.
  $("registerTab").addEventListener("click",()=>{const field=$("usernameRegisterField");if(field)field.classList.remove("hidden");});
  try{const result=await api("/api/auth/me");state.user=result.user;enterMessenger();await refreshConversations();maybeJoinInviteRoom();}
  catch{$("authScreen").classList.remove("hidden");$("messenger").classList.add("hidden");}
}
boot();
