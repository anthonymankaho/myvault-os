import { handleQwen, AIError, readBoundedJSON } from "./qwen.js";

const GITHUB_CONTENTS_URL =
  "https://api.github.com/repos/anthonymankaho/myvault-data/contents/vault.json";
const ACCOUNTING_SYSTEMS = {
  gpl: {
    label: "GPL",
    contentsUrl:
      "https://api.github.com/repos/anthonymankaho/GPL/contents/GPL-System/GPL_System.html?ref=main",
    standaloneSecret: "GPL_STANDALONE_CODE"
  },
  eic: {
    label: "EIC",
    contentsUrl:
      "https://api.github.com/repos/anthonymankaho/EIC/contents/EIC-System/EIC_System.html?ref=main",
    standaloneSecret: "EIC_STANDALONE_CODE"
  },
  mpl: {
    label: "MPL",
    contentsUrl:
      "https://api.github.com/repos/anthonymankaho/MPL/contents/MPL_System.html?ref=main",
    standaloneSecret: "MPL_STANDALONE_CODE"
  }
};

const auditorCodeKey = (system) => `auditor-code:${system}`;

// Auditor codes live in KV so the owner can set them from the Accounting
// view; the original per-system env secret remains as a fallback.
async function readStandaloneCode(env, systemKey) {
  if (env.QWEN_USAGE) {
    try {
      const record = await env.QWEN_USAGE.get(auditorCodeKey(systemKey), "json");
      if (record && typeof record.code === "string" && record.code) return record.code;
    } catch {
      // fall through to the env secret
    }
  }
  return env[ACCOUNTING_SYSTEMS[systemKey].standaloneSecret] || "";
}

async function verifyOwner(authorization, env) {
  if (typeof authorization !== "string" || !/^Bearer\s+\S+$/i.test(authorization)) {
    return { ok: false, status: 401, error: "Sign in with GitHub to manage auditor access codes." };
  }
  let response;
  try {
    response = await fetch("https://api.github.com/user", {
      headers: githubHeaders(authorization),
      signal: AbortSignal.timeout(8000)
    });
  } catch {
    return { ok: false, status: 503, error: "Could not verify your GitHub session. Please retry." };
  }
  if (!response.ok) {
    return { ok: false, status: 401, error: "Your GitHub session could not be verified. Sign in again." };
  }
  const user = await response.json().catch(() => ({}));
  const login = String(user.login || "");
  const allowed = String(env.QWEN_ALLOWED_GITHUB_USER || "anthonymankaho");
  if (login.toLowerCase() !== allowed.toLowerCase()) {
    return { ok: false, status: 403, error: "Only the vault owner can manage auditor access codes." };
  }
  return { ok: true };
}

async function handleSetStandaloneCode(payload, authorization, env, origin) {
  if (!origin || !ALLOWED_ORIGINS.has(origin)) {
    return errorResponse("Origin is not allowed.", 403, origin);
  }
  const owner = await verifyOwner(authorization, env);
  if (!owner.ok) return errorResponse(owner.error, owner.status, origin);

  const systemKey = typeof payload?.system === "string" ? payload.system.toLowerCase() : "";
  if (!ACCOUNTING_SYSTEMS[systemKey]) {
    return errorResponse("Unknown accounting system.", 400, origin);
  }
  const code = typeof payload?.code === "string" ? payload.code.trim() : "";
  if (code.length < 4 || code.length > 128) {
    return errorResponse("Access code must be 4–128 characters.", 400, origin);
  }
  if (!env.QWEN_USAGE) {
    return errorResponse("Code storage is not configured.", 503, origin);
  }
  const updatedAt = new Date().toISOString();
  await env.QWEN_USAGE.put(auditorCodeKey(systemKey), JSON.stringify({ code, updatedAt }));
  return jsonResponse({ ok: true, system: systemKey, updatedAt }, 200, origin);
}

