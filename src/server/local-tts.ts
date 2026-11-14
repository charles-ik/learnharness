/**
 * Spoken replies (fork, 2026-11-13): Kokoro-82M v1.0 run on the CPU through
 * sherpa-onnx-node, the same library local dictation uses. The renderer
 * sends one sentence at a time and plays the audio it gets back. Text never
 * leaves this machine; the only network use is the one-time model download.
 *
 * sherpa-onnx-node stays on 1.12.x: 2.x dropped the espeak-ng fallback and
 * silently skips every word missing from the lexicon ("backpropagation").
 */
import os from "node:os";
import { speechModel } from "./model-download.ts";

const model = speechModel({
	repo: "csukuangfj/kokoro-multi-lang-v1_0",
	revision: "f7b96bb6bef5c5da4d3aa4f4e0498fbbf62dc78b",
	wanted: (file) => ["model.onnx", "voices.bin", "tokens.txt", "lexicon-us-en.txt"].includes(file) || file.startsWith("espeak-ng-data/"),
});

/** Whether the voice is on disk; starts its one-time download when it is not. */
export const localTtsStatus = () => model.status();

// shortcut: one fixed voice (af_heart, speaker 3 of 54); add a setting when
// the owner wants to choose.
const VOICE = 3;

export type SpokenAudio = { samples: Float32Array; sampleRate: number };
type Tts = { generateAsync(request: { text: string; sid: number; speed: number; enableExternalBuffer: boolean }): Promise<SpokenAudio> };

let tts: Tts | null = null;
/** One sentence at a time: parallel runs would only fight over the same cores. */
let queue: Promise<unknown> = Promise.resolve();

async function loadVoice(): Promise<Tts> {
	// @ts-expect-error sherpa-onnx-node ships no type declarations
	const sherpa = (await import("sherpa-onnx-node")) as { OfflineTts: new (config: unknown) => Tts };
	return new sherpa.OfflineTts({
		model: {
			kokoro: {
				model: model.file("model.onnx"),
				voices: model.file("voices.bin"),
				tokens: model.file("tokens.txt"),
				dataDir: model.file("espeak-ng-data"),
				lexicon: model.file("lexicon-us-en.txt"),
				lang: "en-us",
			},
			numThreads: Math.min(4, os.availableParallelism()),
			provider: "cpu",
		},
		maxNumSentences: 1,
	});
}

/** Speak one short passage. `speed` is a multiplier (1 = the voice's own pace). */
export function synthesize(text: string, speed: number): Promise<SpokenAudio> {
	const run = queue.then(async () => {
		tts ??= await loadVoice();
		// Electron's Node forbids external ArrayBuffers, which is how the library
		// returns audio by default ("TTS settlement failed" in the packaged app).
		return tts.generateAsync({ text, sid: VOICE, speed, enableExternalBuffer: false });
	});
	queue = run.catch(() => {});
	return run;
}

/** Samples in −1..1 → little-endian PCM16 bytes for the response body. */
export function floatToPcm16(samples: Float32Array): Uint8Array<ArrayBuffer> {
	const bytes = new Uint8Array(samples.length * 2);
	const view = new DataView(bytes.buffer);
	for (let i = 0; i < samples.length; i++) {
		view.setInt16(i * 2, Math.round(Math.max(-1, Math.min(1, samples[i]!)) * 32767), true);
	}
	return bytes;
}
