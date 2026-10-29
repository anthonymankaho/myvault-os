import { handleQwen, AIError, readBoundedJSON } from "./qwen.js";

const GITHUB_CONTENTS_URL =
  "https://api.github.com/repos/anthonymankaho/myvault-data/contents/vault.json";
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