async function handleStandaloneCodeStatus(authorization, env, origin) {
  if (!origin || !ALLOWED_ORIGINS.has(origin)) {
    return errorResponse("Origin is not allowed.", 403, origin);
  }
  const owner = await verifyOwner(authorization, env);
  if (!owner.ok) return errorResponse(owner.error, owner.status, origin);

  const systems = {};
  for (const key of Object.keys(ACCOUNTING_SYSTEMS)) {
    let record = null;
    if (env.QWEN_USAGE) {
      try {
        record = await env.QWEN_USAGE.get(auditorCodeKey(key), "json");
      } catch {
        record = null;
      }
    }
    const kvCode = record && typeof record.code === "string" && record.code ? record.code : "";
    const envCode = env[ACCOUNTING_SYSTEMS[key].standaloneSecret] || "";
    systems[key] = {
      configured: Boolean(kvCode || envCode),
      source: kvCode ? "portal" : envCode ? "secret" : "none",
      updatedAt: kvCode && record.updatedAt ? record.updatedAt : null
    };
  }
  return jsonResponse({ systems }, 200, origin);
}

// Owner-only reveal: the administrator can retrieve a code they set (e.g. to
// hand it to the auditor or re-enter it on a standalone shell). The GitHub
// identity is verified server-side; auditors never reach this action.
async function handleRevealStandaloneCode(payload, authorization, env, origin) {
  if (!origin || !ALLOWED_ORIGINS.has(origin)) {
    return errorResponse("Origin is not allowed.", 403, origin);
  }
  const owner = await verifyOwner(authorization, env);
  if (!owner.ok) return errorResponse(owner.error, owner.status, origin);

  const systemKey = typeof payload?.system === "string" ? payload.system.toLowerCase() : "";
  if (!ACCOUNTING_SYSTEMS[systemKey]) {
    return errorResponse("Unknown accounting system.", 400, origin);
  }
  const code = await readStandaloneCode(env, systemKey);
  if (!code) {
    return errorResponse(
      `No access code is configured for the ${ACCOUNTING_SYSTEMS[systemKey].label} system.`,
      404,
      origin
    );
  }
  return jsonResponse({ system: systemKey, code }, 200, origin);
}

// Constant-time-ish string compare for access codes (length is not secret).
function constantTimeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const len = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}
const GITHUB_OAUTH_URL = "https://github.com/login/oauth/access_token";
const DEFAULT_ORIGIN = "https://myvault-os.pages.dev";

const ALLOWED_ORIGINS = new Set([
  DEFAULT_ORIGIN,
  "https://anthonymankaho.github.io",
  "http://localhost:3000",
  "http://localhost:5173",
  "http://localhost:5500",
  "http://localhost:8000",
  "http://localhost:8080",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:5173",
  "http://127.0.0.1:5500",
  "http://127.0.0.1:8000",
  "http://127.0.0.1:8080"
]);

function corsHeaders(origin) {
  const allowedOrigin =
    origin && ALLOWED_ORIGINS.has(origin) ? origin : DEFAULT_ORIGIN;

  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization"
  };
}

const DEFAULT_VAULT = {
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
};

function jsonResponse(body, status = 200, origin) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(origin),
      "Content-Type": "application/json; charset=utf-8"
    }
  });
}

function errorResponse(message, status, origin) {
  return jsonResponse({ error: message }, status, origin);
}

function githubHeaders(authorization) {
  return {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "myvault-worker",
    Authorization: authorization
  };
}

function decodeBase64Json(content) {
  const binary = atob(content.replace(/\s/g, ""));
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

function encodeBase64Utf8(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";

  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    const chunk = bytes.subarray(offset, offset + 0x8000);
    for (const byte of chunk) {
      binary += String.fromCharCode(byte);
    }
  }

  return btoa(binary);
}

