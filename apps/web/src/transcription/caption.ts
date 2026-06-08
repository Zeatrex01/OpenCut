import type { TranscriptionSegment, CaptionChunk } from "@/transcription/types";
import {
	DEFAULT_WORDS_PER_CAPTION,
} from "@/transcription/caption-defaults";

export function buildCaptionChunks({
	segments,
	wordsPerChunk = DEFAULT_WORDS_PER_CAPTION,
}: {
	segments: TranscriptionSegment[];
	wordsPerChunk?: number;
	minDuration?: number;
}): CaptionChunk[] {
	const captions: CaptionChunk[] = [];

	for (const segment of segments) {
		const words = segment.text.trim().split(/\s+/);
		if (words.length === 0 || (words.length === 1 && words[0] === "")) {
			continue;
		}

		const segmentDuration = Math.max(0.1, segment.end - segment.start);
		const chunks: string[] = [];
		for (let i = 0; i < words.length; i += wordsPerChunk) {
			chunks.push(words.slice(i, i + wordsPerChunk).join(" "));
		}

		let currentStartTime = segment.start;
		const totalWords = words.length;

		for (const chunk of chunks) {
			const chunkWords = chunk.split(/\s+/).length;
			// Distribute the segment's actual duration proportionally based on word count
			const chunkDuration = (chunkWords / totalWords) * segmentDuration;

			captions.push({
				text: chunk,
				startTime: currentStartTime,
				duration: chunkDuration,
			});

			currentStartTime += chunkDuration;
		}
	}

	return captions;
}
