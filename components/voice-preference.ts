"use client";

import { useSyncExternalStore } from "react";
import { resolveSettings, sanitizeUserSettings, type UserSettings, type VoiceSettings } from "@/src/core";
import { notifySettingsSaved, onSettingsSaved } from "@/components/settings-signal";

/** The app-wide voice section, shaped like the dictation store: one confirmed
 * value per window, a re-read only when another writer announces a save.
 * Writes queue (each PUT replaces the whole section) and the snapshot shows
 * the latest intent, so a second change made before the first confirms is
 * built on it rather than on the stale confirmed value.
 */
export function createVoiceStore(request: typeof fetch, saved: () => void = () => {}) {
	let snapshot: VoiceSettings | undefined;
	let confirmed: VoiceSettings | undefined;
	let reading: Promise<VoiceSettings> | null = null;
	let writing: Promise<void> = Promise.resolve();
	let pendingWrites = 0;
	let revision = 0;
	let needsRead = true;
	const listeners = new Set<() => void>();
	const publish = (next: VoiceSettings | undefined) => {
		snapshot = next;
		for (const listener of listeners) listener();
	};
	const voiceOf = (raw: unknown) => resolveSettings(sanitizeUserSettings(raw)).voice;

	function load(refresh = false): Promise<VoiceSettings> {
		if (pendingWrites) return getVoice();
		if (reading && !refresh) return reading;
		if (!refresh && !needsRead && confirmed !== undefined) return Promise.resolve(confirmed);
		const version = ++revision;
		needsRead = true;
		reading = Promise.resolve().then(async () => {
			try {
				const res = await request("/api/settings");
				if (!res.ok) throw new Error();
				const body = await res.json() as { settings: UserSettings | null };
				if (!("settings" in body)) throw new Error();
				if (body.settings !== null && sanitizeUserSettings(body.settings) === null) throw new Error();
				if (version !== revision) return getVoice();
				const voice = voiceOf(body.settings);
				confirmed = voice;
				needsRead = false;
				publish(voice);
				return voice;
			} catch {
				if (version !== revision) return getVoice();
				throw new Error("Could not load voice settings. Try again.");
			} finally {
				if (version === revision) reading = null;
			}
		});
		return reading;
	}

	function save(next: VoiceSettings): Promise<void> {
		revision++;
		reading = null;
		pendingWrites++;
		publish(next);
		const run = writing.catch(() => {}).then(async () => {
			try {
				const res = await request("/api/settings/voice", {
					method: "PUT", headers: { "Content-Type": "application/json" },
					body: JSON.stringify(next),
				});
				if (!res.ok) throw new Error();
				const body = await res.json() as { settings: UserSettings };
				if (body.settings?.voice === undefined) throw new Error();
				confirmed = voiceOf(body.settings);
				needsRead = false;
				saved();
			} catch {
				throw new Error("Could not save voice settings. Try again.");
			} finally {
				// The last write in the queue settles the snapshot to what the server holds.
				if (--pendingWrites === 0) publish(confirmed);
			}
		});
		writing = run;
		return run;
	}

	async function getVoice(): Promise<VoiceSettings> {
		for (;;) {
			if (pendingWrites) await writing.catch(() => {});
			else if (reading) await reading;
			else if (needsRead || confirmed === undefined) await load();
			else return confirmed;
		}
	}

	return {
		load, save, getVoice,
		getSnapshot: () => snapshot,
		getServerSnapshot: () => undefined,
		subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
	};
}

let announcingSave = false;
const store = createVoiceStore((...args) => fetch(...args), () => {
	announcingSave = true;
	try { notifySettingsSaved("voice"); } finally { announcingSave = false; }
});
let watching = false;

// Window-lifetime, unlike dictation's per-reader listener: getVoicePreference
// callers outside React have no subscription to hang it on.
function watchExternalSaves() {
	if (watching || typeof window === "undefined") return;
	watching = true;
	onSettingsSaved((section) => {
		if (section === "voice" && !announcingSave) void store.load(true).catch(() => {});
	});
}

function subscribe(listener: () => void) {
	watchExternalSaves();
	void store.getVoice().catch(() => {});
	return store.subscribe(listener);
}

export function useVoicePreference(): {
	/** undefined until the first settings read resolves. */
	voice: VoiceSettings | undefined;
	/** Saves the whole section. Rejects on failure. */
	setVoice: (next: VoiceSettings) => Promise<void>;
} {
	const voice = useSyncExternalStore(subscribe, store.getSnapshot, store.getServerSnapshot);
	return { voice, setVoice: store.save };
}

/** The confirmed value for code outside React (cached; waits for writes). */
export function getVoicePreference(): Promise<VoiceSettings> {
	watchExternalSaves();
	return store.getVoice();
}