async function handleAuth(payload, env, origin) {
  if (!env.GITHUB_CLIENT_SECRET) {
    return errorResponse("GitHub OAuth is not configured.", 500, origin);
  }

  try {
    const response = await fetch(GITHUB_OAUTH_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        client_id: "Ov23liJh92zfUJkRnUX7",
        client_secret: env.GITHUB_CLIENT_SECRET,
        code: payload.code,
        redirect_uri: payload.redirect_uri
      })
    });
    const result = await response.json();

    if (!response.ok) {
      return errorResponse("GitHub OAuth request failed.", 502, origin);
    }

    return jsonResponse(result, 200, origin);
  } catch {
    return errorResponse("GitHub OAuth request failed.", 502, origin);
  }
}

async function handleLoad(authorization, origin) {
  try {
    const response = await fetch(GITHUB_CONTENTS_URL, {
      headers: githubHeaders(authorization)
    });

    if (response.status === 404) {
      return jsonResponse({ vault: DEFAULT_VAULT }, 200, origin);
    }
    if (!response.ok) {
      return errorResponse("GitHub vault request failed.", 502, origin);
    }

    const file = await response.json();
    return jsonResponse({ vault: decodeBase64Json(file.content) }, 200, origin);
  } catch {
    return errorResponse("GitHub vault response was invalid.", 502, origin);
  }
}

async function handleSave(payload, authorization, origin) {
  if (!payload.vault || typeof payload.vault !== "object" || Array.isArray(payload.vault)) {
    return errorResponse("A vault object is required.", 400, origin);
  }

  try {
    const getResponse = await fetch(GITHUB_CONTENTS_URL, {
      headers: githubHeaders(authorization)
    });

    const file = getResponse.status === 404 ? null : await getResponse.json();
    if (getResponse.status !== 404 && !getResponse.ok) {
      return errorResponse("GitHub vault request failed.", 502, origin);
    }
    if (file && (typeof file.sha !== "string" || !file.sha)) {
      return errorResponse("GitHub vault response did not include a file SHA.", 502, origin);
    }

    const putBody = {
      message: file ? "Update vault" : "Create vault",
      content: encodeBase64Utf8(JSON.stringify(payload.vault, null, 2))
    };
    if (file) {
      putBody.sha = file.sha;
    }

    const putResponse = await fetch(GITHUB_CONTENTS_URL, {
      method: "PUT",
      headers: {
        ...githubHeaders(authorization),
        "Content-Type": "application/json"
      },
      body: JSON.stringify(putBody)
    });

    if (putResponse.status !== 200 && putResponse.status !== 201) {
      return errorResponse("GitHub vault update failed.", 502, origin);
    }

    return jsonResponse({ ok: true, created: !file }, 200, origin);
  } catch {
    return errorResponse("GitHub vault update failed.", 502, origin);
  }
}

