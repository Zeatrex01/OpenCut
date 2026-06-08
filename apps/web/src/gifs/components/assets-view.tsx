"use client";

import Image from "next/image";

import { useCallback, useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useEditor } from "@/editor/use-editor";
import { processMediaAssets } from "@/media/processing";
import { buildElementFromMedia } from "@/timeline/element-utils";
import { mediaTimeFromSeconds, ZERO_MEDIA_TIME } from "@/wasm";
import { DEFAULT_NEW_ELEMENT_DURATION } from "@/timeline/creation";
import { extractKeywordsFromCaptions } from "@/gifs/utils/keywords";
import { toast } from "sonner";
import { PlusSignIcon, Search01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { CaptionChunk } from "@/transcription/types";

// ---------------------------------------------------------------------------
// Giphy helpers
// ---------------------------------------------------------------------------

const GIPHY_PUBLIC_KEY = "dc6zaTOxFJmzC";
const GIPHY_PAGE_SIZE = 24;

interface GiphyGif {
	id: string;
	title: string;
	images: {
		fixed_height_small: { url: string; webp: string };
		original_mp4: { mp4: string; width: string; height: string };
		fixed_height: { url: string };
	};
}

async function searchGiphy({
	query,
	offset = 0,
}: {
	query: string;
	offset?: number;
}): Promise<{ data: GiphyGif[]; totalCount: number }> {
	const apiKey =
		(typeof window !== "undefined" &&
			localStorage.getItem("opencut_giphy_key")) ||
		GIPHY_PUBLIC_KEY;

	const endpoint = query.trim()
		? `https://api.giphy.com/v1/gifs/search?api_key=${apiKey}&q=${encodeURIComponent(query)}&limit=${GIPHY_PAGE_SIZE}&offset=${offset}&rating=g`
		: `https://api.giphy.com/v1/gifs/trending?api_key=${apiKey}&limit=${GIPHY_PAGE_SIZE}&offset=${offset}&rating=g`;

	const res = await fetch(endpoint);
	if (!res.ok) throw new Error(`Giphy API error: ${res.status}`);
	const json = await res.json();
	return { data: json.data as GiphyGif[], totalCount: json.pagination?.total_count ?? 0 };
}

// ---------------------------------------------------------------------------
// GifCard
// ---------------------------------------------------------------------------

function GifCard({
	gif,
	onAdd,
}: {
	gif: GiphyGif;
	onAdd: ({ gif }: { gif: GiphyGif }) => Promise<void>;
}) {
	const [isAdding, setIsAdding] = useState(false);
	const previewSrc =
		gif.images.fixed_height_small.webp || gif.images.fixed_height_small.url;

	const handleAdd = async (e: React.MouseEvent) => {
		e.stopPropagation();
		setIsAdding(true);
		try {
			await onAdd({ gif });
		} finally {
			setIsAdding(false);
		}
	};

	return (
		<div className="group relative overflow-hidden rounded-md bg-muted aspect-video cursor-pointer">
			<Image
				src={previewSrc}
				alt={gif.title}
				fill
				sizes="(max-width: 640px) 50vw, 25vw"
				className="object-cover"
				unoptimized
			/>
			{/* Hover overlay */}
			<div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center">
				<Button
					size="icon"
					variant="secondary"
					className="opacity-0 group-hover:opacity-100 transition-opacity size-7"
					onClick={handleAdd}
					disabled={isAdding}
					title="Add to timeline"
				>
					{isAdding ? (
						<span className="size-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
					) : (
						<HugeiconsIcon icon={PlusSignIcon} className="size-3.5" />
					)}
				</Button>
			</div>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Keyword tag pill
// ---------------------------------------------------------------------------

function KeywordTag({
	label,
	onClick,
}: {
	label: string;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			className="px-2 py-0.5 rounded-full text-xs bg-primary/10 hover:bg-primary/20 text-primary transition-colors shrink-0"
		>
			{label}
		</button>
	);
}

// ---------------------------------------------------------------------------
// GIFsView (main export)
// ---------------------------------------------------------------------------

export function GIFsView() {
	const editor = useEditor();
	const activeScene = useEditor((e) => e.scenes.getActiveSceneOrNull());
	const activeProject = useEditor((e) => e.project.getActive());

	const [query, setQuery] = useState("");
	const [committedQuery, setCommittedQuery] = useState("");
	const [gifs, setGifs] = useState<GiphyGif[]>([]);
	const [isLoading, setIsLoading] = useState(false);
	const [hasMore, setHasMore] = useState(false);
	const [offset, setOffset] = useState(0);
	const [keywords, setKeywords] = useState<string[]>([]);

	const scrollRef = useRef<HTMLDivElement>(null);

	// ------- Extract subtitle keywords from timeline -------
	useEffect(() => {
		if (!activeScene) return;

		try {
			// Collect text element names from all tracks as caption-like chunks
			const allTracks = [
				activeScene.tracks.main,
				...activeScene.tracks.overlay,
			];
			const captionChunks: CaptionChunk[] = [];
			for (const track of allTracks) {
				for (const element of track.elements) {
					if (element.type === "text" && element.name) {
						captionChunks.push({
							text: element.name,
							startTime: 0,
							duration: 1,
						});
					}
				}
			}
			if (captionChunks.length > 0) {
				setKeywords(extractKeywordsFromCaptions({ captions: captionChunks }));
			}
		} catch {
			// Silent: keyword extraction is best-effort
		}
	}, [activeScene]);

	// ------- Fetch gifs -------
	const fetchGifs = useCallback(
		async ({
			searchQuery,
			nextOffset = 0,
			append = false,
		}: {
			searchQuery: string;
			nextOffset?: number;
			append?: boolean;
		}) => {
			setIsLoading(true);
			try {
				const { data, totalCount } = await searchGiphy({
					query: searchQuery,
					offset: nextOffset,
				});
				setGifs((prev) => (append ? [...prev, ...data] : data));
				setOffset(nextOffset + data.length);
				setHasMore(nextOffset + data.length < totalCount);
			} catch (err) {
				toast.error("Failed to load GIFs", {
					description: err instanceof Error ? err.message : "Unknown error",
				});
			} finally {
				setIsLoading(false);
			}
		},
		[],
	);

	// Initial trending load
	useEffect(() => {
		fetchGifs({ searchQuery: "" });
	}, [fetchGifs]);

	const handleSearch = () => {
		setCommittedQuery(query);
		setOffset(0);
		fetchGifs({ searchQuery: query, nextOffset: 0 });
	};

	const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
		if (e.key === "Enter") handleSearch();
	};

	const handleLoadMore = () => {
		fetchGifs({ searchQuery: committedQuery, nextOffset: offset, append: true });
	};

	// ------- Add GIF to timeline -------
	const handleAddGif = useCallback(
		async ({ gif }: { gif: GiphyGif }) => {
			if (!activeProject) {
				toast.error("No active project");
				return;
			}

			const mp4Url = gif.images.original_mp4.mp4;
			const gifWidth = Number(gif.images.original_mp4.width) || 480;
			const gifHeight = Number(gif.images.original_mp4.height) || 270;

			try {
				// Fetch the MP4 blob so we can store it as a local media asset
				const response = await fetch(mp4Url);
				if (!response.ok) throw new Error("Failed to download GIF");
				const blob = await response.blob();
				const file = new File([blob], `${gif.title || gif.id}.mp4`, {
					type: "video/mp4",
				});

				const [asset] = await processMediaAssets({ files: [file] });
				if (!asset) throw new Error("Could not process GIF");

				// Assign dimensions from Giphy metadata if processing didn't detect them
				const finalAsset = {
					...asset,
					width: asset.width ?? gifWidth,
					height: asset.height ?? gifHeight,
				};

				await editor.media.addMediaAsset({
					projectId: activeProject.metadata.id,
					asset: finalAsset,
				});

				// Get the newly registered asset ID
				const mediaAssets = editor.media.getAssets();
				const registered = mediaAssets.find(
					(a) => a.name === file.name,
				);

				if (!registered) {
					toast.success("GIF added to media library");
					return;
				}

				const duration =
					registered.duration != null
						? mediaTimeFromSeconds({ seconds: registered.duration })
						: DEFAULT_NEW_ELEMENT_DURATION;

				const element = buildElementFromMedia({
					mediaId: registered.id,
					mediaType: "video",
					name: registered.name,
					duration,
					startTime: ZERO_MEDIA_TIME,
				});

				editor.timeline.insertElement({
					element,
					placement: { mode: "auto" },
				});

				toast.success("GIF added to timeline");
			} catch (err) {
				console.error(err);
				toast.error("Failed to add GIF", {
					description: err instanceof Error ? err.message : "Unknown error",
				});
			}
		},
		[editor, activeProject],
	);

	// ------- Render -------
	return (
		<div className="flex h-full flex-col gap-0">
			{/* Search bar */}
			<div className="px-3 pt-4 pb-3 flex flex-col gap-2">
				<div className="flex gap-2">
					<Input
						placeholder="Search GIFs…"
						value={query}
						onChange={({ currentTarget }) => setQuery(currentTarget.value)}
						onKeyDown={handleKeyDown}
						showClearIcon
						onClear={() => {
							setQuery("");
							setCommittedQuery("");
							fetchGifs({ searchQuery: "" });
						}}
						containerClassName="flex-1"
					/>
					<Button
						size="icon"
						variant="outline"
						onClick={handleSearch}
						disabled={isLoading}
						title="Search"
					>
						<HugeiconsIcon icon={Search01Icon} className="size-4" />
					</Button>
				</div>

				{/* Subtitle keyword tags */}
				{keywords.length > 0 && (
					<div className="flex flex-wrap gap-1.5">
						{keywords.map((kw) => (
							<KeywordTag
								key={kw}
								label={kw}
								onClick={() => {
									setQuery(kw);
									setCommittedQuery(kw);
									setOffset(0);
									fetchGifs({ searchQuery: kw, nextOffset: 0 });
								}}
							/>
						))}
					</div>
				)}
			</div>

			{/* GIF grid */}
			<div className="relative flex-1 min-h-0">
				<ScrollArea ref={scrollRef} className="h-full px-3">
					{isLoading && gifs.length === 0 && (
						<div className="text-muted-foreground text-sm py-8 text-center">
							Loading GIFs…
						</div>
					)}

					{!isLoading && gifs.length === 0 && (
						<div className="text-muted-foreground text-sm py-8 text-center">
							No GIFs found
						</div>
					)}

					<div
						className="grid gap-2 pb-4"
						style={{ gridTemplateColumns: "repeat(auto-fill, minmax(7rem, 1fr))" }}
					>
						{gifs.map((gif) => (
							<GifCard key={gif.id} gif={gif} onAdd={handleAddGif} />
						))}
					</div>

					{hasMore && (
						<div className="pb-4 flex justify-center">
							<Button
								variant="outline"
								size="sm"
								onClick={handleLoadMore}
								disabled={isLoading}
							>
								{isLoading ? "Loading…" : "Load more"}
							</Button>
						</div>
					)}
				</ScrollArea>
			</div>
		</div>
	);
}
