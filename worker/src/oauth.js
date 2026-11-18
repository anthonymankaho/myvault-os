// OAuth 2.1 authorization-code + PKCE for the Grok bot connector.
// The browser page asks for the connector password. The access token is the
// existing MCP bearer, so /mcp does not learn a second credential.

const CLIENT_ID = "momo-grok-bot";
const SCOPE = "tasks";
const CODE_TTL = 300;
const REFRESH_TTL = 60 * 60 * 24 * 30;

function constantTimeEqual(a, b) {
	if (typeof a !== "string" || typeof b !== "string") return false;
	const len = Math.max(a.length, b.length);
	let diff = a.length ^ b.length;
	for (let i = 0; i < len; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
	return diff === 0;
}

function escapeHtml(value) {
	return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}

function randomToken() {
	const bytes = crypto.getRandomValues(new Uint8Array(32));
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function pkceS256(verifier) {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
	let binary = "";
	for (const byte of new Uint8Array(digest)) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function allowedRedirect(value) {
	let url;
	try {
		url = new URL(value);
	} catch {
		return false;
	}
	if (url.username || url.password) return false;
	if (url.protocol === "cursor:" && url.hostname === "anysphere.cursor-mcp" && url.pathname === "/oauth/callback") return true;
	if ((url.protocol === "http:" || url.protocol === "https:") && (url.hostname === "localhost" || url.hostname === "127.0.0.1")) return true;
	if (url.protocol !== "https:") return false;
	const host = url.hostname;
	return ["cursor.com", "grok.com", "x.ai"].some((name) => host === name || host.endsWith(`.${name}`));
}

function originOf(request) {
	return new URL(request.url).origin;
}

function json(body, status = 200, extra = {}) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...extra },
	});
}

function metadata(request) {
	const origin = originOf(request);
	return {
		issuer: origin,
		authorization_endpoint: `${origin}/oauth/authorize`,
		token_endpoint: `${origin}/oauth/token`,
		registration_endpoint: `${origin}/oauth/register`,
		response_types_supported: ["code"],
		grant_types_supported: ["authorization_code", "refresh_token"],
		code_challenge_methods_supported: ["S256"],
		token_endpoint_auth_methods_supported: ["none"],
		scopes_supported: [SCOPE],
	};
}

async function readForm(request) {
	const type = request.headers.get("Content-Type") || "";
	if (type.includes("application/json")) {
		const body = await request.json();
		return body && typeof body === "object" ? body : {};
	}
	const form = await request.formData();
	return Object.fromEntries(form);
}

function page({ error = "", fields }) {
	const hidden = ["client_id", "redirect_uri", "state", "code_challenge", "code_challenge_method", "scope", "resource"]
		.map((name) => `<input type="hidden" name="${name}" value="${escapeHtml(fields[name] || "")}">`)
		.join("");
	return new Response(
		`<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connect MOMO</title><style>body{font-family:Segoe UI,sans-serif;background:#101614;color:#e8efe9;margin:0;padding:32px}main{max-width:460px;margin:auto}label{display:block;margin:18px 0 8px}input{width:100%;box-sizing:border-box;padding:10px;background:#0c1210;color:#e8efe9;border:1px solid #3e5348}button{margin-top:18px;padding:10px 16px;background:#d7efe3;color:#12211b;border:0;font-weight:650}.error{color:#f0b4b4}</style><main><p>MyVault OS</p><h1>Connect MOMO</h1><p>This allows the Grok bot to read and update Monthly Tasks. Enter the connector password from the file on your computer. 這會讓 Grok bot 讀取並更新 Monthly Task。請輸入電腦上那個檔案裡的連接密碼。</p>${error ? `<p class="error">${escapeHtml(error)}</p>` : ""}<form method="post"><label for="password">Connector password / 連接密碼</label><input id="password" name="password" type="password" autocomplete="current-password" required>${hidden}<button type="submit">Connect / 連接</button></form></main>`,
		{ headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } },
	);
}

function authorizeFields(url) {
	return {
		client_id: url.searchParams.get("client_id") || "",
		redirect_uri: url.searchParams.get("redirect_uri") || "",
		state: url.searchParams.get("state") || "",
		code_challenge: url.searchParams.get("code_challenge") || "",
		code_challenge_method: url.searchParams.get("code_challenge_method") || "",
		scope: url.searchParams.get("scope") || SCOPE,
		resource: url.searchParams.get("resource") || "",
	};
}

