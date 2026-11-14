/**
 * Local dictation (fork): used by the dictation hook when no Deepgram key is
 * configured. GET reports whether the on-device speech model is ready and
 * starts its one-time download when it is not. POST takes the recording as
 * raw 16 kHz mono PCM16 and returns its transcript. Nothing is sent anywhere.
 */
import { localSttStatus, transcribeLocally } from "@/src/server";

/** Ten minutes of 16 kHz PCM16; the hook keeps its own recording under this. */
const MAX_BYTES = 10 * 60 * 32_000;

export function GET() {
	return Response.json(localSttStatus());
}

export async function POST(request: Request) {
	const status = localSttStatus();
	if (status.state !== "ready") return Response.json(status, { status: 409 });
	const pcm = new Uint8Array(await request.arrayBuffer());
	if (pcm.byteLength > MAX_BYTES) return Response.json({ message: "Dictation is too long to transcribe" }, { status: 413 });
	try {
		return Response.json({ text: await transcribeLocally(pcm) });
	} catch (error) {
		console.error("[stt/local]", error);
		return Response.json({ message: "Local dictation failed to transcribe" }, { status: 500 });
	}
}
