import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from '../src/index.js';

const GROK = 'grok-secret-test-only';
const QWEN = 'qwen-secret-test-only';
const DEEP = 'deepseek-secret-test-only';
const NVIDIA = 'nvidia-secret-test-only';
const TOKEN = 'Bearer github-test-only-token';
const ENV = {
	XAI_API_KEY: GROK,
	DASHSCOPE_API_KEY: QWEN,
	DEEPSEEK_API_KEY: DEEP,
	NVIDIA_API_KEY: NVIDIA,
	QWEN_BASE_URL: 'https://token-plan.maas.qwencloudapi.com/compatible-mode/v1',
	QWEN_ALLOWED_GITHUB_USER: 'anthonymankaho',
};
const targets = [
	{ provider: 'grok', model: 'grok-4.7' },
	{ provider: 'qwen', model: 'qwen3.8-max' },
	{ provider: 'deepseek', model: 'deepseek-flash' },
	{ provider: 'nvidia', model: 'nvidia/nemotron-3.5-lightning-30b-a3b' },
];
function request(payload, auth = TOKEN) {
	return new Request('https://worker.test', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', Origin: 'https://anthonymankaho.github.io', ...(auth ? { Authorization: auth } : {}) },
		body: JSON.stringify({ action: 'ai-group', payload }),
	});
}
function completion(text, usage = { prompt_tokens: 5, completion_tokens: 7 }) {
	return Response.json({ choices: [{ message: { content: text } }], usage });
}
afterEach(() => vi.unstubAllGlobals());

