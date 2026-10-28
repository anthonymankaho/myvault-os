const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const source = fs.readFileSync(
  require("node:path").join(__dirname, "../app.js"),
  "utf8",
);

function workspace() {
  const storage = new Map();
  const elements = new Map();
  const context = vm.createContext({
    console,
    URL,
    structuredClone,
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: (key) => storage.delete(key),
    },
    document: {
      querySelector: (key) => {
        if (!elements.has(key))
          elements.set(key, { dataset: {}, classList: { toggle() {} } });
        return elements.get(key);
      },
    },
  });
  vm.runInContext(
    source.slice(
      0,
      source.indexOf('document.querySelectorAll(".nav-link").forEach((link)'),
    ),
    context,
  );
  vm.runInContext(
    "render = () => {}; state.vault = structuredClone(DEFAULT_VAULT);",
    context,
  );
  return {
    context,
    storage,
    elements,
    run: (code) => vm.runInContext(code, context),
  };
}

test("pending changes survive cache writes and clear when a remote vault is applied", () => {
  const w = workspace();
  w.run('state.vault.projects.push({ name: "Local" }); markDirty();');
  assert.equal(w.storage.get("myvault_pending_changes"), "1");
  assert.equal(
    JSON.parse(w.storage.get("myvault_cache")).projects[0].name,
    "Local",
  );
  w.run('applyVault({ projects: [{name: "Remote"}] });');
  assert.equal(w.storage.get("myvault_pending_changes"), "0");
});

test("a background refresh never overwrites pending local edits", async () => {
  const w = workspace();
  w.run('call = () => { throw Error("must not call"); }; markDirty();');
  await w.run("loadVault({silent:true})");
  assert.equal(w.run("state.dirty"), true);
  assert.match(w.elements.get("#status").textContent, /Local changes/);
});

test("edits made while a load is in flight take priority over its response", async () => {
  const w = workspace();
  w.run(
    "let complete; call = () => new Promise(resolve => { complete = resolve; });",
  );
  const pending = w.run("loadVault()");
  w.run(
    'state.vault.projects.push({name: "Keep me"}); markDirty(); complete({vault:{projects:[]}});',
  );
  await pending;
  assert.equal(w.run("state.vault.projects[0].name"), "Keep me");
  assert.equal(w.run("state.dirty"), true);
});

test("saving sends a snapshot and leaves edits made during the request pending", async () => {
  const w = workspace();
  w.storage.set("myvault_token", "test-only");
  w.run(
    'let complete; let sent; call = (action, payload) => { sent = payload.vault; return new Promise(resolve => {complete = resolve;}); }; state.vault.projects.push({name: "Before"}); markDirty();',
  );
  const pending = w.run("saveVault()");
  w.run('state.vault.projects[0].name = "After"; markDirty();');
  assert.equal(w.run("sent.projects[0].name"), "Before");
  w.run("complete({});");
  await pending;
  assert.equal(w.run("state.dirty"), true);
  assert.equal(w.run("state.saving"), false);
  assert.equal(w.elements.get("#save-button").disabled, false);
});

test("a failed save keeps data and re-enables retry", async () => {
  const w = workspace();
  w.storage.set("myvault_token", "test-only");
  w.run('call = async () => { throw Error("Offline"); }; markDirty();');
  await w.run("saveVault()");
  assert.equal(w.run("state.dirty"), true);
  assert.equal(w.run("state.saving"), false);
  assert.equal(w.elements.get("#save-button").disabled, false);
  assert.equal(w.storage.get("myvault_pending_changes"), "1");
});

test("a successful save clears pending state", async () => {
  const w = workspace();
  w.storage.set("myvault_token", "test-only");
  w.run("call = async () => ({}); markDirty();");
  await w.run("saveVault()");
  assert.equal(w.run("state.dirty"), false);
  assert.equal(w.storage.get("myvault_pending_changes"), "0");
});

test("signed-out changes stay local and do not call the remote API", async () => {
  const w = workspace();
  w.run('call = () => { throw Error("must not call"); }; markDirty();');
  await w.run("saveVault()");
  assert.equal(w.run("state.dirty"), true);
  assert.equal(w.elements.get("#save-button").disabled, true);
});

test("imported metadata and custom statuses are preserved", () => {
  const w = workspace();
  assert.equal(
    w.run(
      'normalizeVault({projects:[{name:"Imported",sourcePath:"a.md",links:["b"]}]}).projects[0].sourcePath',
    ),
    "a.md",
  );
  assert.match(
    w.run('fieldHtml(COLLECTIONS.projects.fields[1], {status:"In progress"})'),
    /value="In progress" selected/,
  );
  assert.equal(w.run("validateVaultJson('{\"meta\":null}').ok"), false);
});

test("record links allow only http and https", () => {
  const w = workspace();
  assert.equal(w.run('safeUrl("javascript:alert(1)")'), "");
  assert.equal(w.run('safeUrl("https://example.com")'), "https://example.com/");
  assert.equal(w.run('safeUrl("data:text/html,test")'), "");
});
