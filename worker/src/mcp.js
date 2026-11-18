// Streamable HTTP MCP for the Grok bot. Monthly Tasks only.
// Chat notes and other vault collections are never returned.

const VAULT_URL = "https://api.github.com/repos/anthonymankaho/myvault-data/contents/vault.json";
const PROTOCOL_VERSIONS = ["2025-03-26", "2024-11-05"];
const FUTURE_SLACK_MS = 26 * 60 * 60 * 1000;

function constantTimeEqual(a, b) {
	if (typeof a !== "string" || typeof b !== "string") return false;
	const len = Math.max(a.length, b.length);
	let diff = a.length ^ b.length;
	for (let i = 0; i < len; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
	return diff === 0;
}

function bearer(request) {
	const header = request.headers.get("Authorization") || "";
	const match = header.match(/^Bearer\s+(\S+)$/i);
	return match ? match[1] : "";
}

function authorized(request, env) {
	const expected = env.MYVAULT_MCP_TOKEN;
	if (typeof expected !== "string" || expected.length < 16) return false;
	return constantTimeEqual(bearer(request), expected);
}

function dataToken(env) {
	const token = env.MYVAULT_DATA_TOKEN;
	if (typeof token !== "string" || token.length < 20) return "";
	return token.replace(/^Bearer\s+/i, "");
}

function githubHeaders(token) {
	return {
		Accept: "application/vnd.github+json",
		"X-GitHub-Api-Version": "2022-11-28",
		"User-Agent": "myvault-worker",
		Authorization: `Bearer ${token}`,
	};
}

function encodeBase64Utf8(value) {
	const bytes = new TextEncoder().encode(value);
	let binary = "";
	for (let offset = 0; offset < bytes.length; offset += 0x8000) {
		const chunk = bytes.subarray(offset, offset + 0x8000);
		for (const byte of chunk) binary += String.fromCharCode(byte);
	}
	return btoa(binary);
}

function decodeBase64Json(content) {
	const binary = atob(String(content).replace(/\s/g, ""));
	const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
	return JSON.parse(new TextDecoder().decode(bytes));
}

function hkParts(value = new Date()) {
	const date = value instanceof Date ? value : new Date(value);
	if (Number.isNaN(date.getTime())) return null;
	const parts = new Intl.DateTimeFormat("en-GB", {
		timeZone: "Asia/Hong_Kong",
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		hourCycle: "h23",
	}).formatToParts(date);
	const get = (type) => parts.find((part) => part.type === type)?.value || "";
	return { date: `${get("year")}-${get("month")}-${get("day")}`, time: `${get("hour")}:${get("minute")}` };
}

function hkDateKey(value = new Date()) {
	return hkParts(value)?.date || "";
}

function addDateDays(dateKey, days) {
	const date = new Date(`${dateKey}T12:00:00Z`);
	date.setUTCDate(date.getUTCDate() + days);
	return date.toISOString().slice(0, 10);
}

export function canonicalCompletedAt(value, now = Date.now()) {
	const text = String(value || "").trim();
	const local = text.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(?::\d{2})?$/);
	const absolute = local ? `${local[1]}T${local[2]}:00+08:00` : text;
	if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(absolute)) throw new Error("completed_at must include the Hong Kong hour and minute, such as 2026-11-16T09:16.");
	const time = Date.parse(absolute);
	if (!Number.isFinite(time)) throw new Error("completed_at is not a valid time.");
	if (time > now + FUTURE_SLACK_MS) throw new Error("completed_at cannot be more than a day in the future.");
	return new Date(time).toISOString();
}

function taskView(task) {
	const clock = task.completedAt ? hkParts(task.completedAt) : null;
	return {
		id: String(task.id || ""),
		description: String(task.description || ""),
		company: String(task.company || ""),
		planningMonth: String(task.planningMonth || ""),
		scheduledDate: String(task.scheduledDate || ""),
		status: task.status === "Completed" ? "Completed" : "Not Started",
		completedAt: task.completedAt || null,
		completedAtHongKong: clock ? `${clock.date} ${clock.time} HKT` : null,
		recurring: task.recurring === true,
		docResult: String(task.docResult || "").slice(0, 500),
	};
}

function selectTasks(tasks, args, today) {
	const scope = ["today", "overdue", "upcoming", "open", "completed", "month"].includes(args.scope) ? args.scope : "open";
	const month = /^\d{4}-\d{2}$/.test(args.month || "") ? args.month : today.slice(0, 7);
	const query = String(args.query || "").trim().toLowerCase();
	const next = addDateDays(today, 7);
	return tasks.filter((task) => {
		const open = task.status !== "Completed";
		if (scope === "today" && !(open && task.scheduledDate === today)) return false;
		if (scope === "overdue" && !(open && task.scheduledDate < today)) return false;
		if (scope === "upcoming" && !(open && task.scheduledDate > today && task.scheduledDate <= next)) return false;
		if (scope === "open" && !open) return false;
		if (scope === "completed" && task.status !== "Completed") return false;
		if (scope === "month" && task.planningMonth !== month) return false;
		if (query && !`${task.description} ${task.company} ${task.docResult || ""}`.toLowerCase().includes(query)) return false;
		return true;
	});
}

