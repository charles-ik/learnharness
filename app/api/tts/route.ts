/**
 * Spoken replies (fork): GET reports whether the on-device voice is ready and
 * starts its one-time download when it is not. POST takes one short passage
 * and a speed, and returns it spoken as raw mono PCM16 (the sample rate is in
 * X-Sample-Rate). Nothing is sent anywhere.
 */
import { floatToPcm16, localTtsStatus, synthesize } from "@/src/server";

/** The renderer sends a sentence at a time; this only bounds a bad caller. */
const MAX_CHARS = 2000;

export function GET() {
	return Response.json(localTtsStatus());
}

export async function POST(request: Request) {
	const status = localTtsStatus();
	if (status.state !== "ready") return Response.json(status, { status: 409 });
	let body: { text?: unknown; speed?: unknown };
	try {
		body = (await request.json()) as { text?: unknown; speed?: unknown };
	} catch {
		return Response.json({ message: "Expected JSON" }, { status: 400 });
	}
	const text = typeof body.text === "string" ? body.text.trim() : "";
	if (!text || text.length > MAX_CHARS) return Response.json({ message: "Expected 1 to 2000 characters of text" }, { status: 400 });
	const speed = typeof body.speed === "number" && Number.isFinite(body.speed) ? Math.min(2, Math.max(0.5, body.speed)) : 1;
	try {
		const audio = await synthesize(text, speed);
		return new Response(floatToPcm16(audio.samples), {
			headers: { "Content-Type": "application/octet-stream", "X-Sample-Rate": String(audio.sampleRate) },
		});
	} catch (error) {
		console.error("[tts]", error);
		return Response.json({ message: "The voice failed to speak this passage" }, { status: 500 });
	}
}
