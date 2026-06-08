import type { CaptionChunk } from "@/transcription/types";

// Common words to exclude from keyword extraction
const STOP_WORDS = new Set([
	// English
	"a", "an", "the", "and", "or", "but", "in", "on", "at", "to", "for",
	"of", "with", "by", "from", "is", "are", "was", "were", "be", "been",
	"being", "have", "has", "had", "do", "does", "did", "will", "would",
	"could", "should", "may", "might", "shall", "can", "i", "you", "he",
	"she", "it", "we", "they", "me", "him", "her", "us", "them", "my",
	"your", "his", "its", "our", "their", "this", "that", "these", "those",
	"what", "which", "who", "how", "when", "where", "why", "not", "no",
	"so", "if", "then", "than", "as", "up", "out", "about", "into",
	"through", "during", "before", "after", "above", "below", "just",
	"very", "too", "also", "even", "still", "well", "now", "here", "there",
	"like", "know", "get", "got", "go", "going", "come", "came", "see",
	"say", "said", "think", "make", "made", "take", "give", "want", "look",
	// Turkish
	"bir", "bu", "ve", "de", "da", "ile", "için", "ben", "sen", "o",
	"biz", "siz", "onlar", "ne", "var", "yok", "ama", "çok", "daha",
	"mi", "mı", "mu", "mü", "ki", "ya", "hem",
]);

const MIN_KEYWORD_LENGTH = 3;
const MAX_KEYWORDS = 8;

/**
 * Extracts meaningful search keywords from subtitle caption chunks.
 * Filters stop words, deduplicates, and returns a ranked list.
 */
export function extractKeywordsFromCaptions({
	captions,
}: {
	captions: CaptionChunk[];
}): string[] {
	const wordFrequency = new Map<string, number>();

	for (const caption of captions) {
		const words = caption.text
			.toLowerCase()
			// Remove punctuation and special chars
			.replace(/[^\w\sçğıöşüâîûÇĞİÖŞÜÂÎÛ]/g, " ")
			.split(/\s+/);

		for (const word of words) {
			const trimmed = word.trim();
			if (
				trimmed.length >= MIN_KEYWORD_LENGTH &&
				!STOP_WORDS.has(trimmed) &&
				!/^\d+$/.test(trimmed) // skip pure numbers
			) {
				wordFrequency.set(trimmed, (wordFrequency.get(trimmed) ?? 0) + 1);
			}
		}
	}

	// Sort by frequency descending, take top N
	return [...wordFrequency.entries()]
		.sort((a, b) => b[1] - a[1])
		.slice(0, MAX_KEYWORDS)
		.map(([word]) => word);
}
