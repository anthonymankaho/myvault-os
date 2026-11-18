import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from '../src/index.js';
import { allowedRedirect, pkceS256 } from '../src/oauth.js';

const PASSWORD = 'connector-password-value';
const ENV = { MYVAULT_MCP_TOKEN: PASSWORD, MYVAULT_DATA_TOKEN: 'github-data-token-ok-0123456789' };
function memoryKV() {
	const store = new Map();
	return {
		get: async (key) => store.get(key) ?? null,
		put: async (key, value) => void store.set(key, String(value)),
		delete: async (key) => void store.delete(key),
	};
}
function env() {
	return { ...ENV, QWEN_USAGE: memoryKV() };
}
afterEach(() => vi.unstubAllGlobals());

describe('MOMO OAuth', () => {
	it('allows the Grok bot redirect addresses and rejects an open redirect', () => {
		expect(allowedRedirect('cursor://anysphere.cursor-mcp/oauth/callback')).toBe(true);
		expect(allowedRedirect('https://www.cursor.com/agents/mcp/oauth/callback')).toBe(true);
		expect(allowedRedirect('http://localhost:8787/callback')).toBe(true);
		expect(allowedRedirect('https://evil.example/callback')).toBe(false);
	});

	it('publishes the endpoints the connector form needs', async () => {
		const response = await worker.fetch(new Request('https://worker.test/.well-known/oauth-authorization-server'));
		const body = await response.json();
		expect(body.authorization_endpoint).toBe('https://worker.test/oauth/authorize');
		expect(body.token_endpoint).toBe('https://worker.test/oauth/token');
		expect(body.token_endpoint_auth_methods_supported).toEqual(['none']);
		expect(body.code_challenge_methods_supported).toEqual(['S256']);
	});

	it('exchanges a password and PKCE code for the MCP bearer', async () => {
		const used = env();
		const verifier = 'a'.repeat(50);
		const challenge = await pkceS256(verifier);
		const authorize = new URL('https://worker.test/oauth/authorize');
		authorize.searchParams.set('client_id', 'momo-grok-bot');
		authorize.searchParams.set('redirect_uri', 'http://localhost:8787/callback');
		authorize.searchParams.set('state', 'state-1');
		authorize.searchParams.set('code_challenge', challenge);
		authorize.searchParams.set('code_challenge_method', 'S256');
		const form = await worker.fetch(new Request(authorize, { method: 'GET' }), used);
		expect(await form.text()).not.toContain(PASSWORD);
		const posted = await worker.fetch(
			new Request('https://worker.test/oauth/authorize', {
				method: 'POST',
				headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
				body: new URLSearchParams({
					password: PASSWORD,
					client_id: 'momo-grok-bot',
					redirect_uri: 'http://localhost:8787/callback',
					state: 'state-1',
					code_challenge: challenge,
					code_challenge_method: 'S256',
				}),
			}),
			used,
		);
		expect(posted.status).toBe(302);
		const redirected = new URL(posted.headers.get('Location'));
		expect(redirected.origin).toBe('http://localhost:8787');
		expect(redirected.searchParams.get('state')).toBe('state-1');
		const token = await worker.fetch(
			new Request('https://worker.test/oauth/token', {
				method: 'POST',
				headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
				body: new URLSearchParams({
					grant_type: 'authorization_code',
					code: redirected.searchParams.get('code'),
					redirect_uri: 'http://localhost:8787/callback',
					client_id: 'momo-grok-bot',
					code_verifier: verifier,
				}),
			}),
			used,
		);
		const issued = await token.json();
		expect(issued.token_type).toBe('Bearer');
		expect(issued.access_token).toBe(PASSWORD);
		const listed = await worker.fetch(
			new Request('https://worker.test/mcp', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${issued.access_token}` },
				body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
			}),
			used,
		);
		expect(listed.status).toBe(200);
	});

	it('rejects the wrong connector password', async () => {
		const challenge = await pkceS256('b'.repeat(50));
		const response = await worker.fetch(
			new Request('https://worker.test/oauth/authorize', {
				method: 'POST',
				headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
				body: new URLSearchParams({
					password: 'not-the-password',
					client_id: 'momo-grok-bot',
					redirect_uri: 'http://127.0.0.1:8787/callback',
					code_challenge: challenge,
					code_challenge_method: 'S256',
				}),
			}),
			env(),
		);
		expect(response.status).toBe(200);
		expect(await response.text()).toContain('not accepted');
	});
});
