/**
 * Local dictation engine (fork, 2026-11-13): NVIDIA Parakeet TDT 0.6B v3
 * (int8 ONNX) run on the CPU through sherpa-onnx-node. The dictation hook
 * falls back to it when no Deepgram key is configured, so dictation works
 * with no account. Audio never leaves this machine; the only network use is
 * the one-time model download from Hugging Face (a pinned revision).
 */
import os from "node:os";
import { speechModel } from "./model-download.ts";

const model = speechModel({
	repo: "csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8",
	revision: "ed5d745623472f97cfc2e6c2916ee248798fc5a8",
	wanted: (file) => ["encoder.int8.onnx", "decoder.int8.onnx", "joiner.int8.onnx", "tokens.txt"].includes(file),
});
const modelFile = model.file;
const SAMPLE_RATE = 16000;

/** Whether the model is on disk; starts its one-time download when it is not. */
export const localSttStatus = () => model.status();

/** Little-endian PCM16 bytes (the capture worklet's frames) → samples in −1..1. */
export function pcm16ToFloat32(bytes: Uint8Array): Float32Array {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength - (bytes.byteLength % 2));
	const samples = new Float32Array(view.byteLength / 2);
	for (let i = 0; i < samples.length; i++) samples[i] = view.getInt16(i * 2, true) / 32768;
	return samples;
}

/** Cut long audio into pieces of at most `max` samples, each cut placed at the
 *  quietest 100 ms between `min` and `max`, so a cut lands in a pause and not
 *  mid-word. Keeps decode memory bounded however long the dictation runs. */
export function splitAtPauses(samples: Float32Array, min = 20 * SAMPLE_RATE, max = 30 * SAMPLE_RATE, window = SAMPLE_RATE / 10): Float32Array[] {
	const pieces: Float32Array[] = [];
	let start = 0;
	while (samples.length - start > max) {
		let cut = start + max;
		let quietest = Infinity;
		for (let at = start + min; at + window <= start + max; at += window) {
			let energy = 0;
			for (let i = at; i < at + window; i++) energy += samples[i]! * samples[i]!;
			if (energy < quietest) {
				quietest = energy;
				cut = at + window / 2;
			}
		}
		pieces.push(samples.subarray(start, cut));
		start = cut;
	}
	pieces.push(samples.subarray(start));
	return pieces;
}

type Stream = { acceptWaveform(wave: { sampleRate: number; samples: Float32Array }): void };
type Recognizer = {
	createStream(): Stream;
	decodeAsync(stream: Stream): Promise<unknown>;
	getResult(stream: Stream): { text: string };
};

// shortcut: once loaded the model stays in memory (about 1.5 GB of RAM) until
// the app closes; add an explicit unload if that ever matters.
let recognizer: Promise<Recognizer> | null = null;

async function loadRecognizer(): Promise<Recognizer> {
	// @ts-expect-error sherpa-onnx-node ships no type declarations
	const sherpa = (await import("sherpa-onnx-node")) as { OfflineRecognizer: { createAsync(config: unknown): Promise<Recognizer> } };
	return sherpa.OfflineRecognizer.createAsync({
		featConfig: { sampleRate: SAMPLE_RATE, featureDim: 80 },
		modelConfig: {
			transducer: { encoder: modelFile("encoder.int8.onnx"), decoder: modelFile("decoder.int8.onnx"), joiner: modelFile("joiner.int8.onnx") },
			tokens: modelFile("tokens.txt"),
			numThreads: Math.min(4, os.availableParallelism()),
			provider: "cpu",
			modelType: "nemo_transducer",
		},
	});
}

/** Transcribe 16 kHz mono PCM16. Parakeet v3 detects the language itself
 *  (25 European languages) and adds punctuation and capitals. */
export async function transcribeLocally(pcm: Uint8Array): Promise<string> {
	recognizer ??= loadRecognizer().catch((error: unknown) => {
		recognizer = null; // failed load: retry on the next dictation
		throw error;
	});
	const engine = await recognizer;
	const texts: string[] = [];
	for (const piece of splitAtPauses(pcm16ToFloat32(pcm))) {
		const stream = engine.createStream();
		stream.acceptWaveform({ sampleRate: SAMPLE_RATE, samples: piece });
		await engine.decodeAsync(stream);
		const text = engine.getResult(stream).text.trim();
		if (text) texts.push(text);
	}
	return texts.join(" ");
}
