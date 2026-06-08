import { Button } from "@/components/ui/button";
import { PanelView } from "@/components/editor/panels/assets/views/base-panel";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { useReducer, useRef, useState } from "react";
import { extractTimelineAudio } from "@/media/mediabunny";
import { useEditor } from "@/editor/use-editor";
import { TRANSCRIPTION_DIAGNOSTICS_SCOPE } from "@/transcription/diagnostics";
import { DEFAULT_TRANSCRIPTION_SAMPLE_RATE } from "@/transcription/audio";
import { TRANSCRIPTION_LANGUAGES } from "@/transcription/supported-languages";
import { DEFAULT_TRANSCRIPTION_MODEL, TRANSCRIPTION_MODELS } from "@/transcription/models";
import type {
	CaptionChunk,
	TranscriptionLanguage,
	TranscriptionProgress,
	TranscriptionModelId,
} from "@/transcription/types";
import { transcriptionService } from "@/services/transcription/service";
import { decodeAudioToFloat32 } from "@/media/audio";
import { buildCaptionChunks } from "@/transcription/caption";
import { insertCaptionChunksAsTextTrack } from "@/subtitles/insert";
import { parseSubtitleFile } from "@/subtitles/parse";
import { Spinner } from "@/components/ui/spinner";
import { Slider } from "@/components/ui/slider";
import { upsertElementKeyframe } from "@/animation/keyframes";
import { mediaTimeFromSeconds, mediaTimeToSeconds, ZERO_MEDIA_TIME } from "@/wasm";
import type { ElementAnimations } from "@/animation/types";
import {
	Section,
	SectionContent,
	SectionField,
	SectionFields,
} from "@/components/section";
import { AlertCircleIcon, CloudUploadIcon, Download01Icon } from "@hugeicons/core-free-icons";
import { exportToSRT } from "@/subtitles/srt";
import { HugeiconsIcon } from "@hugeicons/react";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import type { DiagnosticSeverity } from "@/diagnostics/types";

const DIAGNOSTIC_BUTTON_VARIANT: Record<
	DiagnosticSeverity,
	"caution" | "destructive-foreground"
> = {
	caution: "caution",
	error: "destructive-foreground",
};

type ProcessingState =
	| { status: "idle"; error: string | null; warnings: string[] }
	| { status: "processing"; step: string };

type ProcessingAction =
	| { type: "start"; step: string }
	| { type: "update_step"; step: string }
	| { type: "succeed"; warnings: string[] }
	| { type: "fail"; error: string };

const IDLE_STATE: ProcessingState = {
	status: "idle",
	error: null,
	warnings: [],
};

function processingReducer(
	state: ProcessingState,
	action: ProcessingAction,
): ProcessingState {
	switch (action.type) {
		case "start":
			return { status: "processing", step: action.step };
		case "update_step":
			if (state.status !== "processing") return state;
			return { status: "processing", step: action.step };
		case "succeed":
			return { status: "idle", error: null, warnings: action.warnings };
		case "fail":
			return { status: "idle", error: action.error, warnings: [] };
	}
}

function clearPropertyAnimations({
	animations,
	propertyPath,
}: {
	animations: ElementAnimations | undefined;
	propertyPath: string;
}): ElementAnimations | undefined {
	if (!animations) return undefined;

	const nextBindings = { ...animations.bindings };
	const nextChannels = { ...animations.channels };

	const binding = nextBindings[propertyPath];
	if (binding) {
		delete nextBindings[propertyPath];
		for (const component of binding.components) {
			delete nextChannels[component.channelId];
		}
	}

	if (Object.keys(nextBindings).length === 0 || Object.keys(nextChannels).length === 0) {
		return undefined;
	}

	return {
		bindings: nextBindings,
		channels: nextChannels,
	};
}

