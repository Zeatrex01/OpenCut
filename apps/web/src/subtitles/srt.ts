import type { TextElement } from "@/timeline";
import { mediaTimeToSeconds } from "@/wasm";
import type { ParseSubtitleResult, SubtitleCue } from "./types";

const TIMESTAMP_SEPARATOR = /\s*-->\s*/;
const TIMESTAMP_PATTERN =
	/^(\d{2}:\d{2}:\d{2}[,.]\d{1,3})\s*-->\s*(\d{2}:\d{2}:\d{2}[,.]\d{1,3})/;

export function parseSrt({ input }: { input: string }): ParseSubtitleResult {
	const normalized = input.replace(/\r\n?/g, "\n").trim();
	if (!normalized) {
		return {
			captions: [],
			skippedCueCount: 0,
			warnings: [],
		};
	}

	const blocks = normalized.split(/\n{2,}/);
	const cues: SubtitleCue[] = [];
	let skippedCueCount = 0;

	for (const block of blocks) {
		const lines = block
			.split("\n")
			.map((line) => line.trim())
			.filter((line) => line.length > 0);

		if (lines.length < 2) {
			skippedCueCount += 1;
			continue;
		}

		const timestampIndex = TIMESTAMP_SEPARATOR.test(lines[0]) ? 0 : 1;
		const timestampLine = lines[timestampIndex];
		if (!timestampLine || !TIMESTAMP_PATTERN.test(timestampLine)) {
			skippedCueCount += 1;
			continue;
		}

		const textLines = lines.slice(timestampIndex + 1);
		const text = textLines.join("\n").trim();
		if (!text) {
			skippedCueCount += 1;
			continue;
		}

		const [rawStart, rawEnd] = timestampLine.split(TIMESTAMP_SEPARATOR);
		if (!rawStart || !rawEnd) {
			skippedCueCount += 1;
			continue;
		}

		const startTime = parseSrtTimestamp({ input: rawStart });
		const endTime = parseSrtTimestamp({ input: rawEnd });
		const duration = endTime - startTime;

		if (
			!Number.isFinite(startTime) ||
			!Number.isFinite(endTime) ||
			duration <= 0
		) {
			skippedCueCount += 1;
			continue;
		}

		cues.push({
			text,
			startTime,
			duration,
		});
	}

	return {
		captions: cues,
		skippedCueCount,
		warnings: [],
	};
}

function parseSrtTimestamp({ input }: { input: string }): number {
	const normalized = input.trim().replace(",", ".");
	const match = normalized.match(/^(\d{2}):(\d{2}):(\d{2})\.(\d{1,3})$/);
	if (!match) {
		return Number.NaN;
	}

	const [, hours, minutes, seconds, milliseconds] = match;
	const parsedHours = Number.parseInt(hours, 10);
	const parsedMinutes = Number.parseInt(minutes, 10);
	const parsedSeconds = Number.parseInt(seconds, 10);
	const parsedMilliseconds = Number.parseInt(milliseconds.padEnd(3, "0"), 10);

	return (
		parsedHours * 3600 +
		parsedMinutes * 60 +
		parsedSeconds +
		parsedMilliseconds / 1000
	);
}

function formatTimeSRT({ seconds }: { seconds: number }): string {
	if (Number.isNaN(seconds) || seconds < 0) {
		return "00:00:00,000";
	}

	const hours = Math.floor(seconds / 3600);
	const minutes = Math.floor((seconds % 3600) / 60);
	const secs = Math.floor(seconds % 60);
	const milliseconds = Math.floor((seconds % 1) * 1000);

	const pad = (num: number, size: number) => {
		let s = Math.floor(num).toString();
		while (s.length < size) {
			s = "0" + s;
		}
		return s;
	};

	return `${pad(hours, 2)}:${pad(minutes, 2)}:${pad(secs, 2)},${pad(milliseconds, 3)}`;
}

export function exportToSRT({ elements }: { elements: TextElement[] }): string {
	const sortedElements = [...elements].sort((a, b) => {
		const startA = mediaTimeToSeconds({ time: a.startTime });
		const startB = mediaTimeToSeconds({ time: b.startTime });
		return startA - startB;
	});

	let srtText = "";

	for (let i = 0; i < sortedElements.length; i++) {
		const element = sortedElements[i];
		if (!element) continue;

		const startSecs = mediaTimeToSeconds({ time: element.startTime });
		const durationSecs = mediaTimeToSeconds({ time: element.duration });
		const endSecs = startSecs + durationSecs;

		const startTimeFormatted = formatTimeSRT({ seconds: startSecs });
		const endTimeFormatted = formatTimeSRT({ seconds: endSecs });

		const textContent = element.content || "";

		srtText += `${i + 1}\n`;
		srtText += `${startTimeFormatted} --> ${endTimeFormatted}\n`;
		srtText += `${textContent}\n\n`;
	}

	return srtText.trim() + "\n";
}
