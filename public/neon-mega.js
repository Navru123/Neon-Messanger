(() => {
  const $ = id => document.getElementById(id);
  const state = { socket: null, timer: null, closeTimer: null };
  const escapeHtml = value => String(value ?? "").replace(/[&<>\"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'\"':"&quot;","'":"&#39;"}[c]));

  function mount() {
    if (!document.getElementById("neonMegaOverlay")) {
      const root = document.createElement("section");
      root.id = "neonMegaOverlay";
      root.className = "neon-mega-overlay hidden";
      root.setAttribute("aria-live", "assertive");
      root.innerHTML = `<div class="nmo-backdrop"></div><div class="nmo-card"><div class="nmo-grid"></div><div class="nmo-orbit nmo-orbit-a"></div><div class="nmo-orbit nmo-orbit-b"></div><div class="nmo-kicker" id="nmoKicker">NEON LIVE</div><h2 id="nmoTitle">NEON</h2><p id="nmoMessage"></p><div class="nmo-meta"><span id="nmoSender"></span><span id="nmoCountdown"></span></div><button id="nmoClose" class="button button-secondary" type="button">Schließen</button></div></section>`;
      document.body.appendChild(root);
    }
    if (!document.getElementById("neonMegaControl")) {
      const control = document.createElement("section");
      control.id = "neonMegaControl";
      control.className = "neon-mega-control hidden";
      control.innerHTML = `<div><span class="kicker">ADMIN LIVE CONTROL</span><h3>⚡ Bildschirm-Event</h3><p>Schicke eine große, animierte Nachricht an alle gerade verbundenen NEON-Nutzer.</p></div><form id="neonMegaForm"><input id="nmoAdminTitle" maxlength="60" placeholder="Titel · z. B. NEON DROP" required><textarea id="nmoAdminMessage" maxlength="280" rows="3" placeholder="Deine Nachricht an alle …" required></textarea><div class="nmo-controls"><select id="nmoAdminStyle"><option value="spotlight">✨ Spotlight</option><option value="celebrate">🎉 Celebrate</option><option value="alert">⚡ Alert</option></select><select id="nmoAdminDuration"><option value="6000">6 Sekunden</option><option value="9000" selected>9 Sekunden</option><option value="14000">14 Sekunden</option><option value="20000">20 Sekunden</option></select><button class="button button-primary" type="submit">LIVE AN ALLE ↗</button></div><p id="nmoAdminError" class="form-error"></p></form>`;
      const admin = document.getElementById("adminView") || document.querySelector("main") || document.body;
      admin.appendChild(control);
    }
  }

  function show(data) {
    mount();
    const root = $("neonMegaOverlay");
    $("nmoKicker").textContent = data.style === "celebrate" ? "NEON CELEBRATE" : data.style === "alert" ? "NEON ALERT" : "NEON LIVE";
    $("nmoTitle").textContent = data.title || "NEON LIVE";
    $("nmoMessage").textContent = data.message || "";
    $("nmoSender").textContent = "@" + (data.sender || "admin");
    root.dataset.style = data.style || "spotlight";
    root.classList.remove("hidden", "nmo-out");
    void root.offsetWidth;
    root.classList.add("nmo-in");
    let seconds = Math.ceil((Number(data.durationMs) || 9000) / 1000);
    $("nmoCountdown").textContent = seconds + "s";
    clearInterval(state.timer); clearTimeout(state.closeTimer);
    state.timer = setInterval(() => { seconds -= 1; if ($( "nmoCountdown" )) $("nmoCountdown").textContent = Math.max(0, seconds) + "s"; }, 1000);
    state.closeTimer = setTimeout(close, Number(data.durationMs) || 9000);
    if (data.style === "celebrate") burstConfetti();
  }
  function close() {
    const root = $("neonMegaOverlay"); if (!root || root.classList.contains("hidden")) return;
    clearInterval(state.timer); clearTimeout(state.closeTimer);
    root.classList.remove("nmo-in"); root.classList.add("nmo-out");
    setTimeout(() => root.classList.add("hidden"), 420);
  }
  function burstConfetti() {
    for (let i=0;i<42;i++) {
      const piece=document.createElement("i"); piece.className="nmo-confetti"; piece.style.setProperty("--x", ((Math.random()-.5)*110)+"vw"); piece.style.setProperty("--r", (Math.random()*720-360)+"deg"); piece.style.setProperty("--d", (700+Math.random()*900)+"ms"); document.body.appendChild(piece); setTimeout(()=>piece.remove(),1800);
    }
  }
  function connect() {
    if (typeof window.io !== "function") return;
    const socket = window.io({ transports:["websocket","polling"] });
    state.socket = socket;
    socket.on("global-spotlight", show);
  }
  function adminUI() {
    mount();
    const user = window.state?.user;
    const control = $("neonMegaControl");
    if (control) control.classList.toggle("hidden", user?.role !== "admin");
  }
  document.addEventListener("click", e => { if (e.target?.id === "nmoClose") close(); });
  document.addEventListener("submit", async e => {
    if (e.target?.id !== "neonMegaForm") return;
    e.preventDefault();
    const button=e.target.querySelector("button[type=submit]"); button.disabled=true; $("nmoAdminError").textContent="";
    try {
      const response=await fetch("/api/admin/broadcasts",{method:"POST",headers:{"Content-Type":"application/json"},credentials:"same-origin",body:JSON.stringify({title:$("nmoAdminTitle").value,message:$("nmoAdminMessage").value,style:$("nmoAdminStyle").value,durationMs:Number($("nmoAdminDuration").value)})});
      const data=await response.json(); if(!response.ok) throw new Error(data.error||"Live-Event fehlgeschlagen.");
      $("nmoAdminMessage").value="";
      show(data.broadcast);
    } catch (err) { $("nmoAdminError").textContent=err.message; }
    finally { button.disabled=false; }
  });
  const oldEnter = window.enterMessenger;
  if (typeof oldEnter === "function") {
    window.enterMessenger = function(){ oldEnter.apply(this,arguments); setTimeout(adminUI,30); };
  }
  mount();
  connect();
  setTimeout(adminUI,150);
})();
