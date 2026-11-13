import assert from "node:assert/strict";
import { test } from "node:test";
import { pcm16ToFloat32, splitAtPauses } from "../src/server/local-stt.ts";

test("PCM16 frames become samples in -1..1, ignoring a trailing odd byte", () => {
	const bytes = new Uint8Array([0x00, 0x00, 0xff, 0x7f, 0x00, 0x80, 0x99]);
	const samples = pcm16ToFloat32(bytes);
	assert.equal(samples.length, 3);
	assert.equal(samples[0], 0);
	assert.ok(Math.abs(samples[1]! - 1) < 1e-4);
	assert.equal(samples[2], -1);
	// A view into a larger buffer (how a request body can arrive) reads its own bytes.
	assert.equal(pcm16ToFloat32(bytes.subarray(2, 4))[0], samples[1]);
});

test("short audio is one piece; long audio is cut inside the quietest pause", () => {
	assert.equal(splitAtPauses(new Float32Array(30), 20, 30, 10).length, 1);

	// Loud audio with silent stretches at 220..239 and 520..539.
	const audio = new Float32Array(1000).fill(0.5);
	audio.fill(0, 220, 240);
	audio.fill(0, 520, 540);
	const pieces = splitAtPauses(audio, 200, 300, 10);
	assert.equal(pieces.reduce((total, piece) => total + piece.length, 0), audio.length);
	assert.ok(pieces.every((piece) => piece.length <= 300));
	assert.ok(pieces[0]!.length >= 220 && pieces[0]!.length <= 240, `first cut at ${pieces[0]!.length}`);
});
