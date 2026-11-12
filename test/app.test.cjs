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
    crypto,
    structuredClone,
    window: {
      location: {
        origin: "https://anthonymankaho.github.io",
        pathname: "/myvault-os/",
      },
    },
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

test("recurring text shift replaces month tokens but not embedded dates", () => {
  const w = workspace();
  assert.equal(
    w.run('shiftRecurringText("8A, SOFTMARK DEBIT NOTE 11/2026", "2026-11", "2026-12")'),
    "8A, SOFTMARK DEBIT NOTE 12/2026",
  );
  assert.equal(
    w.run('shiftRecurringText("MPL · 2026-11", "2026-11", "2026-12")'),
    "MPL · 2026-12",
  );
  assert.equal(
    w.run('shiftRecurringText("issued 2026-11-02", "2026-11", "2026-12")'),
    "issued 2026-11-02",
  );
  assert.equal(
    w.run('shiftRecurringText("per NOV2026 sheet", "2026-11", "2026-12")'),
    "per DEC 2026 sheet",
  );
  assert.equal(
    w.run('shiftRecurringText("DEBIT NOTE 12/2026", "2026-12", "2027-01")'),
    "DEBIT NOTE 01/2027",
  );
  assert.equal(
    w.run('shiftRecurringText("no tokens here", "2026-11", "2026-12")'),
    "no tokens here",
  );
});

test("nextHkWorkday skips weekends and Hong Kong public holidays", () => {
  const w = workspace();
  assert.equal(w.run('nextHkWorkday("2026-11-02")'), "2026-11-02"); // Monday
  assert.equal(w.run('nextHkWorkday("2026-11-07")'), "2026-11-09"); // Saturday -> Monday
  assert.equal(w.run('nextHkWorkday("2026-02-16")'), "2026-02-16"); // Monday, Lunar New Year's Eve is not a HK holiday
  assert.equal(w.run('nextHkWorkday("2026-02-17")'), "2026-02-20"); // Lunar New Year's Day rolls to Friday
  assert.equal(w.run('nextHkWorkday("2026-04-02")'), "2026-04-02"); // Thursday, workday
  assert.equal(w.run('nextHkWorkday("2026-04-03")'), "2026-04-08"); // Good Friday + Easter cluster
  assert.equal(w.run('nextHkWorkday("2026-10-17")'), "2026-10-20"); // Chung Yeung Sunday + Monday holiday
  assert.equal(w.run('nextHkWorkday("2027-02-06")'), "2027-02-10"); // Lunar New Year 2027
});

test("recurring target month only near a month boundary", () => {
  const w = workspace();
  assert.equal(w.run('recurringTargetMonth("2026-11-15")'), "");
  assert.equal(w.run('recurringTargetMonth("2026-11-29")'), "2026-12"); // 2nd-to-last day
  assert.equal(w.run('recurringTargetMonth("2026-11-30")'), "2026-12"); // month-end day
  assert.equal(w.run('recurringTargetMonth("2026-12-01")'), "2026-12"); // grace day
  assert.equal(w.run('recurringTargetMonth("2026-12-03")'), "2026-12"); // grace day
  assert.equal(w.run('recurringTargetMonth("2026-12-04")'), "");
  assert.equal(w.run('recurringTargetMonth("2027-01-31")'), "2027-02"); // January rollover
});

