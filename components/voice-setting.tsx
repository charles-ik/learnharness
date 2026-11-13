"use client";

import { useRef, useState } from "react";
import type { VoiceSettings } from "@/src/core";
import { MenuShell } from "@/components/menu-shell";
import { SettingsMenuTrigger, SettingsRow, Toggle } from "@/components/settings/controls";
import { ThinkingMenuList } from "@/components/settings/model-menu";
import { useVoicePreference } from "@/components/voice-preference";

const SPEEDS = [0.8, 1, 1.2, 1.4, 1.6, 1.8, 2];
const speedLabel = (speed: number) => `${speed}×`;

/** The Voice group's rows: spoken replies and speaking speed. */
export function VoiceSetting() {
	const { voice, setVoice } = useVoicePreference();
	const [open, setOpen] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const save = (next: VoiceSettings) => {
		setError(null);
		setVoice(next).catch((e: unknown) => setError(e instanceof Error ? e.message : "Could not save voice settings. Try again."));
	};
	const label = voice ? speedLabel(voice.speed) : "—";

	return <>
		<SettingsRow label="Speak replies aloud" hint="The teacher's replies are read aloud and written to be heard." testid="row-voice-speak">
			<Toggle
				label="Speak replies aloud"
				checked={voice?.speakReplies ?? false}
				disabled={voice === undefined}
				onChange={(speakReplies) => { if (voice) save({ ...voice, speakReplies }); }}
			/>
		</SettingsRow>
		<SettingsRow label="Speaking speed" testid="row-voice-speed">
			<SettingsMenuTrigger
				ref={triggerRef}
				value={label}
				data-testid="voice-speed"
				aria-label={`Speaking speed: ${label}`}
				aria-expanded={open}
				disabled={voice === undefined}
				onClick={() => setOpen((value) => !value)}
				className="min-w-16"
			/>
			{open && voice && <MenuShell
				anchorRef={triggerRef}
				testid="voice-speed-menu"
				onClose={(reason) => { setOpen(false); if (reason === "escape") triggerRef.current?.focus(); return "closed"; }}
				preferredSide="down"
				menuClass="flex w-28 flex-col gap-0.5 rounded-xl border border-border bg-card p-2 text-xs shadow-xl"
			>
				<ThinkingMenuList
					levels={SPEEDS.map(speedLabel)}
					effectiveLevel={label}
					onPick={(picked) => {
						setOpen(false);
						save({ ...voice, speed: SPEEDS[SPEEDS.map(speedLabel).indexOf(picked)]! });
					}}
				/>
			</MenuShell>}
		</SettingsRow>
		{error && <p role="alert" className="px-1 text-[11px] text-destructive">{error}</p>}
	</>;
}
