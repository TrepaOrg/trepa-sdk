import React, {
	useEffect,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
} from 'react';
import { Box, render, Text, useStdout } from 'ink';
import Spinner from 'ink-spinner';
import type { EventKind, TrepaLogSlot } from './event-kind';

type InkLayoutMode = 'global' | 'swarm';

type GlobalLevel =
	| 'log'
	| 'info'
	| 'warn'
	| 'error'
	| 'success'
	| 'ready'
	| 'start';

interface GlobalLine {
	id: number;
	level: GlobalLevel;
	text: string;
}

interface SlotLine {
	id: number;
	kind: EventKind;
	text: string;
}

/** One swarm column’s wallet line in the Ink HUD. */
export interface SlotWalletHudLine {
	username: string;
	sol: string;
	usdc: string;
}

interface SwarmMetaLine {
	id: number;
	text: string;
}

interface InkSnapshot {
	layout: InkLayoutMode;
	botCount: number;
	globalLines: readonly GlobalLine[];
	swarmMetaLines: readonly SwarmMetaLine[];
	slotLines: readonly (readonly SlotLine[])[];
	slotHud: readonly SlotWalletHudLine[];
}

const MAX_SWARM_META_LINES = 3;

const MAX_GLOBAL = 7;

const GLOBAL_LOG_VIEWPORT_LINES = 7;

const MAX_SLOT_LOG_LINES = 6;

const MAX_SWARM_SLOT_TEXT_CODEPOINTS = 480;

function clampSwarmSlotMessage(text: string): string {
	const normalized = text.replace(/\s+/g, ' ').trim();
	const chars = [...normalized];
	if (chars.length <= MAX_SWARM_SLOT_TEXT_CODEPOINTS) return normalized;
	return `${chars.slice(0, MAX_SWARM_SLOT_TEXT_CODEPOINTS - 1).join('')}…`;
}

const BOT_COLORS = [
	'cyan',
	'magenta',
	'yellow',
	'green',
	'blue',
	'red',
] as const;

const MIN_BOT_COL_FLEX = 38;
const COL_GAP = 1;
const RESIZE_DEBOUNCE_MS = 160;
const MIN_VALID_COLUMNS = 20;

let nextId = 0;
const emptyHudLine = (): SlotWalletHudLine => ({
	username: '',
	sol: '—',
	usdc: '—',
});

let snapshot: InkSnapshot = {
	layout: 'global',
	botCount: 1,
	globalLines: [],
	swarmMetaLines: [],
	slotLines: [],
	slotHud: [],
};

const listeners = new Set<() => void>();

function notify(): void {
	for (const l of listeners) l();
}

function subscribe(cb: () => void): () => void {
	listeners.add(cb);
	return () => listeners.delete(cb);
}

function getSnapshot(): InkSnapshot {
	return snapshot;
}

function getServerSnapshot(): InkSnapshot {
	return snapshot;
}

let inkInstance: ReturnType<typeof render> | null = null;

export function isInkMounted(): boolean {
	return inkInstance !== null;
}

export function inkLayoutIsSwarm(): boolean {
	return snapshot.layout === 'swarm';
}

export function mountInkIfNeeded(): void {
	if (inkInstance !== null) return;
	inkInstance = render(<TrepaInkRoot />);
}

export function setInkSwarmLayout(botCount: number): void {
	const n = Math.max(1, botCount);
	snapshot = {
		...snapshot,
		layout: 'swarm',
		botCount: n,
		slotLines: Array.from({ length: n }, (_, i) => snapshot.slotLines[i] ?? []),
		slotHud: Array.from({ length: n }, (_, i) => snapshot.slotHud[i] ?? emptyHudLine()),
	};
	notify();
}

export function patchSlotWalletHud(
	slotIndex: number,
	patch: Partial<SlotWalletHudLine>,
): void {
	const minLen = Math.max(
		slotIndex + 1,
		snapshot.botCount,
		snapshot.slotHud.length,
	);
	const padded = Array.from({ length: minLen }, (_, i) =>
		snapshot.slotHud[i] ?? emptyHudLine(),
	);
	const hud = padded.map((line, i) =>
		i === slotIndex ? { ...line, ...patch } : line,
	);
	snapshot = { ...snapshot, slotHud: hud };
	notify();
}

export function pushInkGlobal(level: GlobalLevel, text: string): void {
	snapshot = {
		...snapshot,
		globalLines: [
			...snapshot.globalLines.slice(-(MAX_GLOBAL - 1)),
			{ id: nextId++, level, text },
		],
	};
	notify();
}

export function pushInkSwarmMetaLine(text: string): void {
	const t = text.replace(/\s+/g, ' ').trim();
	if (t.length === 0) return;
	snapshot = {
		...snapshot,
		swarmMetaLines: [
			...snapshot.swarmMetaLines,
			{ id: nextId++, text: t },
		].slice(-MAX_SWARM_META_LINES),
	};
	notify();
}

