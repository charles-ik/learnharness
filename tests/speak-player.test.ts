/** The spoken-replies player (fork): sentences are voiced one request at a
 *  time, scheduled back to back, and one thing speaks at a time. */
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { speak, stopSpeaking, useSpeech } from "../components/speak.ts";

class Source {
	static all: Source[] = [];
	buffer: { duration: number } | null = null;
	startedAt: number | undefined;
	stopped = false;
	onended: (() => void) | null = null;
	constructor() { Source.all.push(this); }
	connect() {}
	start(at: number) { this.startedAt = at; }
	stop() { this.stopped = true; }
	end() { this.onended?.(); }
}
class Context {
	state = "running";
	currentTime = 10;
	destination = {};
	createBuffer(_channels: number, length: number, rate: number) {
		return { duration: length / rate, getChannelData: () => new Float32Array(length) };
	}
	createBufferSource() { return new Source(); }
}

const globals = globalThis as Record<string, unknown>;
const real = { fetch: globals.fetch, AudioContext: globals.AudioContext };
let requests: { text: string; speed: number }[] = [];
let respond: (text: string) => Response;
/** The store's current value, read the way a component would. */
const speech = () => {
	let value!: ReturnType<typeof useSpeech>;
	// useSyncExternalStore needs React's dispatcher; the store itself is plain.
	speakState((s) => { value = s; });
	return value;
};
let speakState: (read: (s: ReturnType<typeof useSpeech>) => void) => void;

beforeEach(async () => {
	Source.all = [];
	requests = [];
	// One second of 24 kHz audio per sentence.
	respond = () => new Response(new Int16Array(24000).buffer, { headers: { "X-Sample-Rate": "24000" } });
	globals.AudioContext = Context;
	globals.fetch = async (_url: string, init: RequestInit) => {
		const body = JSON.parse(init.body as string) as { text: string; speed: number };
		requests.push(body);
		return respond(body.text);
	};
	const React = await import("react");
	const { renderToString } = await import("react-dom/server");
	speakState = (read) => {
		renderToString(React.createElement(function Probe() { read(useSpeech()); return null; }));
	};
});
afterEach(() => {
	stopSpeaking();
	globals.fetch = real.fetch;
	globals.AudioContext = real.AudioContext;
});

test("each sentence is one request, queued back to back, and the run ends with the last one", async () => {
	await speak("m1", "First **point**. Second point.\n\n```js\nskipped()\n```", 1.4);
	assert.deepEqual(requests, [{ text: "First point.", speed: 1.4 }, { text: "Second point.", speed: 1.4 }]);
	assert.equal(Source.all.length, 2);
	const [first, second] = Source.all as [Source, Source];
	assert.ok(first.startedAt! >= 10);
	assert.ok(Math.abs(second.startedAt! - (first.startedAt! + 1)) < 1e-9, "the second sentence starts where the first ends");
	assert.equal(speech().id, "m1");
	first.end();
	assert.equal(speech().id, "m1");
	second.end();
	assert.equal(speech().id, null);
});

test("starting another message, or stopping, silences what was playing", async () => {
	await speak("m1", "One sentence.", 1);
	const first = Source.all[0]!;
	await speak("m2", "Another sentence.", 1);
	assert.equal(first.stopped, true);
	assert.equal(speech().id, "m2");
	stopSpeaking();
	assert.equal(Source.all[1]!.stopped, true);
	assert.equal(speech().id, null);
});

test("a stop during synthesis discards the audio that arrives afterwards", async () => {
	let release!: () => void;
	const held = new Promise<void>((resolve) => { release = resolve; });
	const audio = respond("");
	globals.fetch = async () => { await held; return audio; };
	const run = speak("m1", "One sentence.", 1);
	stopSpeaking();
	release();
	await run;
	assert.equal(Source.all.length, 0);
	assert.equal(speech().id, null);
});

test("while the voice downloads, the attempt ends with the progress line", async () => {
	respond = () => Response.json({ state: "downloading", progress: 0.42 }, { status: 409 });
	await speak("m1", "One sentence.", 1);
	assert.equal(speech().id, null);
	assert.deepEqual(speech().notice, { id: "m1", text: "Downloading the voice (42%). Try again shortly" });
	assert.equal(Source.all.length, 0);
});

test("a message with nothing to say makes no request", async () => {
	await speak("m1", "```js\nonly code\n```", 1);
	assert.deepEqual(requests, []);
	assert.equal(speech().id, null);
});
