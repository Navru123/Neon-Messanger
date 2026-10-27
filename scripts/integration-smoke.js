const assert = require("node:assert/strict");

const base = process.env.SMOKE_URL || "http://127.0.0.1:3000";
const stamp = Date.now().toString(36);
async function request(route, { method = "GET", body, cookie, headers = {} } = {}) {
  const init = { method, headers: { ...headers } };
  if (cookie) init.headers.cookie = cookie;
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) { init.headers["content-type"] = "application/json"; init.body = JSON.stringify(body); }
  const response = await fetch(base + route, init);
  const data = await response.json().catch(() => ({}));
  return { response, data, cookie: response.headers.get("set-cookie")?.split(";")[0] };
}
async function createAccount(suffix) {
  const email = `smoke-${stamp}-${suffix}@example.test`;
  const registered = await request("/api/auth/register", { method: "POST", body: {
    email, username: `smoke_${stamp}_${suffix}`.slice(0,24), displayName: `Smoke ${suffix}`, password: "correct-horse-battery-1"
  }});
  assert.equal(registered.response.status, 201, JSON.stringify(registered.data));
  assert.equal(registered.data.pendingVerification, true);
  assert.ok(registered.data.developmentVerificationUrl, "development verification URL should be returned");
  const token = new URL(registered.data.developmentVerificationUrl).searchParams.get("verify");
  const verified = await request("/api/auth/verify", { method: "POST", body: { token } });
  assert.equal(verified.response.status, 200, JSON.stringify(verified.data));
  const loggedIn = await request("/api/auth/login", { method: "POST", body: { login: email, password: "correct-horse-battery-1" }});
  assert.equal(loggedIn.response.status, 200, JSON.stringify(loggedIn.data));
  assert.ok(loggedIn.cookie, "login should issue a session cookie");
  return { email, user: loggedIn.data.user, cookie: loggedIn.cookie };
}
(async () => {
  const health = await request("/api/health");
  assert.equal(health.response.status, 200);
  const first = await createAccount("a");
  const second = await createAccount("b");

  const profile = await request("/api/profile", { method: "PATCH", cookie: first.cookie, body: { displayName: "Smoke Updated", avatarColor: "#48c6ef" }});
  assert.equal(profile.response.status, 200, JSON.stringify(profile.data));
  assert.equal(profile.data.user.displayName, "Smoke Updated");

  const conversation = await request("/api/conversations", { method: "POST", cookie: first.cookie, body: { kind: "direct", members: [second.user.id] }});
  assert.equal(conversation.response.status, 201, JSON.stringify(conversation.data));
  const history = await request(`/api/conversations/${conversation.data.conversation.id}/messages`, { cookie: first.cookie });
  assert.equal(history.response.status, 200);
  assert.deepEqual(history.data.messages, []);

  const badUpload = new FormData();
  badUpload.append("file", new Blob(["not a png"], { type: "image/png" }), "bad.png");
  const upload = await request(`/api/conversations/${conversation.data.conversation.id}/upload`, { method: "POST", cookie: first.cookie, body: badUpload });
  assert.equal(upload.response.status, 400, "upload should reject a MIME/signature mismatch");

  const forgot = await request("/api/auth/forgot-password", { method: "POST", body: { email: first.email }});
  assert.equal(forgot.response.status, 200, JSON.stringify(forgot.data));
  assert.ok(forgot.data.developmentResetUrl, "development reset URL should be returned");
  const resetToken = new URL(forgot.data.developmentResetUrl).searchParams.get("reset");
  const reset = await request("/api/auth/reset-password", { method: "POST", body: { token: resetToken, password: "a-new-secure-password-2" }});
  assert.equal(reset.response.status, 200, JSON.stringify(reset.data));
  const oldLogin = await request("/api/auth/login", { method: "POST", body: { login: first.email, password: "correct-horse-battery-1" }});
  assert.equal(oldLogin.response.status, 401, "old password must stop working");
  const newLogin = await request("/api/auth/login", { method: "POST", body: { login: first.email, password: "a-new-secure-password-2" }});
  assert.equal(newLogin.response.status, 200, JSON.stringify(newLogin.data));

  console.log("Smoke tests passed: health, email verification, login, profile, direct conversation, upload signature rejection, password reset.");
})().catch(error => { console.error(error); process.exitCode = 1; });