export function pushInkSlotLine(
	slot: TrepaLogSlot,
	kind: EventKind,
	text: string,
): void {
	const idx = slot.index;
	const rows = snapshot.slotLines.map((lines) => [...lines]);
	while (rows.length <= idx) rows.push([]);
	const prev = rows[idx] ?? [];
	const next = [
		...prev,
		{ id: nextId++, kind, text: clampSwarmSlotMessage(text) },
	].slice(-MAX_SLOT_LOG_LINES);
	rows[idx] = next;
	snapshot = { ...snapshot, slotLines: rows };
	notify();
}

export function unmountInk(): void {
	if (!inkInstance) return;
	inkInstance.unmount();
	inkInstance = null;
	snapshot = {
		layout: 'global',
		botCount: 1,
		globalLines: [],
		swarmMetaLines: [],
		slotLines: [],
		slotHud: [],
	};
	listeners.clear();
}

function levelColor(level: GlobalLevel): string | undefined {
	switch (level) {
		case 'error':
			return 'red';
		case 'warn':
			return 'yellow';
		case 'success':
		case 'ready':
			return 'green';
		case 'start':
			return 'cyan';
		default:
			return undefined;
	}
}

function slotKindColor(kind: EventKind): string | undefined {
	switch (kind) {
		case 'error':
			return 'red';
		case 'ready':
			return 'green';
		case 'pred':
		case 'pred_update':
		case 'fund':
			return 'green';
		case 'skip':
			return 'gray';
		default:
			return undefined;
	}
}

function slotKindPrefix(kind: EventKind): string {
	switch (kind) {
		case 'ready':
			return '◆ ';
		case 'pred':
		case 'pred_update':
			return '✓ ';
		case 'fund':
			return '◈ ';
		case 'skip':
			return '· ';
		case 'error':
			return '✖ ';
		default:
			return '';
	}
}

function useTerminalDimensions(stdout: NodeJS.WriteStream | undefined): {
	columns: number;
	rows: number;
} {
	const lastGood = useRef({
		columns: Math.max(MIN_VALID_COLUMNS, stdout?.columns ?? 80),
		rows: Math.max(1, stdout?.rows ?? 24),
	});
	const [dim, setDim] = useState(lastGood.current);

	useEffect(() => {
		if (!stdout) return;

		let debounceTimer: ReturnType<typeof setTimeout> | undefined;

		const apply = (): void => {
			const c = stdout.columns;
			const r = stdout.rows;
			if (typeof c !== 'number' || c < MIN_VALID_COLUMNS) return;
			const next = {
				columns: c,
				rows: Math.max(1, typeof r === 'number' && r > 0 ? r : 24),
			};
			lastGood.current = next;
			setDim(next);
		};

		const onResize = (): void => {
			if (debounceTimer !== undefined) clearTimeout(debounceTimer);
			debounceTimer = setTimeout(apply, RESIZE_DEBOUNCE_MS);
		};

		apply();
		stdout.on('resize', onResize);
		return () => {
			if (debounceTimer !== undefined) clearTimeout(debounceTimer);
			stdout.off('resize', onResize);
		};
	}, [stdout]);

	return dim;
}

function GlobalLineView({
	line,
	contentWidth,
}: {
	line: GlobalLine;
	contentWidth: number;
}): React.ReactElement {
	const c = levelColor(line.level);
	if (line.level === 'start') {
		return (
			<Box
				flexDirection="row"
				width={contentWidth}
				height={1}
				flexShrink={0}
				overflow="hidden"
			>
				<Box marginRight={1} flexShrink={0}>
					<Text color={c}>
						<Spinner type="dots" />
					</Text>
				</Box>
				<Box flexGrow={1} flexShrink={1} minWidth={8} overflow="hidden">
					<Text color={c} wrap="truncate-end">
						{line.text}
					</Text>
				</Box>
			</Box>
		);
	}
	return (
		<Box
			flexDirection="column"
			width={contentWidth}
			height={1}
			flexShrink={0}
			overflow="hidden"
		>
			<Text color={c} wrap="truncate-end">
				{line.text}
			</Text>
		</Box>
	);
}

function SwarmMetaStrip({
	lines,
	width,
}: {
	lines: readonly SwarmMetaLine[];
	width: number;
}): React.ReactElement | null {
	if (lines.length === 0) return null;
	return (
		<Box
			flexShrink={0}
			flexDirection="column"
			width={width}
			borderStyle="single"
			borderColor="cyan"
			paddingX={1}
			marginBottom={1}
		>
			{lines.map((line) => (
				<Box key={line.id} flexShrink={0}>
					<Text color="cyan" wrap="wrap">
						◆ {line.text}
					</Text>
				</Box>
			))}
		</Box>
	);
}

