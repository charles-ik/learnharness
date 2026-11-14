import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { FACTORY_SETTINGS, sanitizeUserSettings } from "../src/core/settings.ts";
import { resolveSettings } from "../src/core/settings-resolution.ts";
import { parseVoiceSettingsBody } from "../src/server/settings-body.ts";

const resolvedVoice = (voice: unknown) => resolveSettings(sanitizeUserSettings({ version: 1, voice, general: { autoUpdate: false } })).voice;

describe("voice settings section", () => {
	it("defaults to silent replies at normal speed, old records included", () => {
		assert.deepEqual(FACTORY_SETTINGS.voice, { speakReplies: false, speed: 1 });
		assert.deepEqual(resolveSettings(null).voice, { speakReplies: false, speed: 1 });
		assert.deepEqual(resolveSettings({ version: 1 }).voice, { speakReplies: false, speed: 1 });
	});

	it("explicit stored values resolve", () => {
		assert.deepEqual(resolvedVoice({ speakReplies: true, speed: 1.4 }), { speakReplies: true, speed: 1.4 });
		assert.deepEqual(resolvedVoice({ speed: 2 }), { speakReplies: false, speed: 2 });
	});

	it("sanitising clamps and rounds speed, drops bad values and extra keys, keeps other sections", () => {
		assert.equal(resolvedVoice({ speed: 9 }).speed, 2);
		assert.equal(resolvedVoice({ speed: 0.1 }).speed, 0.5);
		assert.equal(resolvedVoice({ speed: -3 }).speed, 0.5);
		assert.equal(resolvedVoice({ speed: 1.26 }).speed, 1.3);
		for (const speed of [Number.NaN, Number.POSITIVE_INFINITY, "1.5", null, true]) {
			assert.equal(resolvedVoice({ speed }).speed, 1, String(speed));
		}
		for (const speakReplies of ["yes", 1, null]) {
			assert.equal(resolvedVoice({ speakReplies }).speakReplies, false, String(speakReplies));
		}
		for (const voice of [null, [], "on", 3]) {
			assert.deepEqual(resolvedVoice(voice), { speakReplies: false, speed: 1 });
		}
		const record = sanitizeUserSettings({ version: 1, voice: { speakReplies: true, speed: 1, extra: "x" }, general: { autoUpdate: false } });
		assert.deepEqual(record?.voice, { speakReplies: true, speed: 1 });
		assert.equal(record?.general?.autoUpdate, false);
	});

	it("the save-body parser accepts a full valid object and rejects malformed ones", () => {
		assert.deepEqual(parseVoiceSettingsBody({ speakReplies: true, speed: 1.2 }), { ok: true, settings: { speakReplies: true, speed: 1.2 } });
		assert.deepEqual(parseVoiceSettingsBody({ speakReplies: false, speed: 0.5 }), { ok: true, settings: { speakReplies: false, speed: 0.5 } });
		assert.deepEqual(parseVoiceSettingsBody({ speakReplies: false, speed: 1.26 }), { ok: true, settings: { speakReplies: false, speed: 1.3 } });
		assert.deepEqual(parseVoiceSettingsBody({}), { ok: true, settings: {} });
		assert.deepEqual(parseVoiceSettingsBody({ speakReplies: true, speed: 1, extra: 1 }), { ok: true, settings: { speakReplies: true, speed: 1 } });
		for (const body of [
			null, [], "on", { speakReplies: "yes" }, { speakReplies: 1 }, { speed: "1" }, { speed: Number.NaN },
			{ speed: 0.4 }, { speed: 2.1 }, { speed: null }, { speakReplies: true, speed: 5 },
		]) {
			assert.equal(parseVoiceSettingsBody(body).ok, false, JSON.stringify(body));
		}
	});
});

const testData = mkdtempSync(path.join(tmpdir(), "lh-voice-settings-"));
process.env.LH_DATA_DIR = testData;
after(() => { rmSync(testData, { recursive: true, force: true }); });
const { readSettings, writeSettings } = await import("../src/store/settings.ts");

it("the section route replaces voice independently and rejects bad values without writing", async () => {
	const { PUT } = await import("../app/api/settings/[section]/route.ts");
	writeSettings({ version: 1, dictation: { language: "pl" } });
	const put = (body: unknown) => PUT(new Request("http://localhost/api/settings/voice", {
		method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
	}), { params: Promise.resolve({ section: "voice" }) });
	const ok = await put({ speakReplies: true, speed: 1.4 });
	assert.equal(ok.status, 200);
	const saved = { version: 1, dictation: { language: "pl" }, voice: { speakReplies: true, speed: 1.4 } };
	assert.deepEqual(readSettings(), saved);
	assert.deepEqual((await ok.json()).settings.voice, saved.voice);
	assert.equal((await put({ speakReplies: true, speed: 3 })).status, 400);
	assert.deepEqual(readSettings(), saved);
});
