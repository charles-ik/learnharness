import assert from "node:assert/strict";
import { test } from "node:test";
import type { VoiceSettings } from "../src/core/settings.ts";
import { createVoiceStore } from "../components/voice-preference.ts";

const settings = (voice?: Partial<VoiceSettings>) => Response.json({ settings: { version: 1, ...(voice ? { voice } : {}) } });

test("a missing section resolves to the factory value and is read once", async () => {
	let reads = 0;
	const store = createVoiceStore(async () => { reads++; return Response.json({ settings: null }); });
	assert.equal(store.getSnapshot(), undefined);
	assert.deepEqual(await Promise.all([store.getVoice(), store.load()]), [{ speakReplies: false, speed: 1 }, { speakReplies: false, speed: 1 }]);
	assert.deepEqual(await store.getVoice(), { speakReplies: false, speed: 1 });
	assert.equal(reads, 1);
});

test("a confirmed write sends the whole section and readers get it without another GET", async () => {
	let reads = 0;
	let notifications = 0;
	const bodies: unknown[] = [];
	const store = createVoiceStore(async (_url, init) => {
		if (init?.method === "PUT") {
			bodies.push(JSON.parse(init.body as string));
			return settings(JSON.parse(init.body as string));
		}
		reads++;
		return settings({ speed: 1.2 });
	}, () => { notifications++; });
	assert.deepEqual(await store.load(), { speakReplies: false, speed: 1.2 });
	await store.save({ speakReplies: true, speed: 1.2 });
	assert.deepEqual(bodies, [{ speakReplies: true, speed: 1.2 }]);
	assert.deepEqual(await store.getVoice(), { speakReplies: true, speed: 1.2 });
	assert.deepEqual(store.getSnapshot(), { speakReplies: true, speed: 1.2 });
	assert.equal(reads, 1);
	assert.equal(notifications, 1);
});

test("a failed write rejects and the snapshot returns to the confirmed value", async () => {
	const store = createVoiceStore(async (_url, init) => init?.method === "PUT"
		? Response.json({ error: "no" }, { status: 400 })
		: settings({ speakReplies: false, speed: 1 }));
	await store.load();
	const seen: (VoiceSettings | undefined)[] = [];
	const off = store.subscribe(() => { seen.push(store.getSnapshot()); });
	await assert.rejects(store.save({ speakReplies: true, speed: 1 }), /Could not save voice settings/);
	assert.deepEqual(seen[0], { speakReplies: true, speed: 1 }, "the intent shows while the write runs");
	assert.deepEqual(store.getSnapshot(), { speakReplies: false, speed: 1 });
	assert.deepEqual(await store.getVoice(), { speakReplies: false, speed: 1 });
	off();
});

test("writes queue in order and getVoice waits for the last one", async () => {
	const order: unknown[] = [];
	let release!: () => void;
	const gate = new Promise<void>((resolve) => { release = resolve; });
	const store = createVoiceStore(async (_url, init) => {
		if (init?.method !== "PUT") return settings();
		const body = JSON.parse(init.body as string);
		if (order.length === 0) { order.push(body); await gate; } else order.push(body);
		return settings(body);
	});
	await store.load();
	const first = store.save({ speakReplies: true, speed: 1 });
	const second = store.save({ speakReplies: true, speed: 1.6 });
	const read = store.getVoice();
	assert.deepEqual(store.getSnapshot(), { speakReplies: true, speed: 1.6 });
	release();
	await Promise.all([first, second]);
	assert.deepEqual(order, [{ speakReplies: true, speed: 1 }, { speakReplies: true, speed: 1.6 }]);
	assert.deepEqual(await read, { speakReplies: true, speed: 1.6 });
});

test("a stale read cannot overwrite a newer write; a failed refresh rejects until retried", async () => {
	let stale!: (response: Response) => void;
	let nextRead: Promise<Response> | undefined;
	let fail = false;
	const store = createVoiceStore(async (_url, init) => {
		if (init?.method === "PUT") return settings(JSON.parse(init.body as string));
		if (nextRead) { const response = nextRead; nextRead = undefined; return response; }
		return fail ? Response.json({}, { status: 500 }) : settings({ speed: 0.8 });
	});
	await store.load();
	nextRead = new Promise((resolve) => { stale = resolve; });
	const oldRead = store.load(true);
	await Promise.resolve();
	await store.save({ speakReplies: true, speed: 2 });
	stale(settings({ speed: 0.8 }));
	assert.deepEqual(await oldRead, { speakReplies: true, speed: 2 });
	assert.deepEqual(store.getSnapshot(), { speakReplies: true, speed: 2 });
	fail = true;
	await assert.rejects(store.load(true), /Could not load voice settings/);
	await assert.rejects(store.getVoice(), /Could not load/);
	fail = false;
	assert.deepEqual(await store.getVoice(), { speakReplies: false, speed: 0.8 });
});