function SlotColumn({
	slotIndex,
	botCount,
	lines,
	hud,
}: {
	slotIndex: number;
	botCount: number;
	lines: readonly SlotLine[];
	hud: SlotWalletHudLine;
}): React.ReactElement {
	const titleColor = BOT_COLORS[slotIndex % BOT_COLORS.length];
	const nameLine =
		hud.username === '' ? '@—' : `@${hud.username}`;
	return (
		<Box
			flexGrow={1}
			flexBasis={0}
			flexShrink={1}
			minWidth={0}
			height="100%"
			minHeight={0}
			flexDirection="column"
			borderStyle="single"
			borderColor={titleColor}
			paddingX={0}
			overflow="hidden"
		>
			<Box
				flexShrink={0}
				flexDirection="column"
				paddingX={1}
				overflow="hidden"
				width="100%"
			>
				<Box height={1} overflow="hidden">
					<Text bold color={titleColor} wrap="truncate-end">
						bot {slotIndex + 1}/{botCount}
					</Text>
				</Box>
				<Box height={1} overflow="hidden">
					<Text dimColor wrap="truncate-end">
						{nameLine}
					</Text>
				</Box>
				<Box height={1} overflow="hidden">
					<Text dimColor wrap="truncate-end">
						{hud.sol}
					</Text>
				</Box>
				<Box height={1} overflow="hidden">
					<Text dimColor wrap="truncate-end">
						{hud.usdc}
					</Text>
				</Box>
			</Box>
			<Box
				flexGrow={1}
				minHeight={0}
				flexDirection="column"
				rowGap={1}
				overflow="hidden"
				justifyContent="flex-end"
				paddingX={1}
				width="100%"
			>
				{lines.map((line, lineIdx) => {
					const isLatest = lineIdx === lines.length - 1;
					return (
						<Box key={line.id} flexShrink={0} width="100%">
							<Text
								dimColor={!isLatest}
								color={slotKindColor(line.kind)}
								wrap="wrap"
							>
								{slotKindPrefix(line.kind)}
								{line.text}
							</Text>
						</Box>
					);
				})}
			</Box>
		</Box>
	);
}

function maxBotsPerRow(contentWidth: number): number {
	const cell = MIN_BOT_COL_FLEX + COL_GAP;
	return Math.max(1, Math.floor((contentWidth + COL_GAP) / cell));
}

function balancedBotRows(total: number, maxPerRow: number): number[][] {
	if (total <= 0) return [];
	if (total <= maxPerRow) {
		return [Array.from({ length: total }, (_, i) => i)];
	}
	const numRows = Math.ceil(total / maxPerRow);
	const baseSize = Math.floor(total / numRows);
	const remainder = total % numRows;
	const chunkRows: number[][] = [];
	let idx = 0;
	for (let r = 0; r < numRows; r++) {
		const count = baseSize + (r < remainder ? 1 : 0);
		chunkRows.push(Array.from({ length: count }, (_, k) => idx + k));
		idx += count;
	}
	return chunkRows;
}

function TrepaInkRoot(): React.ReactElement {
	useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
	const { stdout } = useStdout();
	const term = useTerminalDimensions(stdout);
	const s = snapshot;

	const gridRows = useMemo(
		() => balancedBotRows(s.botCount, maxBotsPerRow(term.columns)),
		[term.columns, s.botCount],
	);

	const cols = term.columns;
	const rows = term.rows;

	if (s.layout === 'global') {
		return (
			<Box flexDirection="column" width={cols} height={rows} overflow="hidden">
				<Box
					flexGrow={1}
					minHeight={0}
					flexDirection="column"
					justifyContent="flex-end"
					width={cols}
				>
					{s.globalLines.map((line) => (
						<GlobalLineView key={line.id} line={line} contentWidth={cols} />
					))}
				</Box>
			</Box>
		);
	}

	const headerInnerW = Math.max(8, cols - 4);
	const headerLineCount = s.globalLines.length;
	const headerViewportH = Math.min(
		GLOBAL_LOG_VIEWPORT_LINES,
		Math.max(headerLineCount, 1),
	);

	return (
		<Box flexDirection="column" width={cols} height={rows} overflow="hidden">
			<Box
				flexShrink={0}
				flexDirection="column"
				borderStyle="round"
				borderColor="gray"
				width={cols}
				overflow="hidden"
			>
				<Box
					flexDirection="column"
					height={headerViewportH}
					overflow="hidden"
					justifyContent="flex-start"
					paddingX={1}
				>
					{s.globalLines.map((line) => (
						<GlobalLineView
							key={line.id}
							line={line}
							contentWidth={headerInnerW}
						/>
					))}
				</Box>
			</Box>

			<SwarmMetaStrip lines={s.swarmMetaLines} width={cols} />

			<Box
				flexGrow={1}
				minHeight={0}
				flexDirection="column"
				width={cols}
				overflow="hidden"
			>
				{gridRows.map((rowIndices, rowIdx) => {
					return (
						<Box
							key={rowIdx}
							flexGrow={1}
							flexBasis={0}
							minHeight={0}
							flexDirection="row"
							width={cols}
							height="100%"
							columnGap={COL_GAP}
							overflow="hidden"
						>
							{rowIndices.map((i) => (
								<SlotColumn
									key={i}
									slotIndex={i}
									botCount={s.botCount}
									lines={s.slotLines[i] ?? []}
									hud={s.slotHud[i] ?? emptyHudLine()}
								/>
							))}
						</Box>
					);
				})}
			</Box>
		</Box>
	);
}
