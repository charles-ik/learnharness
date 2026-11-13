/**
 * Spoken replies (fork, 2026-11-13): turns a teacher message into speech.
 * The message's markdown is cleaned into plain sentences, each sentence is
 * voiced by the local server (/api/tts, Kokoro on this machine) and the
 * pieces are scheduled back to back on one AudioContext, so speech starts
 * after the first sentence and never gaps. One thing speaks at a time:
 * starting anything, or calling stopSpeaking(), ends what was playing.
 */
import { useSyncExternalStore } from "react";

/** Said-aloud forms for the math a tutor writes inline. Order matters. */
const MATH_WORDS: [RegExp, string][] = [
	[/\\(?:d|t)?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, " $1 over $2 "],
	[/\\sqrt\s*\{([^{}]*)\}/g, " the square root of $1 "],
	[/\^\s*\{?\s*2\s*\}?/g, " squared "],
	[/\^\s*\{?\s*3\s*\}?/g, " cubed "],
	[/\^\s*\{([^{}]*)\}|\^\s*(\w)/g, " to the power of $1$2 "],
	[/_\s*\{([^{}]*)\}|_\s*(\w)/g, " sub $1$2 "],
	[/\\(?:times|cdot)\b/g, " times "],
	[/\\div\b/g, " divided by "],
	[/\\pm\b/g, " plus or minus "],
	[/\\(?:leq?|leqslant)\b|≤/g, " is at most "],
	[/\\(?:geq?|geqslant)\b|≥/g, " is at least "],
	[/\\neq?\b|≠/g, " is not equal to "],
	[/\\approx\b|≈/g, " is about "],
	[/\\(?:to|rightarrow|Rightarrow|implies)\b|→|⇒/g, " gives "],
	[/\\infty\b|∞/g, " infinity "],
	[/</g, " is less than "],
	[/>/g, " is greater than "],
	[/=/g, " equals "],
	[/\+/g, " plus "],
	[/(?<=[\w)\s])-(?=[\s\w(\\])/g, " minus "],
	[/\//g, " over "],
	[/\\(?:left|right|,|;|!|quad|qquad|displaystyle|mathrm|mathbf|text|operatorname)\b/g, " "],
	[/\\([a-zA-Z]+)/g, " $1 "],
	[/[{}\\]/g, " "],
];

// shortcut: a handful of rewrite rules, not a LaTeX reader. Nested fractions
// and long derivations come out rough; swap in a real math-to-speech pass if
// formulas are routinely read aloud.
function mathAloud(tex: string): string {
	let said = tex;
	for (const [pattern, words] of MATH_WORDS) said = said.replace(pattern, words);
	return said;
}

/** A message's markdown as the plain text a voice should say. Code, diagrams,
 *  tables and displayed formulas are for the screen and are left out. */
export function speechText(markdown: string): string {
	return markdown
		.replace(/^(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:\n\1[^\n]*|$)/gm, "\n") // fenced code, mermaid
		.replace(/\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\]/g, "\n") // display math
		.replace(/^[ \t]*\|.*$/gm, "") // table rows
		.replace(/<[^>\n]+>/g, " ") // raw HTML
		.replace(/!\[[^\]]*\]\([^)]*\)/g, " ") // images
		.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1") // links keep their words
		.replace(/\bhttps?:\/\/\S*[^\s.,;:!?)]/g, " ") // a bare address, not the sentence's own punctuation
		.replace(/\$([^$\n]+)\$|\\\(([\s\S]*?)\\\)/g, (_, dollars: string | undefined, parens: string | undefined) => mathAloud(dollars ?? parens ?? ""))
		.replace(/`([^`\n]+)`/g, "$1")
		.replace(/^[ \t]*>[ \t]?(?:\[![A-Z]+\][ \t]*)?/gm, "") // quotes and callout markers
		.replace(/^[ \t]*#{1,6}[ \t]+(.*)$/gm, "$1.") // a heading is its own sentence
		.replace(/^[ \t]*(?:[-*+]|\d+[.)])[ \t]+/gm, "")
		.replace(/^[ \t]*(?:[-*_][ \t]*){3,}$/gm, "") // rules
		.replace(/(\*\*|__|~~)(.+?)\1/g, "$2")
		.replace(/(?<![\w*])[*_](?=\S)(.+?)(?<=\S)[*_](?![\w*])/g, "$1")
		.replace(/\p{Extended_Pictographic}️?/gu, " ")
		.replace(/[ \t]+/g, " ")
		.replace(/\.{2,}(?=\s|$)/g, ".") // "Heading.." after a heading that ended in a full stop
		.replace(/ ?\n ?/g, "\n")
		.replace(/\n{2,}/g, "\n")
		.trim();
}

/** Sentences for the voice, none longer than `max` characters. A break needs
 *  a capital, digit or quote after it, so "e.g. the" stays whole. */
export function splitForSpeech(text: string, max = 300): string[] {
	const passages: string[] = [];
	for (const sentence of text.split(/\n+|(?<=[.!?…]["')\]]*)\s+(?=["'(\[]*[A-Z0-9])/)) {
		let rest = sentence.trim();
		while (rest.length > max) {
			// Prefer a clause boundary, then any space, in the back half.
			const window = rest.slice(0, max);
			const clause = Math.max(window.lastIndexOf(", "), window.lastIndexOf("; "), window.lastIndexOf(": "));
			const cut = clause > max / 2 ? clause + 1 : window.lastIndexOf(" ") > 0 ? window.lastIndexOf(" ") : max;
			passages.push(rest.slice(0, cut).trim());
			rest = rest.slice(cut).trim();
		}
		// Something a voice can say: at least one letter or digit.
		if (/[\p{L}\p{N}]/u.test(rest)) passages.push(rest);
	}
	return passages;
}

export type Speech = {
	/** The message being spoken (its id), or null. */
	id: string | null;
	/** Why the last attempt for `notice.id` did not speak. */
	notice: { id: string; text: string } | null;
};

let speech: Speech = { id: null, notice: null };
const listeners = new Set<() => void>();
function update(next: Partial<Speech>) {
	speech = { ...speech, ...next };
	for (const listener of listeners) listener();
}
function subscribe(listener: () => void) {
	listeners.add(listener);
	return () => { listeners.delete(listener); };
}
const current = () => speech;

export function useSpeech(): Speech {
	return useSyncExternalStore(subscribe, current, current);
}

/** Bumped by every start and stop: a stale run sees it moved and bows out. */
let run = 0;
let context: AudioContext | null = null;
const playing = new Set<AudioBufferSourceNode>();

export function stopSpeaking() {
	run++;
	for (const source of playing) {
		source.onended = null;
		try {
			source.stop();
		} catch {}
	}
	playing.clear();
	if (speech.id) update({ id: null });
}

async function refusal(res: Response): Promise<string> {
	const data = (await res.json().catch(() => ({}))) as { state?: string; progress?: number; message?: string };
	if (data.state === "downloading") return `Downloading the voice (${Math.round((data.progress ?? 0) * 100)}%). Try again shortly`;
	return data.message ?? `The voice is unavailable (${res.status})`;
}

/** Speak a message. Resolves when its audio is queued, not when it ends. */
export async function speak(id: string, markdown: string, speed: number): Promise<void> {
	stopSpeaking();
	const passages = splitForSpeech(speechText(markdown));
	if (passages.length === 0) return;
	const mine = run;
	update({ id, notice: null });
	let fetched = false;
	const settle = () => {
		if (mine === run && fetched && playing.size === 0) update({ id: null });
	};
	try {
		context ??= new AudioContext();
		if (context.state === "suspended") await context.resume();
		let at = 0;
		for (const text of passages) {
			const res = await fetch("/api/tts", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ text, speed }),
			});
			if (mine !== run) return;
			if (!res.ok) throw new Error(await refusal(res));
			const pcm = new Int16Array(await res.arrayBuffer());
			if (mine !== run) return;
			if (pcm.length === 0) continue;
			const buffer = context.createBuffer(1, pcm.length, Number(res.headers.get("X-Sample-Rate")) || 24000);
			const channel = buffer.getChannelData(0);
			for (let i = 0; i < pcm.length; i++) channel[i] = pcm[i]! / 32768;
			const source = context.createBufferSource();
			source.buffer = buffer;
			source.connect(context.destination);
			// Back to back; a late piece (slow synthesis) starts as soon as it can.
			at = Math.max(at, context.currentTime + 0.02);
			source.start(at);
			at += buffer.duration;
			playing.add(source);
			source.onended = () => {
				playing.delete(source);
				settle();
			};
		}
		fetched = true;
		settle();
	} catch (error) {
		if (mine !== run) return;
		stopSpeaking();
		update({ notice: { id, text: error instanceof Error ? error.message : "The voice is unavailable" } });
	}
}