async function handleAccountingSystem(authorization, env, origin, systemKey, payload) {
  if (origin !== "https://anthonymankaho.github.io") {
    return errorResponse("Origin is not allowed.", 403, origin);
  }
  const system = ACCOUNTING_SYSTEMS[systemKey];
  if (!system) {
    return errorResponse("Unknown accounting system.", 400, origin);
  }

  // Two ways in: the visitor's own GitHub token, or a standalone access code
  // that unlocks a server-side read of the private repo (no GitHub needed).
  const hasGitHub = /^Bearer\s+\S+$/i.test(authorization ?? "");
  const standaloneCode = typeof payload?.code === "string" ? payload.code.trim() : "";
  let repoAuthorization;
  let standalone = false;

  if (hasGitHub) {
    repoAuthorization = authorization;
  } else if (standaloneCode) {
    const expected = await readStandaloneCode(env, systemKey);
    if (!expected || !env.GH_REPO_READ_TOKEN) {
      return errorResponse(
        `Standalone access is not configured for the ${system.label} system.`,
        503,
        origin
      );
    }
    if (!constantTimeEqual(standaloneCode, expected)) {
      return errorResponse("Incorrect access code.", 403, origin);
    }
    repoAuthorization = `Bearer ${env.GH_REPO_READ_TOKEN}`;
    standalone = true;
  } else {
    return errorResponse(
      "A signed-in GitHub account or a standalone access code is required.",
      401,
      origin
    );
  }

  try {
    const response = await fetch(system.contentsUrl, {
      headers: {
        ...githubHeaders(repoAuthorization),
        Accept: "application/vnd.github.raw+json"
      }
    });

    if (response.status === 401 || response.status === 403 || response.status === 404) {
      // With a standalone code the repo read uses a server token, so a denial
      // is a configuration problem, not the visitor's fault.
      return standalone
        ? errorResponse(`The private ${system.label} system could not be loaded.`, 502, origin)
        : errorResponse(`This GitHub account cannot access the private ${system.label} system.`, 403, origin);
    }
    if (!response.ok || !response.body) {
      return errorResponse(`The private ${system.label} system could not be loaded.`, 502, origin);
    }

    return new Response(response.body, {
      status: 200,
      headers: {
        ...corsHeaders(origin),
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "private, no-store, max-age=0",
        Pragma: "no-cache",
        Vary: "Origin",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer"
      }
    });
  } catch {
    return errorResponse(`The private ${system.label} system could not be loaded.`, 502, origin);
  }
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin");

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(origin)
      });
    }

    if (request.method !== "POST") {
      return errorResponse("Method not allowed.", 405, origin);
    }

    let body;
    try {
      body = await readBoundedJSON(request, 2097152);
    } catch {
      return errorResponse("Request body must be valid JSON.", 400, origin);
    }

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return errorResponse("Request body must be a JSON object.", 400, origin);
    }

    const payload = body.payload ?? {};

    switch (body.action) {
      case 'qwen': {
        if (origin && !ALLOWED_ORIGINS.has(origin)) return errorResponse('Origin is not allowed.', 403, origin);
        try {
          const reply = await handleQwen(payload, request.headers.get('Authorization'), env);
          return new Response(JSON.stringify(reply), {
            headers: { ...corsHeaders(origin), 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
          });
        } catch (error) {
          const known = error instanceof AIError;
          return new Response(
            JSON.stringify({
              error: known ? error.message : 'Qwen is temporarily unavailable.',
              code: known ? error.code : 'AI_UNAVAILABLE',
            }),
            {
              status: known ? error.status : 503,
              headers: {
                ...corsHeaders(origin),
                'Content-Type': 'application/json; charset=utf-8',
                'Cache-Control': 'no-store',
                ...(known && error.retryAfter ? { 'Retry-After': String(error.retryAfter) } : {}),
              },
            },
          );
        }
      }
      case "auth":
        return handleAuth(payload, env, origin);
      case "gpl-system":
        return handleAccountingSystem(request.headers.get("Authorization"), env, origin, "gpl", payload);
      case "accounting-system":
        return handleAccountingSystem(
          request.headers.get("Authorization"),
          env,
          origin,
          typeof payload.system === "string" ? payload.system.toLowerCase() : "",
          payload
        );
      case "set-standalone-code":
        return handleSetStandaloneCode(payload, request.headers.get("Authorization"), env, origin);
      case "standalone-code-status":
        return handleStandaloneCodeStatus(request.headers.get("Authorization"), env, origin);
      case "reveal-standalone-code":
        return handleRevealStandaloneCode(payload, request.headers.get("Authorization"), env, origin);
      case "load":
      case "save": {
        const authorization = request.headers.get("Authorization");
        if (!authorization) {
          return errorResponse("Authorization is required.", 401, origin);
        }

        return body.action === "load"
          ? handleLoad(authorization, origin)
          : handleSave(payload, authorization, origin);
      }
      default:
        return errorResponse("Unknown action.", 400, origin);
    }
  }
};
