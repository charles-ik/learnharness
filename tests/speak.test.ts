import assert from "node:assert/strict";
import { test } from "node:test";
import { speechText, splitForSpeech } from "../components/speak.ts";

test("code, diagrams, tables and displayed formulas are left for the screen", () => {
	const said = speechText([
		"## Slopes",
		"",
		"A **derivative** is the _slope_ at one point. See [the docs](https://example.com/x) or https://example.com/y.",
		"",
		"```python",
		"def f(x): return x**2",
		"```",
		"",
		"$$\\frac{dy}{dx} = 2x$$",
		"",
		"| a | b |",
		"|---|---|",
		"| 1 | 2 |",
		"",
		"> [!IMPORTANT]",
		"> Use `f(x)` here 🎉",
		"",
		"- first item",
		"2. second item",
	].join("\n"));
	assert.equal(said, [
		"Slopes.",
		"A derivative is the slope at one point. See the docs or .",
		"Use f(x) here",
		"first item",
		"second item",
	].join("\n"));
});

test("inline math is said in words", () => {
	assert.equal(speechText("So $x^2 + 1 = 5$ here."), "So x squared plus 1 equals 5 here.");
	assert.equal(speechText("Then \\(\\frac{a}{b} \\leq \\alpha\\)."), "Then a over b is at most alpha .");
	assert.equal(speechText("A snake_case name and 2 * 3 * 4 stay as written."), "A snake_case name and 2 * 3 * 4 stay as written.");
});

test("sentences split on real boundaries and long ones break at a clause", () => {
	assert.deepEqual(splitForSpeech("First point, e.g. the slope. Second point! \"Third\" one?\nNew line"), [
		"First point, e.g. the slope.",
		"Second point!",
		"\"Third\" one?",
		"New line",
	]);
	const long = `${"word ".repeat(30)}and so on, ${"more ".repeat(30)}end.`;
	const pieces = splitForSpeech(long, 200);
	assert.ok(pieces.length >= 2 && pieces.every((piece) => piece.length <= 200), JSON.stringify(pieces.map((piece) => piece.length)));
	assert.equal(pieces.join(" ").replace(/\s+/g, " "), long.replace(/\s+/g, " "));
	// Nothing sayable: no passages, so the server is never asked to voice "...".
	assert.deepEqual(splitForSpeech("… --- !!!"), []);
});