test("auto-generation creates next-month instances once and chains", () => {
  const w = workspace();
  w.run(`
    state.vault.tasks = [normalizeTask({
      id: "t-nov", planningMonth: "2026-11", company: "SOFTMARK",
      description: "8A, SOFTMARK DEBIT NOTE 11/2026", scheduledDate: "2026-11-02",
      status: "Not Started", recurring: true,
      createdAt: "2026-11-01T00:00:00.000Z", updatedAt: "2026-11-01T00:00:00.000Z",
    }), normalizeTask({
      id: "t-once", planningMonth: "2026-11", company: "MPL",
      description: "one-off job 2026-11", scheduledDate: "2026-11-05",
      status: "Not Started", recurring: false,
      createdAt: "2026-11-01T00:00:00.000Z", updatedAt: "2026-11-01T00:00:00.000Z",
    })];
  `);
  const first = w.run('autoGenerateRecurringTasks("2026-11-30").map((task) => task.id)');
  assert.equal(first.length, 1);
  const created = w.run('state.vault.tasks.find((task) => task.planningMonth === "2026-12")');
  assert.equal(created.description, "8A, SOFTMARK DEBIT NOTE 12/2026");
  assert.equal(created.scheduledDate, "2026-12-02"); // anchor day 2, Wednesday workday
  assert.equal(created.status, "Not Started");
  assert.equal(created.recurring, true);
  assert.equal(created.carriedFromTaskId, "t-nov");
  assert.equal(w.run("state.vault.tasks.length"), 3);
  // Re-running in the grace window must not duplicate.
  assert.equal(w.run('autoGenerateRecurringTasks("2026-12-01").length'), 0);
  assert.equal(w.run("state.vault.tasks.length"), 3);
  // Next month-end chains from the December instance.
  const second = w.run('autoGenerateRecurringTasks("2026-12-31").map((task) => task.id)');
  assert.equal(second.length, 1);
  const jan = w.run('state.vault.tasks.find((task) => task.planningMonth === "2027-01")');
  assert.equal(jan.description, "8A, SOFTMARK DEBIT NOTE 01/2027");
  assert.equal(jan.scheduledDate, "2027-01-04"); // Jan 2-3 weekend; Jan 4 Monday
  assert.equal(jan.carriedFromTaskId, created.id);
  assert.equal(w.run("state.vault.tasks.length"), 4);
});

test("auto-generation rolls anchor days past holidays and clamps short months", () => {
  const w = workspace();
  w.run(`
    state.vault.tasks = [normalizeTask({
      id: "t-a", planningMonth: "2026-12", company: "SOFTMARK",
      description: "debit note 12/2026", scheduledDate: "2026-12-06",
      status: "Not Started", recurring: true,
      createdAt: "2026-12-01T00:00:00.000Z", updatedAt: "2026-12-01T00:00:00.000Z",
    })];
  `);
  // Anchor day 6 lands on a plain Wednesday in January 2027.
  const jan = w.run('autoGenerateRecurringTasks("2026-12-31")');
  assert.equal(jan.length, 1);
  assert.equal(jan[0].scheduledDate, "2027-01-06");
  w.run(`
    state.vault.tasks.push(normalizeTask({
      id: "t-b", planningMonth: "2026-12", company: "MPL",
      description: "monthly report 2026-12", scheduledDate: "2026-12-31",
      status: "Not Started", recurring: true,
      createdAt: "2026-12-01T00:00:00.000Z", updatedAt: "2026-12-01T00:00:00.000Z",
    }));
  `);
  // January month-end: anchor 6 hits the Feb 2027 Lunar New Year cluster; anchor 31 clamps in February.
  const feb = w.run('autoGenerateRecurringTasks("2027-01-31")');
  assert.equal(feb.length, 2);
  const byCompany = Object.fromEntries(feb.map((task) => [task.company, task]));
  assert.equal(byCompany.SOFTMARK.scheduledDate, "2027-02-10"); // Feb 6 Sat, 7 Sun, 8-9 LNY -> Wed
  assert.equal(byCompany.MPL.planningMonth, "2027-02");
  assert.equal(byCompany.MPL.scheduledDate, "2027-03-01"); // day 31 clamps to Feb 28 (Sun) -> Mon
});

test("auto-generation does nothing outside the window", () => {
  const w = workspace();
  w.run(`
    state.vault.tasks = [normalizeTask({
      id: "t-x", planningMonth: "2026-11", company: "SOFTMARK",
      description: "debit note 11/2026", scheduledDate: "2026-11-02",
      status: "Not Started", recurring: true,
      createdAt: "2026-11-01T00:00:00.000Z", updatedAt: "2026-11-01T00:00:00.000Z",
    })];
  `);
  assert.equal(w.run('autoGenerateRecurringTasks("2026-11-15").length'), 0);
  assert.equal(w.run("state.vault.tasks.length"), 1);
});

test("OAuth redirect_uri is canonical regardless of index.html or trailing slash", () => {
  const w = workspace();
  const canonical = "https://anthonymankaho.github.io/myvault-os/";
  for (const pathname of ["/myvault-os/", "/myvault-os/index.html", "/myvault-os"]) {
    w.context.window.location.pathname = pathname;
    assert.equal(w.run("oauthRedirectUri()"), canonical, `pathname ${pathname}`);
  }
});
