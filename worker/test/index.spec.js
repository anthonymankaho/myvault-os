import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index.js";

const CONTENTS_URL =
  "https://api.github.com/repos/anthonymankaho/myvault-data/contents/vault.json";
const OAUTH_URL = "https://github.com/login/oauth/access_token";
const ALLOWED_ORIGIN = "https://myvault-os.pages.dev";

function makeRequest(action, payload = {}, authorization) {
  const headers = { "Content-Type": "application/json" };
  if (authorization) {
    headers.Authorization = authorization;
  }

  return new Request("https://myvault-api.example/", {
    method: "POST",
    headers,
    body: JSON.stringify({ action, payload })
  });
}

function encodeBase64(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function decodeBase64(value) {
  return new TextDecoder().decode(
    Uint8Array.from(atob(value), (character) => character.charCodeAt(0))
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("MyVault API Worker", () => {
  it("responds to preflight with 204 and exact CORS headers", async () => {
    const response = await worker.fetch(
      new Request("https://myvault-api.example/", { method: "OPTIONS" }),
      {}
    );

    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(ALLOWED_ORIGIN);
    expect(response.headers.get("Access-Control-Allow-Methods")).toBe("POST, OPTIONS");
    expect(response.headers.get("Access-Control-Allow-Headers")).toBe(
      "Content-Type, Authorization"
    );
  });

  it("returns 400 JSON for unknown actions", async () => {
    const response = await worker.fetch(makeRequest("missing"), {});

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Unknown action." });
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(ALLOWED_ORIGIN);
  });

  it.each(["load", "save"])("requires authorization for %s", async (action) => {
    const response = await worker.fetch(makeRequest(action, { vault: {} }), {});

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Authorization is required." });
  });

  it("returns the default vault when GitHub reports the file missing", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);
    const authorization = "******";
    const response = await worker.fetch(makeRequest("load", {}, authorization), {});

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      vault: {
        skills: [],
        projects: [],
        docs: [],
        cards: [],
        chats: [],
        meta: {
          created: "2026-10-25",
          owner: "anthonymankaho",
          version: 1
        }
      }
    });
    expect(fetchMock).toHaveBeenCalledWith(
      CONTENTS_URL,
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: authorization,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "myvault-worker"
        })
      })
    );
  });

  it("decodes UTF-8 vault JSON and returns only the vault key", async () => {
    const vault = { skills: ["日本語"], meta: { name: "café" } };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({ content: encodeBase64(JSON.stringify(vault)) })
      )
    );
    const response = await worker.fetch(
      makeRequest("load", {}, "******"),
      {}
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ vault });
  });

  it("gets the SHA and saves Unicode JSON with the user's authorization", async () => {
    const vault = { skills: ["雪だるま ☃"], meta: { owner: "José" } };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ sha: "file-sha" }))
      .mockResolvedValueOnce(Response.json({ content: "updated" }));
    vi.stubGlobal("fetch", fetchMock);
    const authorization = "******";
    const response = await worker.fetch(
      makeRequest("save", { vault }, authorization),
      {}
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, created: false });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe(authorization);
    const [putUrl, putOptions] = fetchMock.mock.calls[1];
    expect(putUrl).toBe(CONTENTS_URL);
    expect(putOptions.method).toBe("PUT");
    expect(putOptions.headers.Authorization).toBe(authorization);
    expect(JSON.parse(putOptions.body)).toEqual({
      message: "Update vault",
      content: encodeBase64(JSON.stringify(vault, null, 2)),
      sha: "file-sha"
    });
    expect(JSON.parse(decodeBase64(JSON.parse(putOptions.body).content))).toEqual(vault);
  });

  it("creates the vault file on first save when GitHub reports it missing", async () => {
    const vault = { skills: [], meta: { owner: "anthonymankaho" } };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("{}", { status: 404 }))
      .mockResolvedValueOnce(Response.json({ content: "created" }, { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    const response = await worker.fetch(
      makeRequest("save", { vault }, "******"),
      {}
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, created: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [putUrl, putOptions] = fetchMock.mock.calls[1];
    expect(putUrl).toBe(CONTENTS_URL);
    expect(putOptions.method).toBe("PUT");
    const putBody = JSON.parse(putOptions.body);
    expect(putBody.message).toBe("Create vault");
    expect(putBody.sha).toBeUndefined();
    expect(JSON.parse(decodeBase64(putBody.content))).toEqual(vault);
  });

  it("echoes the CORS origin for allowed origins and the default otherwise", async () => {
    const allowed = await worker.fetch(
      new Request("https://myvault-api.example/", {
        method: "OPTIONS",
        headers: { Origin: "https://anthonymankaho.github.io" }
      }),
      {}
    );
    expect(allowed.headers.get("Access-Control-Allow-Origin")).toBe(
      "https://anthonymankaho.github.io"
    );

    const disallowed = await worker.fetch(
      new Request("https://myvault-api.example/", {
        method: "OPTIONS",
        headers: { Origin: "https://evil.example" }
      }),
      {}
    );
    expect(disallowed.headers.get("Access-Control-Allow-Origin")).toBe(ALLOWED_ORIGIN);
  });

  it("exchanges an OAuth code using only the configured secret", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({ access_token: "github-user-token" })
    );
    vi.stubGlobal("fetch", fetchMock);
    const response = await worker.fetch(
      makeRequest("auth", {
        code: "oauth-code",
        redirect_uri: "https://myvault-os.pages.dev/"
      }),
      { GITHUB_CLIENT_SECRET: "test-secret" }
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ access_token: "github-user-token" });
    expect(fetchMock).toHaveBeenCalledWith(
      OAUTH_URL,
      expect.objectContaining({
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          client_id: "Ov23liJh92zfUJkRnUX7",
          client_secret: "test-secret",
          code: "oauth-code",
          redirect_uri: "https://myvault-os.pages.dev/"
        })
      })
    );
  });

  it("returns 502 JSON for GitHub upstream failures", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 500 })));
    const response = await worker.fetch(
      makeRequest("load", {}, "******"),
      {}
    );

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "GitHub vault request failed." });
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(ALLOWED_ORIGIN);
  });
});

