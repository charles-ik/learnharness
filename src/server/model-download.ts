/**
 * One-time download of an on-device speech model (fork, 2026-11-13) from a
 * pinned Hugging Face revision into <data root>/models/<repo name>/. Shared
 * by local dictation (local-stt.ts) and spoken replies (local-tts.ts).
 */
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { PATHS } from "../../config.ts";

export type ModelStatus =
	| { state: "ready" }
	| { state: "downloading"; progress: number }
	| { state: "error"; message: string };

export function speechModel(spec: { repo: string; revision: string; wanted: (file: string) => boolean }) {
	const dir = path.join(/* turbopackIgnore: true */ PATHS.data, "models", spec.repo.split("/")[1]!);
	const file = (name: string) => path.join(/* turbopackIgnore: true */ dir, name);
	/** Written last, holding the revision: its presence means every file landed. */
	const marker = file(".complete");
	let job: { done: number; total: number; error?: string } | null = null;

	async function download(progress: { done: number; total: number }) {
		const hub = `https://huggingface.co/${spec.repo}/resolve/${spec.revision}/`;
		const listing = await fetch(`https://huggingface.co/api/models/${spec.repo}/tree/${spec.revision}?recursive=true&limit=1000`);
		if (!listing.ok) throw new Error(`Speech model listing failed (${listing.status})`);
		// The listing is remote input: take plain relative file paths only.
		const files = ((await listing.json()) as { type: string; path: string; size: number }[])
			.filter((entry) => entry.type === "file" && spec.wanted(entry.path) && !entry.path.split("/").includes("..") && !path.isAbsolute(entry.path));
		if (files.length === 0) throw new Error("Speech model listing was empty");
		progress.total = files.reduce((sum, entry) => sum + entry.size, 0);
		for (const entry of files) {
			const target = file(entry.path);
			// Exact size at a pinned revision: a short file is an interrupted download.
			if (fs.statSync(target, { throwIfNoEntry: false })?.size === entry.size) {
				progress.done += entry.size;
				continue;
			}
			fs.mkdirSync(path.dirname(target), { recursive: true });
			const res = await fetch(hub + entry.path);
			if (!res.ok || !res.body) throw new Error(`Speech model download failed (${res.status})`);
			const body = Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]);
			body.on("data", (chunk: Buffer) => { progress.done += chunk.length; });
			await pipeline(body, fs.createWriteStream(`${target}.part`));
			if (fs.statSync(`${target}.part`).size !== entry.size) throw new Error("Speech model download was incomplete");
			fs.renameSync(`${target}.part`, target);
		}
		fs.writeFileSync(marker, spec.revision);
	}

	return {
		file,
		/** Reports whether the model is on disk, and starts the download when
		 *  it is not. A failed download is reported once, then the next call
		 *  retries (files already complete are kept). */
		status(): ModelStatus {
			if (job?.error) {
				const message = job.error;
				job = null;
				return { state: "error", message };
			}
			if (!job) {
				let done: string | undefined;
				try {
					done = fs.readFileSync(marker, "utf8");
				} catch {}
				if (done === spec.revision) return { state: "ready" };
				const started = { done: 0, total: 0, error: undefined as string | undefined };
				job = started;
				download(started).then(
					() => { if (job === started) job = null; },
					(error: unknown) => { started.error = error instanceof Error ? error.message : "Speech model download failed"; },
				);
			}
			return { state: "downloading", progress: job.total ? Math.min(0.99, job.done / job.total) : 0 };
		},
	};
}
