const GITHUB_CONTENTS_URL =
  "https://api.github.com/repos/anthonymankaho/myvault-data/contents/vault.json";
const GITHUB_OAUTH_URL = "https://github.com/login/oauth/access_token";
const ALLOWED_ORIGIN = "https://myvault-os.pages.dev";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization"
};

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

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "application/json; charset=utf-8"
    }
  });
}

function errorResponse(message, status) {
  return jsonResponse({ error: message }, status);
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

async function handleAuth(payload, env) {
  if (!env.GITHUB_CLIENT_SECRET) {
    return errorResponse("GitHub OAuth is not configured.", 500);
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
      return errorResponse("GitHub OAuth request failed.", 502);
    }

    return jsonResponse(result);
  } catch {
    return errorResponse("GitHub OAuth request failed.", 502);
  }
}

async function handleLoad(authorization) {
  try {
    const response = await fetch(GITHUB_CONTENTS_URL, {
      headers: githubHeaders(authorization)
    });

    if (response.status === 404) {
      return jsonResponse({ vault: DEFAULT_VAULT });
    }
    if (!response.ok) {
      return errorResponse("GitHub vault request failed.", 502);
    }

    const file = await response.json();
    return jsonResponse({ vault: decodeBase64Json(file.content) });
  } catch {
    return errorResponse("GitHub vault response was invalid.", 502);
  }
}

async function handleSave(payload, authorization) {
  if (!payload.vault || typeof payload.vault !== "object" || Array.isArray(payload.vault)) {
    return errorResponse("A vault object is required.", 400);
  }

  try {
    const getResponse = await fetch(GITHUB_CONTENTS_URL, {
      headers: githubHeaders(authorization)
    });

    if (!getResponse.ok) {
      return errorResponse("GitHub vault request failed.", 502);
    }

    const file = await getResponse.json();
    if (typeof file.sha !== "string" || !file.sha) {
      return errorResponse("GitHub vault response did not include a file SHA.", 502);
    }

    const putResponse = await fetch(GITHUB_CONTENTS_URL, {
      method: "PUT",
      headers: {
        ...githubHeaders(authorization),
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        message: "Update vault",
        content: encodeBase64Utf8(JSON.stringify(payload.vault, null, 2)),
        sha: file.sha
      })
    });

    if (putResponse.status !== 200) {
      return errorResponse("GitHub vault update failed.", 502);
    }

    return jsonResponse({ ok: true });
  } catch {
    return errorResponse("GitHub vault update failed.", 502);
  }
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: CORS_HEADERS
      });
    }

    if (request.method !== "POST") {
      return errorResponse("Method not allowed.", 405);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return errorResponse("Request body must be valid JSON.", 400);
    }

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return errorResponse("Request body must be a JSON object.", 400);
    }

    const payload = body.payload ?? {};

    switch (body.action) {
      case "auth":
        return handleAuth(payload, env);
      case "load":
      case "save": {
        const authorization = request.headers.get("Authorization");
        if (!authorization) {
          return errorResponse("Authorization is required.", 401);
        }

        return body.action === "load"
          ? handleLoad(authorization)
          : handleSave(payload, authorization);
      }
      default:
        return errorResponse("Unknown action.", 400);
    }
  }
};