const PAGES_ORIGIN = "https://anthonymankaho.github.io";
const SYSTEM_URLS = {
  gpl: "https://api.github.com/repos/anthonymankaho/GPL/contents/GPL-System/GPL_System.html?ref=main",
  eic: "https://api.github.com/repos/anthonymankaho/EIC/contents/EIC-System/EIC_System.html?ref=main",
  mpl: "https://api.github.com/repos/anthonymankaho/MPL/contents/MPL_System.html?ref=main"
};

function makePagesRequest(action, payload = {}, authorization) {
  const headers = { "Content-Type": "application/json", Origin: PAGES_ORIGIN };
  if (authorization) {
    headers.Authorization = authorization;
  }
  return new Request("https://myvault-api.example/", {
    method: "POST",
    headers,
    body: JSON.stringify({ action, payload })
  });
}

describe("accounting-system action", () => {
  it("rejects origins other than the GitHub Pages site", async () => {
    const response = await worker.fetch(
      makeRequest("accounting-system", { system: "gpl" }, "Bearer token"),
      {}
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Origin is not allowed." });
  });

  it("requires a GitHub account or a standalone access code", async () => {
    const response = await worker.fetch(
      makePagesRequest("accounting-system", { system: "eic" }),
      {}
    );
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: "A signed-in GitHub account or a standalone access code is required."
    });
  });

  it("rejects unknown system keys", async () => {
    const response = await worker.fetch(
      makePagesRequest("accounting-system", { system: "unknown" }, "Bearer token"),
      {}
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Unknown accounting system." });
  });

  it.each(Object.entries(SYSTEM_URLS))(
    "streams the private %s system with no-store and the caller's GitHub authorization",
    async (key, url) => {
      const html = `<!doctype html><title>${key.toUpperCase()} system</title>`;
      const fetchMock = vi.fn().mockResolvedValue(new Response(html, { status: 200 }));
      vi.stubGlobal("fetch", fetchMock);

      const response = await worker.fetch(
        makePagesRequest("accounting-system", { system: key }, "Bearer user-token"),
        {}
      );

      expect(response.status).toBe(200);
      expect(await response.text()).toBe(html);
      expect(response.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
      expect(response.headers.get("Cache-Control")).toBe("private, no-store, max-age=0");
      expect(response.headers.get("Access-Control-Allow-Origin")).toBe(PAGES_ORIGIN);
      expect(fetchMock).toHaveBeenCalledWith(
        url,
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer user-token",
            Accept: "application/vnd.github.raw+json"
          })
        })
      );
    }
  );

  it.each([401, 403, 404])(
    "returns a friendly 403 when GitHub denies access (status %i)",
    async (status) => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status })));
      const response = await worker.fetch(
        makePagesRequest("accounting-system", { system: "mpl" }, "Bearer user-token"),
        {}
      );
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({
        error: "This GitHub account cannot access the private MPL system."
      });
    }
  );

  it("returns 502 when the private file cannot be loaded", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 500 })));
    const response = await worker.fetch(
      makePagesRequest("accounting-system", { system: "eic" }, "Bearer user-token"),
      {}
    );
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "The private EIC system could not be loaded." });
  });

  it("keeps the legacy gpl-system action working", async () => {
    const html = "<!doctype html><title>GPL</title>";
    const fetchMock = vi.fn().mockResolvedValue(new Response(html, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await worker.fetch(
      makePagesRequest("gpl-system", {}, "Bearer user-token"),
      {}
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe(html);
    expect(fetchMock).toHaveBeenCalledWith(
      SYSTEM_URLS.gpl,
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer user-token" })
      })
    );
  });
});

