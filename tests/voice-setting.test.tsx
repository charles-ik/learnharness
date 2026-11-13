import React, { act } from "react";
(globalThis as Record<string, unknown>).React = React;
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { createRoot } from "react-dom/client";
import { parseHTML } from "linkedom";
import { InteractionLayersProvider } from "../components/interaction-layers.tsx";
import { installModalDom } from "./modal-dom.ts";

const dom = parseHTML("<html><body></body></html>");
Object.assign(globalThis, { window: dom.window, document: dom.document, Element: dom.window.Element, HTMLElement: dom.window.HTMLElement, CustomEvent: dom.window.CustomEvent, IS_REACT_ACT_ENVIRONMENT: true });
installModalDom(dom);
const originalFetch = globalThis.fetch;
after(() => { globalThis.fetch = originalFetch; });
const { VoiceSetting } = await import("../components/voice-setting.tsx");
const byTest = (id: string) => document.querySelector(`[data-testid="${id}"]`) as HTMLElement;

test("the Voice rows save the whole section; speed stays usable while replies are silent", async () => {
	const puts: unknown[] = [];
	let stored = { speakReplies: false, speed: 1.2 };
	globalThis.fetch = (async (url: string, init?: RequestInit) => {
		if (init?.method === "PUT") {
			assert.equal(url, "/api/settings/voice");
			stored = JSON.parse(init.body as string);
			puts.push(stored);
			return Response.json({ settings: { version: 1, voice: stored } });
		}
		assert.equal(url, "/api/settings");
		return Response.json({ settings: { version: 1, voice: stored } });
	}) as typeof fetch;
	const host = document.createElement("div");
	document.body.appendChild(host);
	const root = createRoot(host);
	await act(async () => { root.render(<InteractionLayersProvider><VoiceSetting /></InteractionLayersProvider>); });

	assert.match(byTest("row-voice-speak").textContent ?? "", /Speak replies aloud.*The teacher's replies are read aloud\./);
	const toggle = byTest("toggle-speak-replies-aloud");
	assert.equal(toggle.getAttribute("aria-checked"), "false");
	assert.equal(byTest("voice-speed").textContent, "1.2×▾");
	assert.equal(byTest("voice-speed").hasAttribute("disabled"), false, "speed is enabled while the switch is off");

	await act(async () => { toggle.click(); });
	assert.deepEqual(puts, [{ speakReplies: true, speed: 1.2 }]);
	assert.equal(byTest("toggle-speak-replies-aloud").getAttribute("aria-checked"), "true");

	await act(async () => { byTest("voice-speed").click(); });
	const options = [...document.querySelectorAll('[data-testid="voice-speed-menu"] button')].map((el) => el.textContent?.replace("✓", ""));
	assert.deepEqual(options, ["0.8×", "1×", "1.2×", "1.4×", "1.6×", "1.8×", "2×"]);
	await act(async () => { (document.querySelector('[data-testid="voice-speed-menu"] button:last-child') as HTMLElement).click(); });
	assert.deepEqual(puts.at(-1), { speakReplies: true, speed: 2 });
	assert.equal(byTest("voice-speed").textContent, "2×▾");
	await act(async () => { root.unmount(); });
});
