import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from '../src/index.js';

const KEY = 'server-secret-test-only';
const TOKEN = 'Bearer github-test-only-token';
const ENV = { XAI_API_KEY: KEY, XAI_BASE_URL: 'https://api.x.ai/v1', XAI_MODEL: 'grok-4.7' };
const payload = () => ({
	message: 'What is due?',
	history: [],
	vault: {
		tasks: [
			{
				id: 't1',
				description: 'WEEKLY EXCHANGE REPORT',
				company: 'MCL',
				planningMonth: '2026-11',
				scheduledDate: '2026-11-16',
				status: 'Not Started',
				docResult: '',
				completedAt: null,
			},
		],
	},
});
function request(data = payload(), auth = TOKEN, origin = 'https://anthonymankaho.github.io') {
	return new Request('https://worker.test', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: auth } : {}), ...(origin ? { Origin: origin } : {}) },
		body: JSON.stringify({ action: 'momo', payload: data }),
	});
}
const reply = (operations = []) => ({ message: 'Review this proposal.', operations });
function completion(body, usage = null) {
	const value = { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(body) } }] };
	if (usage) value.usage = usage;
	return Response.json(value);
}
afterEach(() => {
	vi.unstubAllGlobals();
});

describe('MOMO API', () => {
	it('requires the GitHub session and never calls Grok without it', async () => {
		const mock = vi.fn();
		vi.stubGlobal('fetch', mock);
		const response = await worker.fetch(request(payload(), ''), ENV);
		expect(response.status).toBe(401);
		expect(mock).not.toHaveBeenCalled();
	});

	it('calls grok-4.7 with the worker secret and returns a task proposal', async () => {
		const op = {
			type: 'update',
			collection: 'tasks',
			id: 't1',
			fields: { status: 'Completed', completedAt: '2026-11-16T09:16:00+08:00' },
		};
		const mock = vi
			.fn()
			.mockResolvedValueOnce(Response.json({ login: 'anthonymankaho' }))
			.mockResolvedValueOnce(completion(reply([op]), { prompt_tokens: 20, completion_tokens: 10 }));
		vi.stubGlobal('fetch', mock);
		const kv = { get: async () => '0', put: async (key, value) => { kv.saved = [key, value]; } };
		const response = await worker.fetch(request(), { ...ENV, QWEN_USAGE: kv });
		expect(response.status).toBe(200);
		const body = await response.json();
		expect(body.operations[0].fields.completedAt).toBe('2026-11-16T01:16:00.000Z');
		expect(body.quota.used).toBe(30);
		expect(kv.saved[0]).toMatch(/^momo-usage:anthonymankaho:\d{4}-\d{2}$/);
		expect(mock.mock.calls[1][0]).toBe('https://api.x.ai/v1/chat/completions');
		const upstream = JSON.parse(mock.mock.calls[1][1].body);
		expect(upstream.model).toBe('grok-4.7');
		expect(upstream.max_tokens).toBe(4096);
		expect(upstream.response_format).toEqual({ type: 'json_object' });
		expect(mock.mock.calls[1][1].headers.Authorization).toBe(`Bearer ${KEY}`);
		expect(upstream.messages.some((message) => JSON.stringify(message).includes(TOKEN.slice(7)))).toBe(false);
		expect(JSON.stringify(body).includes(KEY)).toBe(false);
	});

	it('runs a task search before the final answer', async () => {
		const op = { type: 'update', collection: 'tasks', id: 't1', fields: { docResult: 'filed' } };
		const mock = vi
			.fn()
			.mockResolvedValueOnce(Response.json({ login: 'anthonymankaho' }))
			.mockResolvedValueOnce(completion({ tool: 'vault_search', query: 'weekly exchange' }))
			.mockResolvedValueOnce(completion(reply([op])));
		vi.stubGlobal('fetch', mock);
		const response = await worker.fetch(request(), ENV);
		expect(response.status).toBe(200);
		const body = await response.json();
		expect(body.steps).toEqual([{ tool: 'vault_search', query: 'weekly exchange', matches: 1 }]);
		expect(body.operations[0].fields).toEqual({ docResult: 'filed' });
	});

	it('fails closed when the monthly quota is spent, the secret is missing, or the endpoint is not api.x.ai', async () => {
		const githubOnly = () => vi.fn().mockResolvedValueOnce(Response.json({ login: 'anthonymankaho' }));
		vi.stubGlobal('fetch', githubOnly());
		const spent = await worker.fetch(request(), { ...ENV, QWEN_USAGE: { get: async () => '1000000', put: async () => {} } });
		expect(spent.status).toBe(429);

		vi.stubGlobal('fetch', githubOnly());
		const missing = await worker.fetch(request(), { XAI_BASE_URL: ENV.XAI_BASE_URL });
		expect(missing.status).toBe(503);

		vi.stubGlobal('fetch', githubOnly());
		const evil = await worker.fetch(request(), { ...ENV, XAI_BASE_URL: 'https://evil.example/v1' });
		expect(evil.status).toBe(503);
	});

	it('rejects a reply that echoes the worker secret', async () => {
		const mock = vi
			.fn()
			.mockResolvedValueOnce(Response.json({ login: 'anthonymankaho' }))
			.mockResolvedValueOnce(completion({ message: `key ${KEY}`, operations: [] }));
		vi.stubGlobal('fetch', mock);
		const response = await worker.fetch(request(), ENV);
		expect(response.status).toBe(502);
		expect(JSON.stringify(await response.json()).includes(KEY)).toBe(false);
	});
});
