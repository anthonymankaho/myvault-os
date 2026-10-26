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
    expect(await response.json()).toEqual({ ok: true });
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