export function Captions() {
	const [selectedLanguage, setSelectedLanguage] =
		useState<TranscriptionLanguage>("auto");
	const [selectedModel, setSelectedModel] =
		useState<TranscriptionModelId>(DEFAULT_TRANSCRIPTION_MODEL);
	const [processing, dispatch] = useReducer(processingReducer, IDLE_STATE);
	const containerRef = useRef<HTMLDivElement>(null);
	const fileInputRef = useRef<HTMLInputElement>(null);
	const editor = useEditor();

	const [activeTransition, setActiveTransition] = useState<"none" | "pop" | "slide">("none");
	const [transDuration, setTransDuration] = useState<number>(0.2);
	const [transIntensity, setTransIntensity] = useState<number>(1.15);

	const handleTransitionChange = (type: "none" | "pop" | "slide") => {
		setActiveTransition(type);
		if (type === "pop") {
			setTransIntensity(1.15);
		} else if (type === "slide") {
			setTransIntensity(50);
		}
	};

	const handleApplyTransitionsToAll = () => {
		const scene = editor.scenes.getActiveSceneOrNull();
		if (!scene) return;

		const textTracks = scene.tracks.overlay.filter(
			(track) => track.type === "text",
		);

		const updates = textTracks.flatMap((track) => {
			return track.elements.map((element) => {
				let nextAnimations = element.animations;

				nextAnimations = clearPropertyAnimations({ animations: nextAnimations, propertyPath: "transform.scaleX" });
				nextAnimations = clearPropertyAnimations({ animations: nextAnimations, propertyPath: "transform.scaleY" });
				nextAnimations = clearPropertyAnimations({ animations: nextAnimations, propertyPath: "transform.positionY" });

				if (activeTransition === "none") {
					return {
						trackId: track.id,
						elementId: element.id,
						patch: { animations: nextAnimations },
					};
				}

				const durationSecs = mediaTimeToSeconds({ time: element.duration });
				const transitionSecs = Math.min(transDuration, durationSecs / 2);

				if (activeTransition === "pop") {
					const times = [
						ZERO_MEDIA_TIME,
						mediaTimeFromSeconds({ seconds: transitionSecs / 2 }),
						mediaTimeFromSeconds({ seconds: transitionSecs }),
						mediaTimeFromSeconds({ seconds: durationSecs - transitionSecs }),
						element.duration,
					];
					const values = [0, transIntensity, 1.0, 1.0, 0];

					for (let i = 0; i < times.length; i++) {
						nextAnimations = upsertElementKeyframe({
							animations: nextAnimations,
							propertyPath: "transform.scaleX",
							time: times[i],
							value: values[i],
							interpolation: "linear",
						});
						nextAnimations = upsertElementKeyframe({
							animations: nextAnimations,
							propertyPath: "transform.scaleY",
							time: times[i],
							value: values[i],
							interpolation: "linear",
						});
					}
				} else if (activeTransition === "slide") {
					const times = [
						ZERO_MEDIA_TIME,
						mediaTimeFromSeconds({ seconds: transitionSecs }),
						mediaTimeFromSeconds({ seconds: durationSecs - transitionSecs }),
						element.duration,
					];
					const baseY = element.transform.position.y;
					const values = [baseY + transIntensity, baseY, baseY, baseY + transIntensity];

					for (let i = 0; i < times.length; i++) {
						nextAnimations = upsertElementKeyframe({
							animations: nextAnimations,
							propertyPath: "transform.positionY",
							time: times[i],
							value: values[i],
							interpolation: "linear",
						});
					}
				}

				return {
					trackId: track.id,
					elementId: element.id,
					patch: { animations: nextAnimations },
				};
			});
		});

		if (updates.length > 0) {
			editor.timeline.updateElements({ updates });
		}
	};

	const isProcessing = processing.status === "processing";

	const activeDiagnostics = useEditor((e) =>
		e.diagnostics.getActive({ scope: TRANSCRIPTION_DIAGNOSTICS_SCOPE }),
	);

	const hasTextElements = useEditor((e) => {
		const scene = e.scenes.getActiveSceneOrNull();
		if (!scene) return false;
		return scene.tracks.overlay.some(
			(track) => track.type === "text" && track.elements.length > 0,
		);
	});

	const handleExportSRT = () => {
		const scene = editor.scenes.getActiveSceneOrNull();
		if (!scene) return;

		const textTracks = scene.tracks.overlay.filter(
			(track) => track.type === "text",
		);
		const textElements = textTracks.flatMap((track) => track.elements);

		if (textElements.length === 0) return;

		const srtText = exportToSRT({ elements: textElements });

		const blob = new Blob([srtText], { type: "text/srt;charset=utf-8" });
		const url = URL.createObjectURL(blob);
		const link = document.createElement("a");
		link.href = url;
		link.download = "subtitles.srt";
		document.body.appendChild(link);
		link.click();
		document.body.removeChild(link);
		URL.revokeObjectURL(url);
	};

	const handleProgress = (progress: TranscriptionProgress) => {
		if (progress.status === "loading-model") {
			dispatch({
				type: "update_step",
				step: `Loading model ${Math.round(progress.progress)}%`,
			});
		} else if (progress.status === "transcribing") {
			dispatch({ type: "update_step", step: "Transcribing..." });
		}
	};

	const insertCaptions = ({
		captions,
	}: {
		captions: CaptionChunk[];
	}): boolean => {
		const trackId = insertCaptionChunksAsTextTrack({ editor, captions });
		return trackId !== null;
	};

	const handleGenerateTranscript = async () => {
		dispatch({ type: "start", step: "Extracting audio..." });
		try {
			const audioBlob = await extractTimelineAudio({
				tracks: editor.scenes.getActiveScene().tracks,
				mediaAssets: editor.media.getAssets(),
				totalDuration: editor.timeline.getTotalDuration(),
			});

			dispatch({ type: "update_step", step: "Preparing audio..." });
			const { samples } = await decodeAudioToFloat32({
				audioBlob,
				sampleRate: DEFAULT_TRANSCRIPTION_SAMPLE_RATE,
			});

			const result = await transcriptionService.transcribe({
				audioData: samples,
				language: selectedLanguage === "auto" ? undefined : selectedLanguage,
				modelId: selectedModel,
				onProgress: handleProgress,
			});

			dispatch({ type: "update_step", step: "Generating captions..." });
			const captionChunks = buildCaptionChunks({ segments: result.segments });

			if (!insertCaptions({ captions: captionChunks })) {
				dispatch({ type: "fail", error: "No captions were generated" });
				return;
			}

			dispatch({ type: "succeed", warnings: [] });
		} catch (error) {
			console.error("Transcription failed:", error);
			dispatch({
				type: "fail",
				error:
					error instanceof Error
						? error.message
						: "An unexpected error occurred",
			});
		}
	};

	const handleImportClick = () => {
		fileInputRef.current?.click();
	};

	const handleImportFile = async ({ file }: { file: File }) => {
		dispatch({ type: "start", step: "Reading subtitle file..." });
		try {
			const input = await file.text();
			const result = parseSubtitleFile({
				fileName: file.name,
				input,
			});

			if (result.captions.length === 0) {
				dispatch({
					type: "fail",
					error: "No valid subtitle cues were found in the subtitle file",
				});
				return;
			}

			dispatch({ type: "update_step", step: "Importing subtitles..." });

			if (!insertCaptions({ captions: result.captions })) {
				dispatch({ type: "fail", error: "No captions were generated" });
				return;
			}

			const nextWarnings = [...result.warnings];
			if (result.skippedCueCount > 0) {
				nextWarnings.unshift(
					`Imported ${result.captions.length} subtitle cue(s) and skipped ${result.skippedCueCount} malformed cue(s).`,
				);
			}

			dispatch({ type: "succeed", warnings: nextWarnings });
		} catch (error) {
			console.error("Subtitle import failed:", error);
			dispatch({
				type: "fail",
				error:
					error instanceof Error
						? error.message
						: "An unexpected error occurred",
			});
		}
	};

	const handleFileChange = async ({
		event,
	}: {
		event: React.ChangeEvent<HTMLInputElement>;
	}) => {
		const file = event.target.files?.[0];
		if (event.target) {
			event.target.value = "";
		}
		if (!file) return;

		await handleImportFile({ file });
	};

	const handleLanguageChange = ({ value }: { value: string }) => {
		if (value === "auto") {
			setSelectedLanguage("auto");
			return;
		}

		const matchedLanguage = TRANSCRIPTION_LANGUAGES.find(
			(language) => language.code === value,
		);
		if (!matchedLanguage) return;
		setSelectedLanguage(matchedLanguage.code);
	};

	const error = processing.status === "idle" ? processing.error : null;
	const warnings = processing.status === "idle" ? processing.warnings : [];

	return (
		<PanelView
			title="Captions"
			contentClassName="px-0 flex flex-col h-full"
			actions={
				<TooltipProvider>
					<div className="flex items-center gap-1.5">
						{!isProcessing &&
							activeDiagnostics.map((diagnostic) => (
								<Tooltip key={diagnostic.id}>
									<TooltipTrigger asChild>
										<Button
											variant={DIAGNOSTIC_BUTTON_VARIANT[diagnostic.severity]}
											size="icon"
											aria-label={diagnostic.message}
										>
											<HugeiconsIcon icon={AlertCircleIcon} size={16} />
										</Button>
									</TooltipTrigger>
									<TooltipContent>{diagnostic.message}</TooltipContent>
								</Tooltip>
							))}
						<Button
							type="button"
							variant="outline"
							size="sm"
							onClick={handleImportClick}
							disabled={isProcessing}
							className="items-center justify-center gap-1.5"
						>
							<HugeiconsIcon icon={CloudUploadIcon} />
							Import
						</Button>
						<Button
							type="button"
							variant="outline"
							size="sm"
							onClick={handleExportSRT}
							disabled={isProcessing || !hasTextElements}
							className="items-center justify-center gap-1.5"
						>
							<HugeiconsIcon icon={Download01Icon} />
							Export
						</Button>
					</div>
				</TooltipProvider>
			}
			ref={containerRef}
		>
			<input
				ref={fileInputRef}
				type="file"
				accept=".srt,.ass"
				className="hidden"
				onChange={(event) => void handleFileChange({ event })}
			/>
			<Section
				showTopBorder={false}
				showBottomBorder={false}
				className="flex-1"
			>
				<SectionContent className="flex flex-col gap-4 h-full pt-1">
					<SectionFields>
						<SectionField label="Language">
							<Select
								value={selectedLanguage}
								onValueChange={(value) => handleLanguageChange({ value })}
							>
								<SelectTrigger>
									<SelectValue placeholder="Select a language" />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="auto">Auto detect</SelectItem>
									{TRANSCRIPTION_LANGUAGES.map((language) => (
										<SelectItem key={language.code} value={language.code}>
											{language.name}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</SectionField>
						<SectionField label="Model Size">
							<Select
								value={selectedModel}
								onValueChange={(value) => setSelectedModel(value as TranscriptionModelId)}
							>
								<SelectTrigger>
									<SelectValue placeholder="Select model size" />
								</SelectTrigger>
								<SelectContent>
									{TRANSCRIPTION_MODELS.map((model) => (
										<SelectItem key={model.id} value={model.id}>
											{model.name} ({model.description})
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</SectionField>
					</SectionFields>

					<div className="border-t pt-4 flex flex-col gap-4">
						<div className="flex flex-col gap-1">
							<h3 className="text-sm font-semibold">Bulk Transitions</h3>
							<p className="text-xs text-muted-foreground">Configure and apply transitions to all subtitles on the timeline.</p>
						</div>
						<div className="flex gap-2">
							<Button
								type="button"
								variant={activeTransition === "none" ? "secondary" : "outline"}
								size="sm"
								className="flex-1"
								onClick={() => handleTransitionChange("none")}
							>
								None
							</Button>
							<Button
								type="button"
								variant={activeTransition === "pop" ? "secondary" : "outline"}
								size="sm"
								className="flex-1"
								onClick={() => handleTransitionChange("pop")}
							>
								Pop Up
							</Button>
							<Button
								type="button"
								variant={activeTransition === "slide" ? "secondary" : "outline"}
								size="sm"
								className="flex-1"
								onClick={() => handleTransitionChange("slide")}
							>
								Slide
							</Button>
						</div>

						{activeTransition !== "none" && (
							<div className="flex flex-col gap-3">
								<div className="flex flex-col gap-1.5">
									<div className="flex justify-between items-center text-xs">
										<span className="text-muted-foreground">Duration</span>
										<span className="font-mono">{transDuration.toFixed(2)}s</span>
									</div>
									<Slider
										value={[transDuration]}
										min={0.05}
										max={0.80}
										step={0.05}
										onValueChange={([val]) => setTransDuration(val)}
									/>
								</div>

								<div className="flex flex-col gap-1.5">
									<div className="flex justify-between items-center text-xs">
										<span className="text-muted-foreground">
											{activeTransition === "pop" ? "Pop Scale" : "Slide Distance"}
										</span>
										<span className="font-mono">
											{activeTransition === "pop" ? `${transIntensity.toFixed(2)}x` : `${Math.round(transIntensity)}px`}
										</span>
									</div>
									<Slider
										value={[transIntensity]}
										min={activeTransition === "pop" ? 1.05 : 10}
										max={activeTransition === "pop" ? 1.50 : 150}
										step={activeTransition === "pop" ? 0.01 : 5}
										onValueChange={([val]) => setTransIntensity(val)}
									/>
								</div>
							</div>
						)}

						<Button
							type="button"
							variant="secondary"
							className="w-full text-xs"
							onClick={handleApplyTransitionsToAll}
							disabled={!hasTextElements}
						>
							Apply to all subtitles
						</Button>
					</div>

					<Button
						type="button"
						className="mt-auto w-full"
						onClick={handleGenerateTranscript}
						disabled={isProcessing || activeDiagnostics.length > 0}
					>
						{isProcessing && <Spinner className="mr-1" />}
						{isProcessing ? processing.step : "Generate transcript"}
					</Button>
					{error && (
						<div className="bg-destructive/10 border-destructive/20 rounded-md border p-3">
							<p className="text-destructive text-sm">{error}</p>
						</div>
					)}
					{warnings.length > 0 && (
						<div className="rounded-md border border-amber-500/20 bg-amber-500/10 p-3">
							<ul className="space-y-1 text-sm text-amber-700">
								{warnings.map((warning) => (
									<li key={warning}>{warning}</li>
								))}
							</ul>
						</div>
					)}
				</SectionContent>
			</Section>
		</PanelView>
	);
}
