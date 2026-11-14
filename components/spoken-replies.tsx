"use client";

/**
 * Spoken replies in the chat (fork, 2026-11-13): reads a finished teacher
 * turn aloud when the Voice setting is on, and gives every teacher message a
 * speak/stop button. The voice itself lives in speak.ts.
 */
import { useEffect, useRef } from "react";
import { SquareIcon, Volume2Icon } from "lucide-react";
import { MessageAction } from "@/components/ai-elements/message";
import { speak, stopSpeaking, useSpeech } from "@/components/speak";
import { useVoicePreference } from "@/components/voice-preference";

type SpokenPart = { type: string; text?: string; input?: unknown };
type SpokenMessage = { id: string; role: string; parts: readonly SpokenPart[] };

const QUESTION_PARTS = new Set(["tool-quiz", "tool-probe", "tool-ask_user_question", "tool-explain", "tool-recall"]);

/** What one part contributes to the voice: prose as written, and a question's
 *  context and stem (a probe turn is nothing but its question). Answer
 *  options, plans, demos and tool output stay on screen. Answered questions
 *  still count, so the passage count never shrinks as a chat goes on. */
function passageOf(part: SpokenPart): string {
	if (part.type === "text") return part.text ?? "";
	if (!QUESTION_PARTS.has(part.type) || !part.input || typeof part.input !== "object") return "";
	const { context, question } = part.input as { context?: unknown; question?: unknown };
	return [context, question].filter((piece): piece is string => typeof piece === "string" && piece.trim() !== "").join("\n\n");
}

/** Everything the teacher has said, in order. */
function teacherPassages(messages: readonly SpokenMessage[]): string[] {
	return messages.flatMap((message) => (message.role === "assistant" ? message.parts.map(passageOf).filter(Boolean) : []));
}

/** The text a message's speak button reads. */
export function spokenTextOf(message: SpokenMessage): string {
	return teacherPassages([message]).join("\n\n");
}

/** Read each finished turn aloud (Settings → Voice). Only prose that arrived
 *  in THIS turn is spoken: a count of the teacher's passages is taken when
 *  the turn starts, so reopening a chat or continuing a long message never
 *  re-reads old text. Starting a turn also silences whatever was playing. */
export function useAutoSpeak(messages: readonly SpokenMessage[], status: string) {
	const { voice } = useVoicePreference();
	const latest = useRef({ messages, voice });
	latest.current = { messages, voice };
	const previous = useRef(status);
	const heard = useRef(0);
	useEffect(() => {
		const was = previous.current;
		previous.current = status;
		if (was === status) return;
		const { messages: now, voice: preference } = latest.current;
		if (status === "submitted" || (status === "streaming" && was !== "submitted")) {
			heard.current = teacherPassages(now).length;
			stopSpeaking();
			return;
		}
		if (was !== "streaming" || status !== "ready" || !preference?.speakReplies) return;
		const fresh = teacherPassages(now).slice(heard.current);
		const last = now.findLast((message) => message.role === "assistant");
		if (last && fresh.length > 0) void speak(last.id, fresh.join("\n\n"), preference.speed);
	}, [status]);
	// Leaving the chat ends its voice.
	useEffect(() => stopSpeaking, []);
}

/** Speak this message, or stop it while it is speaking. */
export function SpeakButton({ id, text }: { id: string; text: string }) {
	const speech = useSpeech();
	const { voice } = useVoicePreference();
	if (!text) return null;
	const speaking = speech.id === id;
	const notice = speech.notice?.id === id ? speech.notice.text : null;
	return (
		<MessageAction
			tooltip={notice ?? (speaking ? "Stop speaking" : "Read aloud")}
			data-testid="speak-toggle"
			className="text-muted-foreground/60 hover:text-muted-foreground"
			onClick={() => {
				if (speaking) stopSpeaking();
				else void speak(id, text, voice?.speed ?? 1);
			}}
		>
			{speaking ? <SquareIcon className="size-3.5" /> : <Volume2Icon className="size-3.5" />}
		</MessageAction>
	);
}
