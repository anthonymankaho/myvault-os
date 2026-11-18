import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from '../src/index.js';
import { canonicalCompletedAt } from '../src/mcp.js';

const MCP = 'mcp-test-token-ok';
const GIT = 'github-data-token-ok-0123456789';
const ENV = { MYVAULT_MCP_TOKEN: MCP, MYVAULT_DATA_TOKEN: GIT };
const vault = () => ({
	tasks: [
		{ id: 't1', description: 'WEEKLY EXCHANGE REPORT', company: 'MCL', planningMonth: '2026-11', scheduledDate: '2026-11-16', status: 'Not Started', docResult: 'keep', recurring: true },
		{ id: 't2', description: 'RMB EXCHANGE REPORT', company: 'MCL', planningMonth: '2026-11', scheduledDate: '2026-11-16', status: 'Not Started', docResult: '' },
	],
	chats: [{ id: 'c1', title: 'API', notes: 'sk-secret-do-not-leak' }],
});
function encode(value) {
	return btoa(unescape(encodeURIComponent(JSON.stringify(value))));
}
function request(method, params, { token = MCP, id = 1 } = {}) {
	return new Request('https://worker.test/mcp', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
		body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
	});
}
function githubFile(body = vault(), sha = 'sha-1') {
	return Response.json({ sha, content: encode(body), encoding: 'base64' });
}
afterEach(() => vi.unstubAllGlobals());

describe('MyVault MCP', () => {
	it('rejects a missing or wrong bearer token', async () => {
		const open = await worker.fetch(request('initialize', { protocolVersion: '2025-03-26' }, { token: '' }), ENV);
		expect(open.status).toBe(401);
		const wrong = await worker.fetch(request('tools/list', {}, { token: 'wrong-token-value' }), ENV);
		expect(wrong.status).toBe(401);
		expect(JSON.stringify(await wrong.json())).not.toContain(MCP);
	});

	it('lists tools and returns tasks without chat notes', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(githubFile()));
		const listed = await worker.fetch(request('tools/list'), ENV);
		expect(listed.status).toBe(200);
		const names = (await listed.json()).result.tools.map((tool) => tool.name);
		expect(names).toEqual(['list_monthly_tasks', 'complete_monthly_task', 'reopen_monthly_task']);
		const response = await worker.fetch(request('tools/call', { name: 'list_monthly_tasks', arguments: { scope: 'open', query: 'exchange' } }), ENV);
		const payload = JSON.parse((await response.json()).result.content[0].text);
		expect(payload.count).toBe(2);
		expect(payload.tasks[0].description).toBe('WEEKLY EXCHANGE REPORT');
		expect(JSON.stringify(payload)).not.toContain('sk-secret');
	});

	it('writes a named Hong Kong completion time and keeps the rest of the vault', async () => {
		const puts = [];
		vi.stubGlobal(
			'fetch',
			vi.fn(async (url, options = {}) => {
				if (options.method === 'PUT') {
					puts.push(JSON.parse(options.body));
					return Response.json({ commit: { sha: 'sha-2' } });
				}
				expect(options.headers.Authorization).toBe(`Bearer ${GIT}`);
				return githubFile();
			}),
		);
		const response = await worker.fetch(
			request('tools/call', {
				name: 'complete_monthly_task',
				arguments: { description: 'weekly exchange report', completed_at: '2026-11-16T09:16', note: 'filed' },
			}),
			ENV,
		);
		const body = await response.json();
		expect(body.result.isError).toBe(false);
		const payload = JSON.parse(body.result.content[0].text);
		expect(payload.saved).toBe(true);
		expect(payload.task.completedAt).toBe('2026-11-16T01:16:00.000Z');
		expect(payload.task.completedAtHongKong).toBe('2026-11-16 09:16 HKT');
		const saved = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(puts[0].content), (char) => char.charCodeAt(0))));
		expect(saved.tasks[0].status).toBe('Completed');
		expect(saved.tasks[0].docResult).toBe('keep\nfiled');
		expect(saved.tasks[0].recurring).toBe(true);
		expect(saved.tasks[1].status).toBe('Not Started');
		expect(saved.chats[0].notes).toBe('sk-secret-do-not-leak');
		expect(JSON.stringify(payload)).not.toContain('sk-secret');
		expect(puts[0].message).toContain('2026-11-16 09:16 HKT');
	});

	it('does not accept a date without a time', () => {
		expect(() => canonicalCompletedAt('2026-11-16')).toThrow(/hour and minute/);
	});
});
