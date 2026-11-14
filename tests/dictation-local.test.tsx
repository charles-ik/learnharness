/** The local engine (fork): with no Deepgram key the run records on this
 *  machine and is transcribed at stop. Its own file, so the module's warm
 *  token cache starts empty (node:test runs each file in its own process). */
import React, { act } from "react";
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { parseHTML } from "linkedom";
import { useDictation, type Dictation } from "../components/dictation.tsx";

class Worklet {
	static last: Worklet | undefined;
	port: { onmessage?: (event: { data: unknown }) => void } = {};
	constructor() { Worklet.last = this; }
	connect() {}
	disconnect() {}
}
class AudioGraph {
	state = "running";
	destination = {};
	audioWorklet = { addModule: async () => {} };
	createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
}
class NoSocket { constructor() { throw new Error("the local engine must not open a socket"); } }

const globals = globalThis as Record<string, unknown>;
let restore: (() => void) | undefined;
let dispose: (() => Promise<void>) | undefined;

async function fixture(status: object) {
	const dom = parseHTML("<html><body><div id='root'></div></body></html>");
	const state = { status, text: "", posted: [] as number[], appends: [] as string[] };
	const previous = new Map<string, PropertyDescriptor | undefined>();
	for (const [key, value] of Object.entries({
		React, window: dom.window, document: dom.document, CustomEvent: dom.window.CustomEvent,
		navigator: { userAgent: "", platform: "", mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) } },
		WebSocket: NoSocket, AudioContext: AudioGraph, AudioWorkletNode: Worklet,
		IS_REACT_ACT_ENVIRONMENT: true,
		fetch: async (url: string, init?: RequestInit) => {
			if (url === "/api/settings") return Response.json({ settings: { version: 1, dictation: { language: "en" } } });
			if (url === "/api/stt/token") return Response.json({ message: "No DEEPGRAM_API_KEY" }, { status: 503 });
			assert.equal(url, "/api/stt/local");
			if (init?.method !== "POST") return Response.json(state.status);
			state.posted.push((init.body as Blob).size);
			return Response.json({ text: state.text });
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
	let latest!: Dictation;
	function Harness() {
		latest = useDictation({ append: (text) => state.appends.push(text) });
		return null;
	}
	const root = createRoot(document.getElementById("root")!);
	await act(async () => { root.render(<Harness />); });
	dispose = async () => { await act(async () => { root.unmount(); }); };
	return { state, get dictation() { return latest; } };
}

afterEach(async () => { await dispose?.(); restore?.(); dispose = undefined; restore = undefined; });

test("with no Deepgram key the recording is transcribed locally and appended once at stop", async () => {
	const f = await fixture({ state: "ready" });
	f.state.text = "hello there";
	await act(async () => { f.dictation.toggle(); });
	assert.equal(f.dictation.phase, "recording");
	assert.equal(f.dictation.error, null);
	const frame = (bytes: number) => Worklet.last!.port.onmessage!({ data: { type: "audio", buffer: new ArrayBuffer(bytes) } });
	frame(4096); frame(4096);
	await act(async () => { await f.dictation.finish(); });
	assert.equal(f.dictation.phase, "idle");
	assert.deepEqual(f.state.posted, [8192]);
	assert.deepEqual(f.state.appends, ["hello there"]);
});

test("while the speech model downloads, the run ends with the progress line and records nothing", async () => {
	const f = await fixture({ state: "downloading", progress: 0.37 });
	await act(async () => { f.dictation.toggle(); });
	assert.equal(f.dictation.phase, "idle");
	assert.equal(f.dictation.error, "Downloading speech model (37%). Try again shortly");
	assert.deepEqual(f.state.posted, []);
	assert.deepEqual(f.state.appends, []);
});

test("cancelling a local run discards the recording", async () => {
	const f = await fixture({ state: "ready" });
	f.state.text = "never appended";
	await act(async () => { f.dictation.toggle(); });
	Worklet.last!.port.onmessage!({ data: { type: "audio", buffer: new ArrayBuffer(4096) } });
	await act(async () => { f.dictation.cancel(); });
	assert.equal(f.dictation.phase, "idle");
	assert.deepEqual(f.state.posted, []);
	assert.deepEqual(f.state.appends, []);
});
