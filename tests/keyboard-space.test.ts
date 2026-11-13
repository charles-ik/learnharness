import assert from "node:assert/strict";
import { test } from "node:test";
import { KEYBOARD_ACTIONS, effectiveKeymap, isDictationSpace } from "../src/core/keyboard.ts";

/** A keydown as the dispatcher sees it; `on` is the chain of matching ancestors. */
function space(over: Record<string, unknown> = {}, target: Record<string, unknown> = { tagName: "BODY" }) {
	return { key: " ", metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, repeat: false, target: { closest: () => null, ...target }, ...over } as unknown as KeyboardEvent;
}
const control = (row: boolean) => ({ tagName: "BUTTON", closest: () => ({ hasAttribute: (name: string) => row && name === "data-kbdrow" }) });

test("bare Space is the dictation toggle only where Space has no other job", () => {
	assert.equal(isDictationSpace(space()), true);
	assert.equal(isDictationSpace(space({ key: "a" })), false);
	assert.equal(isDictationSpace(space({ repeat: true })), false, "a held key must not toggle over and over");
	for (const modifier of ["metaKey", "ctrlKey", "altKey", "shiftKey"]) assert.equal(isDictationSpace(space({ [modifier]: true })), false, modifier);
	for (const tagName of ["INPUT", "TEXTAREA", "SELECT"]) assert.equal(isDictationSpace(space({}, { tagName })), false, tagName);
	assert.equal(isDictationSpace(space({}, { tagName: "DIV", isContentEditable: true })), false);
	assert.equal(isDictationSpace(space({}, control(false))), false, "Space activates a focused button");
	assert.equal(isDictationSpace(space({}, control(true))), true, "a question row yields Space to dictation");
});

test("the Space and number keys are listed for the cheat sheet but never dispatched from the registry", () => {
	const ids = KEYBOARD_ACTIONS.filter((action) => action.displayOnly).map((action) => action.id);
	assert.ok(ids.includes("dictation-space") && ids.includes("question-pick-number"));
	assert.equal(effectiveKeymap().get("space"), undefined);
	assert.equal(effectiveKeymap().get("mod+d"), "toggle-dictation");
});