describe('AI Group', () => {
	it('requires GitHub before any provider is called', async () => {
		const mock = vi.fn();
		vi.stubGlobal('fetch', mock);
		const response = await worker.fetch(request({ message: 'Hello', targets: targets.slice(0, 1) }, ''), ENV);
		expect(response.status).toBe(401);
		expect(mock).not.toHaveBeenCalled();
	});

	it('asks the selected models and hides every secret', async () => {
		const mock = vi.fn(async (url) => {
			if (String(url).includes('github.com')) return Response.json({ login: 'anthonymankaho' });
			const name = String(url).includes('x.ai') ? 'grok' : String(url).includes('qwen') ? 'qwen' : String(url).includes('deepseek') ? 'deepseek' : 'nvidia';
			return completion(`${name} says 2`);
		});
		vi.stubGlobal('fetch', mock);
		const kv = { get: async () => '0', put: async (key, value) => { kv.saved = [key, value]; } };
		const response = await worker.fetch(request({ message: 'What is 1+1?', targets }), { ...ENV, QWEN_USAGE: kv });
		expect(response.status).toBe(200);
		const body = await response.json();
		expect(body.results.map((row) => row.provider)).toEqual(['grok', 'qwen', 'deepseek', 'nvidia']);
		expect(body.results.every((row) => row.ok)).toBe(true);
		expect(body.quota.used).toBe(48);
		expect(kv.saved[0]).toMatch(/^ai-group-usage:anthonymankaho:\d{4}-\d{2}$/);
		const urls = mock.mock.calls.map((call) => String(call[0]));
		expect(urls).toContain('https://api.x.ai/v1/chat/completions');
		expect(urls).toContain('https://token-plan.maas.qwencloudapi.com/compatible-mode/v1/chat/completions');
		expect(urls).toContain('https://api.deepseek.com/chat/completions');
		expect(urls).toContain('https://integrate.api.nvidia.com/v1/chat/completions');
		const qwen = mock.mock.calls.find((call) => String(call[0]).includes('qwen'));
		expect(JSON.parse(qwen[1].body).model).toBe('qwen3.8-max');
		expect(qwen[1].headers.Authorization).toBe(`Bearer ${QWEN}`);
		expect(JSON.stringify(body).includes(GROK)).toBe(false);
		expect(JSON.stringify(body).includes(QWEN)).toBe(false);
	});

	it('returns a column error when that provider has no secret', async () => {
		const mock = vi.fn(async (url) => (String(url).includes('github.com') ? Response.json({ login: 'anthonymankaho' }) : completion('ok')));
		vi.stubGlobal('fetch', mock);
		const { DEEPSEEK_API_KEY, ...rest } = ENV;
		const response = await worker.fetch(request({ message: 'Hello', targets: targets.slice(2, 4) }), rest);
		const body = await response.json();
		expect(body.results[0]).toMatchObject({ provider: 'deepseek', ok: false });
		expect(body.results[1].ok).toBe(true);
		expect(mock.mock.calls.some((call) => String(call[0]).includes('deepseek.com'))).toBe(false);
	});

	it('rejects a model that is not on the list', async () => {
		const mock = vi.fn(async () => Response.json({ login: 'anthonymankaho' }));
		vi.stubGlobal('fetch', mock);
		const response = await worker.fetch(request({ message: 'Hello', targets: [{ provider: 'grok', model: 'grok-other' }] }), ENV);
		expect(response.status).toBe(400);
		expect(mock).not.toHaveBeenCalled();
	});

	it('keeps the other answers when one provider fails', async () => {
		const mock = vi.fn(async (url) => {
			if (String(url).includes('github.com')) return Response.json({ login: 'anthonymankaho' });
			if (String(url).includes('x.ai')) return new Response('no', { status: 500 });
			return completion('qwen ok');
		});
		vi.stubGlobal('fetch', mock);
		const response = await worker.fetch(request({ message: 'Hello', targets: targets.slice(0, 2) }), ENV);
		const body = await response.json();
		expect(body.results[0].ok).toBe(false);
		expect(body.results[1]).toMatchObject({ ok: true, text: 'qwen ok' });
	});

	it('sends a text file with the question', async () => {
		const mock = vi.fn(async (url) => (String(url).includes('github.com') ? Response.json({ login: 'anthonymankaho' }) : completion('saw the file')));
		vi.stubGlobal('fetch', mock);
		const response = await worker.fetch(request({
			message: '',
			attachments: [{ name: 'notes.txt', kind: 'text', text: 'invoice 42' }],
			targets: targets.slice(0, 1),
		}), ENV);
		expect(response.status).toBe(200);
		const grok = mock.mock.calls.find((call) => String(call[0]).includes('x.ai'));
		const content = JSON.parse(grok[1].body).messages[1].content;
		expect(content).toContain('[File: notes.txt]');
		expect(content).toContain('invoice 42');
	});

	it('sends an image as a picture part', async () => {
		const mock = vi.fn(async (url) => (String(url).includes('github.com') ? Response.json({ login: 'anthonymankaho' }) : completion('saw the picture')));
		vi.stubGlobal('fetch', mock);
		const image = 'data:image/png;base64,iVBORw0KGgo=';
		const response = await worker.fetch(request({
			message: 'What is this?',
			attachments: [{ name: 'shot.png', kind: 'image', image }],
			targets: targets.slice(0, 1),
		}), ENV);
		expect(response.status).toBe(200);
		const grok = mock.mock.calls.find((call) => String(call[0]).includes('x.ai'));
		const content = JSON.parse(grok[1].body).messages[1].content;
		expect(content[0].text).toContain('[Image: shot.png]');
		expect(content[1]).toEqual({ type: 'image_url', image_url: { url: image } });
	});

	it('rejects more than 8 files and a bad image', async () => {
		const mock = vi.fn();
		vi.stubGlobal('fetch', mock);
		const many = Array.from({ length: 9 }, (_, index) => ({ name: `f${index}.txt`, kind: 'text', text: 'a' }));
		const tooMany = await worker.fetch(request({ message: 'Hello', attachments: many, targets: targets.slice(0, 1) }), ENV);
		expect(tooMany.status).toBe(400);
		const badImage = await worker.fetch(request({
			message: 'Hello',
			attachments: [{ name: 'x.bin', kind: 'image', image: 'data:image/svg+xml;base64,AAAA' }],
			targets: targets.slice(0, 1),
		}), ENV);
		expect(badImage.status).toBe(400);
		expect(mock).not.toHaveBeenCalled();
	});

	it('lets Qwen read DeepSeek and NVIDIA read Qwen', async () => {
		const mock = vi.fn(async (url) => (String(url).includes('github.com') ? Response.json({ login: 'anthonymankaho' }) : completion('ok')));
		vi.stubGlobal('fetch', mock);
		const response = await worker.fetch(request({
			message: 'What did the others say?',
			history: [
				{ name: 'You', text: 'Hello group' },
				{ name: 'DeepSeek', text: 'deepseek-said-this', fresh: true },
				{ name: 'Qwen', text: 'qwen-said-this', fresh: true },
				{ name: 'NVIDIA', text: 'nvidia-said-this', fresh: true },
			],
			targets: [
				{ provider: 'qwen', model: 'qwen3.8-max' },
				{ provider: 'nvidia', model: 'nvidia/nemotron-3.5-lightning-30b-a3b' },
			],
		}), ENV);
		expect(response.status).toBe(200);
		const bodyOf = (host) => JSON.parse(mock.mock.calls.find((call) => String(call[0]).includes(host))[1].body).messages[1].content;
		const qwen = bodyOf('qwen');
		const nvidia = bodyOf('nvidia');
		expect(qwen).toContain('DeepSeek: deepseek-said-this');
		expect(qwen).toContain('NVIDIA: nvidia-said-this');
		expect(qwen).not.toContain('qwen-said-this');
		expect(qwen).toContain('You: Hello group');
		expect(nvidia).toContain('Qwen: qwen-said-this');
		expect(nvidia).toContain('DeepSeek: deepseek-said-this');
		expect(nvidia).not.toContain('nvidia-said-this');
	});

	it('speaks one by one and passes each reply to the next member', async () => {
		const mock = vi.fn(async (url, init) => {
			if (String(url).includes('github.com')) return Response.json({ login: 'anthonymankaho' });
			const model = JSON.parse(init.body).model;
			const text = model.includes('deepseek') ? 'deepseek-turn' : model.includes('qwen') ? 'qwen-turn' : 'nvidia-turn';
			return completion(text);
		});
		vi.stubGlobal('fetch', mock);
		const response = await worker.fetch(request({
			message: 'Go',
			targets: [
				{ provider: 'deepseek', model: 'deepseek-flash' },
				{ provider: 'qwen', model: 'qwen3.8-max' },
				{ provider: 'nvidia', model: 'nvidia/nemotron-3.5-lightning-30b-a3b' },
			],
		}), ENV);
		expect(response.status).toBe(200);
		const providers = mock.mock.calls.map((call) => String(call[0])).filter((url) => !url.includes('github.com'));
		expect(providers.map((url) => (url.includes('deepseek') ? 'deepseek' : url.includes('qwen') ? 'qwen' : 'nvidia'))).toEqual(['deepseek', 'qwen', 'nvidia']);
		const bodyOf = (host) => JSON.parse(mock.mock.calls.find((call) => String(call[0]).includes(host))[1].body).messages[1].content;
		expect(bodyOf('deepseek')).not.toContain('qwen-turn');
		expect(bodyOf('qwen')).toContain('DeepSeek: deepseek-turn');
		expect(bodyOf('qwen')).not.toContain('qwen-turn');
		expect(bodyOf('nvidia')).toContain('Qwen: qwen-turn');
		expect(bodyOf('nvidia')).toContain('DeepSeek: deepseek-turn');
	});

	it('rejects a group thread that is too long', async () => {
		const mock = vi.fn();
		vi.stubGlobal('fetch', mock);
		const history = Array.from({ length: 25 }, () => ({ name: 'You', text: 'again' }));
		const response = await worker.fetch(request({ message: 'Hello', history, targets: targets.slice(0, 1) }), ENV);
		expect(response.status).toBe(400);
		expect(mock).not.toHaveBeenCalled();
	});

	it('stops when the monthly quota is spent', async () => {
		const mock = vi.fn(async () => Response.json({ login: 'anthonymankaho' }));
		vi.stubGlobal('fetch', mock);
		const response = await worker.fetch(request({ message: 'Hello', targets: targets.slice(0, 1) }), {
			...ENV,
			QWEN_USAGE: { get: async () => '1000000', put: async () => {} },
		});
		expect(response.status).toBe(429);
		expect(mock).toHaveBeenCalledTimes(1);
	});
});
