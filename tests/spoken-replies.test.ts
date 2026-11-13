/** Spoken replies: the write-for-the-ear rule rides after the built-in prompt
 * (and the Claude delivery rule) only while the setting is on. Off must stay
 * byte-identical to the plain composition. Synthetic fixtures, closed network. */
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, describe, it } from "node:test";
import { createFauxCore } from "@earendil-works/pi-ai";
import type { PiEngine } from "../src/agent/models.ts";
import type { AgentBuildOptions } from "../src/agent/teacher-agent.ts";

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "lh-spoken-replies-"));
const originalEnv = process.env;
const originalFetch = globalThis.fetch;
process.env = {
	...(originalEnv.NODE_TEST_CONTEXT ? { NODE_TEST_CONTEXT: originalEnv.NODE_TEST_CONTEXT } : {}),
	...(originalEnv.NODE_OPTIONS ? { NODE_OPTIONS: originalEnv.NODE_OPTIONS } : {}),
	NODE_ENV: "test",
	LH_DATA_DIR: path.join(scratch, "data"),
	LH_AUTH_FILE: path.join(scratch, "auth.json"),
	HOME: path.join(scratch, "home"),
};
globalThis.fetch = async () => { throw new Error("CLOSED: unexpected network request"); };
after(() => {
	process.env = originalEnv;
	globalThis.fetch = originalFetch;
	fs.rmSync(scratch, { recursive: true, force: true });
});

const { SPOKEN_REPLIES_RULE } = await import("../src/agent/spoken-replies.ts");
const { SEND_TO_USER_DELIVERY_RULE } = await import("../src/agent/narration-guard.ts");
const { createProberAgent, createTeacherAgent, createPracticeAgent, composeInstructions } = await import("../src/agent/teacher-agent.ts");
const { composeSideChatInstructions } = await import("../src/agent/side-chat.ts");
const { chatStore } = await import("../src/store/chats.ts");
const { jobStore } = await import("../src/store/jobs.ts");

const SEP = "\n\n---\n\n";
const chatId = chatStore.createChat("Synthetic spoken replies").id;
const factories = {
	prober: (opts: AgentBuildOptions) => createProberAgent({ chatId, chatStore, jobStore, deliver: () => {}, spawn: () => {} }, opts),
	teacher: (opts: AgentBuildOptions) => createTeacherAgent({ chatId, chatStore, jobStore, spawn: () => {} }, opts),
	practice: (opts: AgentBuildOptions) => createPracticeAgent({ chatId, chatStore }, opts),
};
function engineFor(provider: string, id: string): PiEngine {
	const faux = createFauxCore({ provider, models: [{ id }] });
	return { model: faux.getModel(), streamFn: faux.streamSimple };
}

describe("spoken replies in the conversation agents", () => {
	for (const [provider, id, claude] of [["anthropic", "claude-opus-5-5", true], ["openai", "gpt-4o-mini", false]] as const) {
		it(`${provider}/${id}: off is unchanged, on appends the rule last`, () => {
			const engine = engineFor(provider, id);
			for (const [kind, factory] of Object.entries(factories)) {
				const composed = composeInstructions(kind as keyof typeof factories);
				const current = claude && kind === "teacher" ? `${composed}${SEP}${SEND_TO_USER_DELIVERY_RULE}` : composed;
				assert.equal(factory({ engine }).state.systemPrompt, current, `${kind} default`);
				assert.equal(factory({ engine, spokenReplies: false }).state.systemPrompt, current, `${kind} off`);
				assert.equal(factory({ engine, spokenReplies: true }).state.systemPrompt, `${current}${SEP}${SPOKEN_REPLIES_RULE}`, `${kind} on`);
			}
		});
	}

	it("Claude teacher order: built-in prompt, delivery rule, spoken rule, then plugin instructions", () => {
		const engine = engineFor("anthropic", "claude-opus-5-5");
		const pluginContributions = () => ({ instructions: ["SYNTHETIC PLUGIN INSTRUCTION"], tools: [] });
		const prompt = factories.teacher({ engine, chatId, pluginContributions, spokenReplies: true }).state.systemPrompt;
		assert.equal(prompt, [composeInstructions("teacher"), SEND_TO_USER_DELIVERY_RULE, SPOKEN_REPLIES_RULE, "SYNTHETIC PLUGIN INSTRUCTION"].join(SEP));
		const off = factories.teacher({ engine, chatId, pluginContributions }).state.systemPrompt;
		assert.equal(off, [composeInstructions("teacher"), SEND_TO_USER_DELIVERY_RULE, "SYNTHETIC PLUGIN INSTRUCTION"].join(SEP));
	});
});

describe("spoken replies in the side chat", () => {
	it("off is unchanged, on appends the rule last", () => {
		const current = composeSideChatInstructions();
		assert.equal(composeSideChatInstructions({}, false), current);
		assert.equal(composeSideChatInstructions({}, true), `${current}${SEP}${SPOKEN_REPLIES_RULE}`);
	});
});