describe("accounting-system standalone access code", () => {
  const STANDALONE_ENV = { GPL_STANDALONE_CODE: "gpl-code-123", GH_REPO_READ_TOKEN: "server-pat" };

  it("unlocks with a valid code and reads the repo using the server token", async () => {
    const html = "<!doctype html><title>GPL via code</title>";
    const fetchMock = vi.fn().mockResolvedValue(new Response(html, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await worker.fetch(
      makePagesRequest("accounting-system", { system: "gpl", code: "gpl-code-123" }),
      STANDALONE_ENV
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe(html);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store, max-age=0");
    expect(fetchMock).toHaveBeenCalledWith(
      SYSTEM_URLS.gpl,
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer server-pat",
          Accept: "application/vnd.github.raw+json"
        })
      })
    );
  });

  it("trims whitespace around the submitted code", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<html></html>", { status: 200 })));
    const response = await worker.fetch(
      makePagesRequest("accounting-system", { system: "gpl", code: "  gpl-code-123  " }),
      STANDALONE_ENV
    );
    expect(response.status).toBe(200);
  });

  it("rejects an incorrect code with 403 and never reads the repo", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await worker.fetch(
      makePagesRequest("accounting-system", { system: "gpl", code: "wrong-code" }),
      STANDALONE_ENV
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Incorrect access code." });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 503 when standalone access is not configured for the system", async () => {
    const response = await worker.fetch(
      makePagesRequest("accounting-system", { system: "eic", code: "any-code" }),
      { GH_REPO_READ_TOKEN: "server-pat" }
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "Standalone access is not configured for the EIC system."
    });
  });

  it("returns 503 when the server read token is missing", async () => {
    const response = await worker.fetch(
      makePagesRequest("accounting-system", { system: "gpl", code: "gpl-code-123" }),
      { GPL_STANDALONE_CODE: "gpl-code-123" }
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "Standalone access is not configured for the GPL system."
    });
  });

  it("does not let one system's code unlock another system", async () => {
    const response = await worker.fetch(
      makePagesRequest("accounting-system", { system: "eic", code: "gpl-code-123" }),
      { ...STANDALONE_ENV, EIC_STANDALONE_CODE: "eic-code-456" }
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Incorrect access code." });
  });

  it("maps a server-token repo denial to 502 (configuration), not a user 403", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 403 })));
    const response = await worker.fetch(
      makePagesRequest("accounting-system", { system: "gpl", code: "gpl-code-123" }),
      STANDALONE_ENV
    );
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "The private GPL system could not be loaded." });
  });

  it("still prefers a GitHub token when both are supplied", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("<html></html>", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const response = await worker.fetch(
      makePagesRequest("accounting-system", { system: "gpl", code: "gpl-code-123" }, "Bearer user-token"),
      STANDALONE_ENV
    );
    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      SYSTEM_URLS.gpl,
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer user-token" })
      })
    );
  });
});

function makeKV(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    store,
    get: vi.fn(async (key, type) => {
      const raw = store.get(key);
      if (raw === undefined) return null;
      return type === "json" ? JSON.parse(raw) : raw;
    }),
    put: vi.fn(async (key, value) => {
      store.set(key, value);
    })
  };
}

function ownerFetch(login = "anthonymankaho") {
  return vi.fn(async (url) => {
    if (String(url) === "https://api.github.com/user") {
      return Response.json({ login });
    }
    return new Response("<html></html>", { status: 200 });
  });
}