async function readVault(token) {
	const response = await fetch(VAULT_URL, { headers: githubHeaders(token) });
	if (!response.ok) {
		if (response.body) await response.body.cancel();
		throw new Error(response.status === 401 || response.status === 403 ? "The GitHub token cannot read the vault." : "The vault could not be read.");
	}
	const file = await response.json();
	if (!file?.sha || typeof file.content !== "string") throw new Error("The vault response was invalid.");
	const vault = decodeBase64Json(file.content);
	if (!vault || typeof vault !== "object" || Array.isArray(vault) || !Array.isArray(vault.tasks)) throw new Error("The vault has no task list.");
	return { sha: file.sha, vault };
}

async function writeVault(token, vault, sha, message) {
	const response = await fetch(VAULT_URL, {
		method: "PUT",
		headers: { ...githubHeaders(token), "Content-Type": "application/json" },
		body: JSON.stringify({
			message,
			sha,
			content: encodeBase64Utf8(`${JSON.stringify(vault, null, 2)}\n`),
		}),
	});
	if (response.status === 409) {
		if (response.body) await response.body.cancel();
		const error = new Error("The vault changed while saving.");
		error.conflict = true;
		throw error;
	}
	if (response.status !== 200 && response.status !== 201) {
		if (response.body) await response.body.cancel();
		throw new Error(response.status === 401 || response.status === 403 ? "The GitHub token cannot update the vault." : "The vault update failed.");
	}
	const result = await response.json();
	return result?.commit?.sha || result?.content?.sha || "";
}

function findTask(tasks, args) {
	if (args.id) {
		const matches = tasks.filter((task) => task?.id === args.id);
		if (matches.length !== 1) throw new Error("No Monthly Task has that id.");
		return matches[0];
	}
	const name = String(args.description || "").trim().toLowerCase();
	if (!name) throw new Error("Provide a task id or description.");
	const matches = tasks.filter((task) => String(task.description || "").trim().toLowerCase() === name);
	if (matches.length === 1) return matches[0];
	if (!matches.length) throw new Error(`No Monthly Task is named “${args.description}”.`);
	throw new Error(`More than one task is named “${args.description}”. Call list_monthly_tasks and use an id.`);
}

async function withVault(env, mutate) {
	const token = dataToken(env);
	if (!token) throw new Error("MYVAULT_DATA_TOKEN is not configured, so the shared vault cannot be read or updated.");
	for (let attempt = 0; attempt < 2; attempt++) {
		const loaded = await readVault(token);
		const outcome = await mutate(loaded.vault);
		if (!outcome.write) return outcome.result;
		try {
			const commit = await writeVault(token, loaded.vault, loaded.sha, outcome.message);
			return { ...outcome.result, saved: true, commit };
		} catch (error) {
			if (error.conflict && attempt === 0) continue;
			throw error;
		}
	}
	throw new Error("The vault update failed.");
}

const TOOLS = [
	{
		name: "list_monthly_tasks",
		description: "List MyVault Monthly Tasks. scope is today, overdue, upcoming, open, completed, or month. Times are Asia/Hong_Kong. This does not change the vault.",
		inputSchema: {
			type: "object",
			properties: {
				scope: { type: "string", enum: ["today", "overdue", "upcoming", "open", "completed", "month"] },
				month: { type: "string", description: "YYYY-MM. Used when scope is month." },
				query: { type: "string", description: "Case-insensitive text matched against description, company, and result notes." },
			},
			additionalProperties: false,
		},
	},
	{
		name: "complete_monthly_task",
		description: "Mark one Monthly Task completed in the shared GitHub vault. completed_at is required and is the Hong Kong time the user stated, including the hour and minute, such as 2026-11-16T09:16. Do not use the current time unless the user said they just finished. Prefer the task id from list_monthly_tasks.",
		inputSchema: {
			type: "object",
			properties: {
				id: { type: "string" },
				description: { type: "string" },
				completed_at: { type: "string" },
				note: { type: "string", description: "Optional line appended to Doc/Result. Do not store the completion time here." },
			},
			required: ["completed_at"],
			additionalProperties: false,
		},
	},
	{
		name: "reopen_monthly_task",
		description: "Mark one Monthly Task not started and clear its completion time in the shared GitHub vault. Doc/Result is kept.",
		inputSchema: {
			type: "object",
			properties: {
				id: { type: "string" },
				description: { type: "string" },
			},
			additionalProperties: false,
		},
	},
];

