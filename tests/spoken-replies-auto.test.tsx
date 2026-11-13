/** Auto-read (fork): with Voice on, a finished turn is spoken, and only the
 *  prose and question stems that arrived in that turn. */
import React, { act } from "react";
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { parseHTML } from "linkedom";
import { spokenTextOf, useAutoSpeak } from "../components/spoken-replies.tsx";
import { notifySettingsSaved } from "../components/settings-signal.ts";

class Source {
	onended: (() => void) | null = null;
	connect() {}
	start() {}
	stop() {}
}
class Context {
	state = "running";
	currentTime = 0;
	destination = {};
	createBuffer(_channels: number, length: number, rate: number) {
		return { duration: length / rate, getChannelData: () => new Float32Array(length) };
	}
	createBufferSource() { return new Source(); }
}

type Message = Parameters<typeof spokenTextOf>[0];
const globals = globalThis as Record<string, unknown>;
let restore: (() => void) | undefined;
let dispose: (() => Promise<void>) | undefined;

async function fixture() {
	const dom = parseHTML("<html><body><div id='root'></div></body></html>");
	const state = { voice: { speakReplies: false, speed: 1 }, spoken: [] as { text: string; speed: number }[] };
	const previous = new Map<string, PropertyDescriptor | undefined>();
	for (const [key, value] of Object.entries({
		React, window: dom.window, document: dom.document, CustomEvent: dom.window.CustomEvent,
		AudioContext: Context, IS_REACT_ACT_ENVIRONMENT: true,
		fetch: async (url: string, init?: RequestInit) => {
			if (url === "/api/settings") return Response.json({ settings: { version: 1, voice: state.voice } });
			assert.equal(url, "/api/tts");
			state.spoken.push(JSON.parse(init!.body as string) as { text: string; speed: number });
			return new Response(new Int16Array(2400).buffer, { headers: { "X-Sample-Rate": "24000" } });
		},
	})) {
		previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
		Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
	}
	restore = () => {
		for (const [key, descriptor] of previous) {
			if (descriptor) Object.defineProperty(globalThis, key, descriptor);
			else delete globals[key];
		}
	};
	const { createRoot } = await import("react-dom/client");
	function Harness({ messages, status }: { messages: Message[]; status: string }) {
		useAutoSpeak(messages, status);
		return null;
	}
	const root = createRoot(document.getElementById("root")!);
	dispose = async () => { await act(async () => { root.unmount(); }); };
	return {
		state,
		render: (messages: Message[], status: string) => act(async () => { root.render(<Harness messages={messages} status={status} />); }),
		/** The Settings screen saved a new value. */
		save: (voice: { speakReplies: boolean; speed: number }) => act(async () => { state.voice = voice; notifySettingsSaved("voice"); }),
	};
}

afterEach(async () => { await dispose?.(); restore?.(); dispose = undefined; restore = undefined; });

const learner: Message = { id: "u1", role: "user", parts: [{ type: "text", text: "Never spoken." }] };
const first: Message = { id: "a1", role: "assistant", parts: [{ type: "text", text: "First reply." }] };
const second: Message = { id: "a2", role: "assistant", parts: [
	{ type: "text", text: "New point." },
	{ type: "tool-quiz", input: { context: "Take a guess.", question: "What happens next?", options: [{ label: "Not read" }] } },
] };

test("off: nothing is read. On: a finished turn speaks only what arrived in it, at the saved speed", async () => {
	const f = await fixture();
	await f.render([learner], "ready");
	await f.render([learner], "submitted");
	await f.render([learner, first], "streaming");
	await f.render([learner, first], "ready");
	assert.deepEqual(f.state.spoken, [], "the setting is off");

	await f.save({ speakReplies: true, speed: 1.4 });
	assert.deepEqual(f.state.spoken, [], "switching it on does not read the open chat");
	await f.render([learner, first, learner], "submitted");
	await f.render([learner, first, learner, second], "streaming");
	assert.deepEqual(f.state.spoken, [], "not while it streams");
	await f.render([learner, first, learner, second], "ready");
	assert.deepEqual(f.state.spoken, [
		{ text: "New point.", speed: 1.4 },
		{ text: "Take a guess.", speed: 1.4 },
		{ text: "What happens next?", speed: 1.4 },
	]);
});

test("a message's speak button reads its prose and question stems", () => {
	assert.equal(spokenTextOf({ id: "a", role: "assistant", parts: [
		{ type: "reasoning", text: "private" },
		{ type: "text", text: "Prose." },
		{ type: "tool-explain", input: { question: "Why?" } },
		{ type: "tool-demo", input: { question: "not a question card" } },
	] }), "Prose.\n\nWhy?");
});