describe("auditor code management (owner only)", () => {
  it("set-standalone-code requires GitHub sign-in", async () => {
    const response = await worker.fetch(
      makePagesRequest("set-standalone-code", { system: "gpl", code: "new-code" }),
      { QWEN_USAGE: makeKV() }
    );
    expect(response.status).toBe(401);
  });

  it("set-standalone-code rejects a non-owner GitHub account", async () => {
    vi.stubGlobal("fetch", ownerFetch("someone-else"));
    const kv = makeKV();
    const response = await worker.fetch(
      makePagesRequest("set-standalone-code", { system: "gpl", code: "new-code" }, "Bearer other-token"),
      { QWEN_USAGE: kv, QWEN_ALLOWED_GITHUB_USER: "anthonymankaho" }
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Only the vault owner can manage auditor access codes." });
    expect(kv.put).not.toHaveBeenCalled();
  });

  it("set-standalone-code stores the code in KV for the owner", async () => {
    vi.stubGlobal("fetch", ownerFetch());
    const kv = makeKV();
    const response = await worker.fetch(
      makePagesRequest("set-standalone-code", { system: "gpl", code: "  owner-chosen-code  " }, "Bearer owner-token"),
      { QWEN_USAGE: kv }
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.system).toBe("gpl");
    expect(kv.put).toHaveBeenCalledTimes(1);
    const [key, value] = kv.put.mock.calls[0];
    expect(key).toBe("auditor-code:gpl");
    expect(JSON.parse(value).code).toBe("owner-chosen-code");
  });

  it("set-standalone-code validates system and code length", async () => {
    vi.stubGlobal("fetch", ownerFetch());
    const env = { QWEN_USAGE: makeKV() };
    const badSystem = await worker.fetch(
      makePagesRequest("set-standalone-code", { system: "xxx", code: "new-code" }, "Bearer owner-token"),
      env
    );
    expect(badSystem.status).toBe(400);
    const shortCode = await worker.fetch(
      makePagesRequest("set-standalone-code", { system: "gpl", code: "abc" }, "Bearer owner-token"),
      env
    );
    expect(shortCode.status).toBe(400);
  });

  it("set-standalone-code rejects foreign origins", async () => {
    const request = new Request("https://myvault-api.example/", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://evil.example", Authorization: "Bearer owner-token" },
      body: JSON.stringify({ action: "set-standalone-code", payload: { system: "gpl", code: "new-code" } })
    });
    const response = await worker.fetch(request, { QWEN_USAGE: makeKV() });
    expect(response.status).toBe(403);
  });

  it("standalone-code-status reports configured state without revealing codes", async () => {
    vi.stubGlobal("fetch", ownerFetch());
    const kv = makeKV({ "auditor-code:gpl": JSON.stringify({ code: "secret-gpl", updatedAt: "2026-11-12T00:00:00.000Z" }) });
    const response = await worker.fetch(
      makePagesRequest("standalone-code-status", {}, "Bearer owner-token"),
      { QWEN_USAGE: kv, EIC_STANDALONE_CODE: "secret-eic" }
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.systems.gpl).toEqual({ configured: true, source: "portal", updatedAt: "2026-11-12T00:00:00.000Z" });
    expect(body.systems.eic).toEqual({ configured: true, source: "secret", updatedAt: null });
    expect(body.systems.mpl.configured).toBe(false);
    expect(JSON.stringify(body)).not.toContain("secret-gpl");
    expect(JSON.stringify(body)).not.toContain("secret-eic");
  });

  it("standalone-code-status requires the owner", async () => {
    const response = await worker.fetch(
      makePagesRequest("standalone-code-status", {}),
      { QWEN_USAGE: makeKV() }
    );
    expect(response.status).toBe(401);
  });
});

describe("accounting-system with KV-stored codes", () => {
  it("unlocks with the owner-set KV code even when no env secret exists", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<html>KV</html>", { status: 200 })));
    const kv = makeKV({ "auditor-code:mpl": JSON.stringify({ code: "owner-mpl-code" }) });
    const response = await worker.fetch(
      makePagesRequest("accounting-system", { system: "mpl", code: "owner-mpl-code" }),
      { QWEN_USAGE: kv, GH_REPO_READ_TOKEN: "server-pat" }
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("<html>KV</html>");
  });

  it("prefers the KV code over the env secret", async () => {
    const kv = makeKV({ "auditor-code:gpl": JSON.stringify({ code: "new-kv-code" }) });
    const env = { QWEN_USAGE: kv, GPL_STANDALONE_CODE: "old-secret-code", GH_REPO_READ_TOKEN: "server-pat" };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<html></html>", { status: 200 })));
    const withNew = await worker.fetch(
      makePagesRequest("accounting-system", { system: "gpl", code: "new-kv-code" }),
      env
    );
    expect(withNew.status).toBe(200);
    const withOld = await worker.fetch(
      makePagesRequest("accounting-system", { system: "gpl", code: "old-secret-code" }),
      env
    );
    expect(withOld.status).toBe(403);
  });
});