function validateAuthorize(fields) {
	if (fields.client_id !== CLIENT_ID) return "Client ID must be momo-grok-bot.";
	if (!allowedRedirect(fields.redirect_uri)) return `This redirect address is not allowed: ${fields.redirect_uri}`;
	if (!/^[A-Za-z0-9_-]{43,128}$/.test(fields.code_challenge) || fields.code_challenge_method !== "S256") return "PKCE S256 is required.";
	return "";
}

export async function handleOAuth(request, env) {
	const url = new URL(request.url);
	const path = url.pathname;
	if (path === "/.well-known/oauth-authorization-server") return json(metadata(request));
	if (path === "/.well-known/oauth-protected-resource" || path === "/.well-known/oauth-protected-resource/mcp") {
		const origin = originOf(request);
		return json({
			resource: `${origin}/mcp`,
			authorization_servers: [origin],
			bearer_methods_supported: ["header"],
			scopes_supported: [SCOPE],
		});
	}
	if (path === "/oauth/register" && request.method === "POST") {
		return json({ client_id: CLIENT_ID, token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], redirect_uris: [], scope: SCOPE }, 201);
	}
	if (path === "/oauth/authorize" && request.method === "GET") {
		const fields = authorizeFields(url);
		const error = validateAuthorize(fields);
		return page({ error, fields });
	}
	if (path === "/oauth/authorize" && request.method === "POST") {
		const form = await readForm(request);
		const fields = {
			client_id: form.client_id || "",
			redirect_uri: form.redirect_uri || "",
			state: form.state || "",
			code_challenge: form.code_challenge || "",
			code_challenge_method: form.code_challenge_method || "",
			scope: form.scope || SCOPE,
			resource: form.resource || "",
		};
		const error = validateAuthorize(fields);
		if (error) return page({ error, fields });
		const expected = env.MYVAULT_MCP_TOKEN;
		if (typeof expected !== "string" || expected.length < 16 || !constantTimeEqual(String(form.password || ""), expected)) {
			return page({ error: "That connector password was not accepted.", fields });
		}
		if (!env.QWEN_USAGE) return page({ error: "OAuth storage is not configured.", fields });
		const code = randomToken();
		await env.QWEN_USAGE.put(
			`momo-oauth-code:${code}`,
			JSON.stringify({ challenge: fields.code_challenge, redirectUri: fields.redirect_uri, clientId: fields.client_id }),
			{ expirationTtl: CODE_TTL },
		);
		const target = new URL(fields.redirect_uri);
		target.searchParams.set("code", code);
		if (fields.state) target.searchParams.set("state", fields.state);
		return new Response(null, { status: 302, headers: { Location: target.toString(), "Cache-Control": "no-store" } });
	}
	if (path === "/oauth/token" && request.method === "POST") {
		const form = await readForm(request);
		if (!env.QWEN_USAGE || typeof env.MYVAULT_MCP_TOKEN !== "string") return json({ error: "server_error" }, 500);
		if (form.grant_type === "refresh_token") {
			const current = await env.QWEN_USAGE.get(`momo-oauth-refresh:${form.refresh_token || ""}`);
			if (!current) return json({ error: "invalid_grant" }, 400);
			await env.QWEN_USAGE.delete(`momo-oauth-refresh:${form.refresh_token}`);
			return issueTokens(env, CLIENT_ID);
		}
		if (form.grant_type !== "authorization_code") return json({ error: "unsupported_grant_type" }, 400);
		if (form.client_id !== CLIENT_ID) return json({ error: "invalid_client" }, 401);
		const stored = await env.QWEN_USAGE.get(`momo-oauth-code:${form.code || ""}`);
		if (!stored) return json({ error: "invalid_grant" }, 400);
		await env.QWEN_USAGE.delete(`momo-oauth-code:${form.code}`);
		const parsed = JSON.parse(stored);
		if (parsed.redirectUri !== form.redirect_uri || !form.code_verifier) return json({ error: "invalid_grant" }, 400);
		if ((await pkceS256(form.code_verifier)) !== parsed.challenge) return json({ error: "invalid_grant" }, 400);
		return issueTokens(env, parsed.clientId);
	}
	return json({ error: "not_found" }, 404);
}

async function issueTokens(env, clientId) {
	const refresh = randomToken();
	await env.QWEN_USAGE.put(`momo-oauth-refresh:${refresh}`, JSON.stringify({ clientId }), { expirationTtl: REFRESH_TTL });
	return json({ access_token: env.MYVAULT_MCP_TOKEN, token_type: "Bearer", expires_in: 3600, refresh_token: refresh, scope: SCOPE });
}