async function callTool(name, args, env) {
	const input = args && typeof args === "object" && !Array.isArray(args) ? args : {};
	if (name === "list_monthly_tasks") {
		return withVault(env, async ({ tasks }) => {
			const today = hkDateKey();
			const selected = selectTasks(tasks, input, today).slice(0, 50).map(taskView);
			return {
				write: false,
				result: { saved: false, todayHongKong: today, count: selected.length, tasks: selected },
			};
		});
	}
	if (name === "complete_monthly_task") {
		const completedAt = canonicalCompletedAt(input.completed_at);
		const note = typeof input.note === "string" ? input.note.trim().slice(0, 2000) : "";
		return withVault(env, async (vault) => {
			const task = findTask(vault.tasks, input);
			task.status = "Completed";
			task.completedAt = completedAt;
			task.updatedAt = new Date().toISOString();
			if (note) task.docResult = task.docResult ? `${task.docResult}\n${note}` : note;
			const view = taskView(task);
			return {
				write: true,
				message: `MOMO: complete ${view.description || view.id} at ${view.completedAtHongKong}`,
				result: { task: view },
			};
		});
	}
	if (name === "reopen_monthly_task") {
		return withVault(env, async (vault) => {
			const task = findTask(vault.tasks, input);
			task.status = "Not Started";
			task.completedAt = null;
			task.updatedAt = new Date().toISOString();
			return {
				write: true,
				message: `MOMO: reopen ${task.description || task.id}`,
				result: { task: taskView(task) },
			};
		});
	}
	throw new Error("Unknown tool.");
}

function rpcResult(id, result, version) {
	return jsonRpc({ jsonrpc: "2.0", id, result }, 200, version);
}

function rpcError(id, code, message, status = 200) {
	return jsonRpc({ jsonrpc: "2.0", id, error: { code, message } }, status);
}

function jsonRpc(body, status, version) {
	return new Response(JSON.stringify(body), {
		status,
		headers: {
			"Content-Type": "application/json; charset=utf-8",
			"Cache-Control": "no-store",
			...(version ? { "MCP-Protocol-Version": version } : {}),
		},
	});
}

function toolResult(id, value, isError, version) {
	return rpcResult(id, { content: [{ type: "text", text: JSON.stringify(value) }], isError }, version);
}

export async function handleMcp(request, env) {
	if (request.method === "OPTIONS") {
		return new Response(null, {
			status: 204,
			headers: {
				"Access-Control-Allow-Origin": "*",
				"Access-Control-Allow-Methods": "POST, DELETE, OPTIONS",
				"Access-Control-Allow-Headers": "Content-Type, Authorization, Accept, MCP-Protocol-Version",
			},
		});
	}
	if (request.method === "DELETE") return new Response(null, { status: 204 });
	if (request.method !== "POST") return jsonRpc({ error: "POST JSON-RPC to this URL." }, 405);

	if (!env.MYVAULT_MCP_TOKEN) {
		return jsonRpc({ jsonrpc: "2.0", id: null, error: { code: -32001, message: "The MyVault MCP token is not configured." } }, 503);
	}
	if (!authorized(request, env)) {
		return new Response(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32001, message: "Authorization is required." } }), {
			status: 401,
			headers: {
				"Content-Type": "application/json; charset=utf-8",
				"WWW-Authenticate": `Bearer realm="myvault", resource_metadata="${new URL(request.url).origin}/.well-known/oauth-protected-resource"`,
				"Cache-Control": "no-store",
			},
		});
	}

	let body;
	try {
		body = await request.json();
	} catch {
		return rpcError(null, -32700, "Request body must be valid JSON.", 400);
	}
	if (!body || typeof body !== "object" || Array.isArray(body)) return rpcError(null, -32600, "Invalid JSON-RPC request.", 400);
	const version = PROTOCOL_VERSIONS.includes(body.params?.protocolVersion) ? body.params.protocolVersion : PROTOCOL_VERSIONS[0];
	if (body.id === undefined || String(body.method || "").startsWith("notifications/")) return new Response(null, { status: 202 });

	try {
		if (body.method === "initialize") {
			return rpcResult(body.id, {
				protocolVersion: version,
				capabilities: { tools: { listChanged: false } },
				serverInfo: { name: "myvault-os", version: "1.0.0" },
				instructions: "This server reads and updates MyVault Monthly Tasks in the shared GitHub vault. Use list_monthly_tasks before changing a task. complete_monthly_task requires completed_at at the Hong Kong time the user stated. A result with saved true means GitHub accepted the update.",
			}, version);
		}
		if (body.method === "ping") return rpcResult(body.id, {}, version);
		if (body.method === "tools/list") return rpcResult(body.id, { tools: TOOLS }, version);
		if (body.method === "tools/call") {
			const name = body.params?.name;
			let args = body.params?.arguments ?? {};
			if (typeof args === "string") args = JSON.parse(args);
			try {
				const value = await callTool(name, args, env);
				return toolResult(body.id, value, false, version);
			} catch (error) {
				return toolResult(body.id, { saved: false, error: error.message || "The tool failed." }, true, version);
			}
		}
		return rpcError(body.id, -32601, "Method not found.");
	} catch (error) {
		return rpcError(body.id, -32603, error.message || "MCP request failed.", 500);
	}
}
