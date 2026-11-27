import { hydrate, prerender as ssr } from 'preact-iso';
import { useState, useEffect, useRef } from 'preact/hooks';
import { html } from 'htm/preact';

import './style.css';

export interface PlayerState {
	title: string;
	rootPath: string | null;
	currentTrack: string | null;
	isPlaying: boolean;
	volume: number;
	loop: boolean;
	currentTime: number;
	duration: number;
}

interface TreeNode {
	name: string;
	path: string;
	type: 'dir' | 'file';
	children?: TreeNode[];
}

interface Credits {
	Author?: string;
	Attribution?: string;
	Source?: string;
	[key: string]: unknown;
}

interface MediaData {
	root: string;
	credits: Credits | null;
	tree: TreeNode[];
}

interface BrowseData {
	path: string;
	parent: string | null;
	entries: { name: string; path: string; type: 'dir' }[];
}

const GLOBAL_STORAGE_KEY = 'overlay_player_global_v1';
const SESSION_LINKED_KEY = 'overlay_player_is_linked';
const SESSION_DATA_KEY = 'overlay_player_session_v1';
const BROADCAST_CHANNEL_NAME = 'overlay_player_sync_channel';

const DEFAULT_STATE: PlayerState = {
	title: 'AUDIO_PLAYER',
	rootPath: null,
	currentTrack: null,
	isPlaying: false,
	volume: 0.8,
	loop: false,
	currentTime: 0,
	duration: 0,
};

function generateSessionId(): string {
	if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
		return crypto.randomUUID();
	}
	return `sess_${Math.random().toString(36).substring(2, 9)}`;
}

const TAB_SESSION_ID = generateSessionId();

function isPlayerState(value: unknown): value is PlayerState {
	if (!value || typeof value !== 'object') return false;
	const v = value as Record<string, unknown>;
	return (
		typeof v.title === 'string' &&
		(v.rootPath === null || typeof v.rootPath === 'string') &&
		(v.currentTrack === null || typeof v.currentTrack === 'string') &&
		typeof v.isPlaying === 'boolean' &&
		typeof v.volume === 'number' &&
		typeof v.loop === 'boolean' &&
		typeof v.currentTime === 'number'
	);
}

function getStoredGlobalState(): PlayerState {
	if (typeof window === 'undefined') return DEFAULT_STATE;
	try {
		const raw = localStorage.getItem(GLOBAL_STORAGE_KEY);
		if (raw) {
			const parsed = JSON.parse(raw);
			if (isPlayerState(parsed)) return parsed;
		}
	} catch {
		// fallback to default
	}
	return DEFAULT_STATE;
}

function getStoredSessionState(): PlayerState | null {
	if (typeof window === 'undefined') return null;
	try {
		const raw = sessionStorage.getItem(SESSION_DATA_KEY);
		if (raw) {
			const parsed = JSON.parse(raw);
			if (isPlayerState(parsed)) return parsed;
		}
	} catch {
		// fallback to null
	}
	return null;
}

function getStoredLinkStatus(): boolean {
	if (typeof window === 'undefined') return true;
	try {
		const raw = sessionStorage.getItem(SESSION_LINKED_KEY);
		if (raw !== null) {
			return raw === 'true';
		}
	} catch {
		// fallback to linked
	}
	return true;
}

function fileUrl(filePath: string) {
	return `/api/player/file?path=${encodeURIComponent(filePath)}`;
}

function baseName(p: string) {
	return p.split(/[\\/]/).filter(Boolean).pop() || p;
}

function formatTime(seconds: number) {
	if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
	const m = Math.floor(seconds / 60);
	const s = Math.floor(seconds % 60);
	return `${m}:${s.toString().padStart(2, '0')}`;
}

// Folder names between the media root and the track's directory, in traversal order
function getTrackTags(rootPath: string | null, trackPath: string | null): string[] {
	if (!rootPath || !trackPath) return [];
	const norm = (p: string) => p.replace(/\//g, '\\').replace(/\\+$/, '');
	const root = norm(rootPath);
	const track = norm(trackPath);
	const prefix = root.toLowerCase() + '\\';
	if (!track.toLowerCase().startsWith(prefix)) return [];
	const parts = track.slice(root.length + 1).split('\\');
	parts.pop(); // drop the file name
	return parts.filter(Boolean);
}

function flattenFiles(nodes: TreeNode[]): TreeNode[] {
	const out: TreeNode[] = [];
	const walk = (list: TreeNode[]) => {
		for (const n of list) {
			if (n.type === 'file') out.push(n);
			else if (n.children) walk(n.children);
		}
	};
	walk(nodes);
	return out;
}

function countFiles(nodes: TreeNode[]): number {
	return flattenFiles(nodes).length;
}

function ancestorDirPaths(rootChildren: TreeNode[], trackPath: string | null): Set<string> {
	const set = new Set<string>();
	if (!trackPath) return set;
	const walk = (nodes: TreeNode[]) => {
		for (const n of nodes) {
			if (n.type !== 'dir') continue;
			const isAncestor = trackPath.startsWith(n.path + '\\') || trackPath.startsWith(n.path + '/');
			if (isAncestor) {
				set.add(n.path);
				if (n.children) walk(n.children);
			}
		}
	};
	walk(rootChildren);
	return set;
}

// ── Playlist tree item (recursive, animated collapse) ──
function TreeItem(props: {
	node: TreeNode;
	depth: number;
	expandedDirs: Set<string>;
	toggleDir: (path: string) => void;
	currentTrack: string | null;
	onPlayFile: (path: string) => void;
}) {
	const { node, depth, expandedDirs, toggleDir, currentTrack, onPlayFile } = props;
	const isDir = node.type === 'dir';
	const expanded = isDir && expandedDirs.has(node.path);
	const isCurrent = !isDir && node.path === currentTrack;
	const fileCount = isDir && node.children ? countFiles(node.children) : 0;

	if (isDir) {
		return html`
			<div class="tree_node" style="--depth: ${depth}">
				<div
					class="tree_row tree_dir_row ${expanded ? 'is_open' : ''}"
					onClick=${() => toggleDir(node.path)}
				>
					<span class="tree_chevron">▶</span>
					<span class="tree_icon">▣</span>
					<span class="tree_name">${node.name}</span>
					<span class="tree_count">${fileCount}</span>
				</div>
				<div class="tree_children ${expanded ? 'open' : ''}">
					<div class="tree_inner">
						${(node.children || []).map(child => html`
							<${TreeItem}
								node=${child}
								depth=${depth + 1}
								expandedDirs=${expandedDirs}
								toggleDir=${toggleDir}
								currentTrack=${currentTrack}
								onPlayFile=${onPlayFile}
							/>
						`)}
					</div>
				</div>
			</div>
		`;
	}

	return html`
		<div class="tree_node" style="--depth: ${depth}">
			<div
				class="tree_row tree_file_row ${isCurrent ? 'is_current' : ''}"
				onClick=${() => onPlayFile(node.path)}
				title="${node.path}"
			>
				<span class="tree_chevron tree_chevron_spacer"></span>
				<span class="tree_icon">♪</span>
				<span class="tree_name">${node.name}</span>
			</div>
		</div>
	`;
}

export function App() {
	// ── Global synced player state (same pattern as st-tracker-app) ──
	const [isLinked, setIsLinked] = useState<boolean>(getStoredLinkStatus);
	const [playerState, setPlayerState] = useState<PlayerState>(() => {
		const initiallyLinked = getStoredLinkStatus();
		if (!initiallyLinked) {
			const local = getStoredSessionState();
			if (local) return local;
		}
		return getStoredGlobalState();
	});

	// ── Local media state ──
	const [media, setMedia] = useState<MediaData | null>(null);
	const [scanError, setScanError] = useState<string | null>(null);
	const [isScanning, setIsScanning] = useState(false);
	const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
	const [displayTime, setDisplayTime] = useState(0);
	const [scrubbing, setScrubbing] = useState(false);

	// ── Config panel / folder browser state ──
	const [isExpanded, setIsExpanded] = useState(false);
	const [browsePathInput, setBrowsePathInput] = useState('');
	const [browseData, setBrowseData] = useState<BrowseData | null>(null);
	const [browseError, setBrowseError] = useState<string | null>(null);
	const [isBrowsing, setIsBrowsing] = useState(false);

	const isLinkedRef = useRef(isLinked);
	const playerStateRef = useRef(playerState);
	const audioRef = useRef<HTMLAudioElement | null>(null);
	const seekBarRef = useRef<HTMLDivElement | null>(null);
	const scannedOnceRef = useRef(false);

	useEffect(() => {
		isLinkedRef.current = isLinked;
		playerStateRef.current = playerState;
	}, [isLinked, playerState]);

	const { title, rootPath, currentTrack, isPlaying, volume, loop } = playerState;

	// ── Push remote state into the audio element ──
	const applyRemoteState = (state: PlayerState) => {
		setPlayerState(state);
		const a = audioRef.current;
		if (!a) return;
		a.volume = state.volume;
		a.loop = state.loop;
		if (state.currentTrack) {
			const url = fileUrl(state.currentTrack);
			const currentSrc = a.getAttribute('src') || '';
			if (currentSrc !== url) {
				a.src = url;
				a.currentTime = state.currentTime || 0;
			} else if (Math.abs(a.currentTime - state.currentTime) > 1.5) {
				a.currentTime = state.currentTime;
			}
		}
		if (state.isPlaying) {
			a.play().catch(() => {});
		} else {
			a.pause();
		}
	};

	// Cross-session synchronization via SSE, BroadcastChannel, and localStorage events
	useEffect(() => {
		if (typeof window === 'undefined') return;

		// Ensure global storage is seeded if empty
		try {
			if (!localStorage.getItem(GLOBAL_STORAGE_KEY)) {
				localStorage.setItem(GLOBAL_STORAGE_KEY, JSON.stringify(DEFAULT_STATE));
			}
		} catch {
			// ignore storage quota/security error
		}

		// 1. Connect to Server-Sent Events (SSE) for cross-browser & cross-device sync
		let eventSource: EventSource | null = null;
		if (typeof EventSource !== 'undefined') {
			try {
				eventSource = new EventSource('/api/player/events');
				eventSource.onmessage = (event: MessageEvent) => {
					try {
						const data = JSON.parse(event.data);
						if (!data || data.senderId === TAB_SESSION_ID) return;

						if ((data.type === 'SYNC_UPDATE' || data.type === 'INIT') && isPlayerState(data.state)) {
							if (isLinkedRef.current) {
								applyRemoteState(data.state);
								try {
									localStorage.setItem(GLOBAL_STORAGE_KEY, JSON.stringify(data.state));
								} catch {
									// ignore storage error
								}
							}
						}
					} catch {
						// ignore parse error
					}
				};
			} catch {
				// ignore SSE connection error
			}
		}

		// 2. BroadcastChannel for instant zero-latency sync across tabs of same origin
		let channel: BroadcastChannel | null = null;
		if (typeof BroadcastChannel !== 'undefined') {
			channel = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
			channel.onmessage = (event: MessageEvent) => {
				const data = event.data;
				if (!data || data.senderId === TAB_SESSION_ID) return;

				if (data.type === 'SYNC_UPDATE' && isPlayerState(data.state)) {
					if (isLinkedRef.current) {
						applyRemoteState(data.state);
					}
				} else if (data.type === 'REQUEST_GLOBAL_STATE') {
					if (isLinkedRef.current && channel) {
						channel.postMessage({
							type: 'PROVIDE_GLOBAL_STATE',
							targetId: data.senderId,
							senderId: TAB_SESSION_ID,
							state: playerStateRef.current,
						});
					}
				} else if (data.type === 'PROVIDE_GLOBAL_STATE') {
					if (isLinkedRef.current && data.targetId === TAB_SESSION_ID && isPlayerState(data.state)) {
						applyRemoteState(data.state);
					}
				}
			};

			channel.postMessage({
				type: 'REQUEST_GLOBAL_STATE',
				senderId: TAB_SESSION_ID,
			});
		}

		// 3. Fallback & complement: listen to storage events across tabs/windows
		const handleStorage = (e: StorageEvent) => {
			if (e.key === GLOBAL_STORAGE_KEY && isLinkedRef.current && e.newValue) {
				try {
					const parsed = JSON.parse(e.newValue);
					if (isPlayerState(parsed)) {
						applyRemoteState(parsed);
					}
				} catch {
					// ignore json parse error
				}
			}
		};

		window.addEventListener('storage', handleStorage);

		return () => {
			window.removeEventListener('storage', handleStorage);
			if (channel) {
				channel.close();
			}
			if (eventSource) {
				eventSource.close();
			}
		};
	}, []);

	// Helper to broadcast state to server, global storage, and peers
	const broadcastState = (newState: PlayerState) => {
		// Save locally to localStorage
		try {
			localStorage.setItem(GLOBAL_STORAGE_KEY, JSON.stringify(newState));
		} catch {
			// ignore quota error
		}

		// Broadcast to same-origin tabs
		if (typeof BroadcastChannel !== 'undefined') {
			try {
				const channel = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
				channel.postMessage({
					type: 'SYNC_UPDATE',
					senderId: TAB_SESSION_ID,
					state: newState,
				});
				channel.close();
			} catch {
				// ignore broadcast error
			}
		}

		// Push to server for cross-browser (Edge, Chrome, Firefox) and cross-device sync
		if (typeof fetch !== 'undefined') {
			fetch('/api/player', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ state: newState, senderId: TAB_SESSION_ID }),
			}).catch(() => {
				// Server may be offline or standalone; silently continue with local storage
			});
		}
	};

	// Save changes depending on link state
	const commitState = (updater: (prev: PlayerState) => PlayerState) => {
		setPlayerState(prev => {
			const updated = updater(prev);
			if (isLinked) {
				broadcastState(updated);
			} else {
				try {
					sessionStorage.setItem(SESSION_DATA_KEY, JSON.stringify(updated));
				} catch {
					// ignore sessionStorage error
				}
			}
			return updated;
		});
	};

	// ── Media scanning ──
	const scanFolder = async (folderPath?: string) => {
		setIsScanning(true);
		setScanError(null);
		try {
			const url = folderPath
				? `/api/player/scan?path=${encodeURIComponent(folderPath)}`
				: '/api/player/scan';
			const res = await fetch(url);
			const data = await res.json();
			if (!res.ok) throw new Error(data?.error || `Scan failed (${res.status})`);

			const nextMedia: MediaData = {
				root: data.root,
				credits: data.credits || null,
				tree: data.tree || [],
			};
			setMedia(nextMedia);

			// Expand first-level folders and ancestors of the current track
			const dirs = new Set<string>();
			for (const n of nextMedia.tree) {
				if (n.type === 'dir') dirs.add(n.path);
			}
			for (const p of ancestorDirPaths(nextMedia.tree, playerStateRef.current.currentTrack)) {
				dirs.add(p);
			}
			setExpandedDirs(dirs);

			const rootName = baseName(nextMedia.root);
			commitState(prev => ({
				...prev,
				rootPath: nextMedia.root,
				title: prev.title === DEFAULT_STATE.title || prev.title === 'AUDIO_PLAYER'
					? rootName
					: prev.title,
			}));
		} catch (err) {
			setScanError(err instanceof Error ? err.message : 'Scan failed');
		} finally {
			setIsScanning(false);
		}
	};

	// Scan the synced root (or the server default) once on mount, and whenever
	// a remote session switches to a different root folder.
	useEffect(() => {
		if (typeof window === 'undefined') return;
		if (!scannedOnceRef.current) {
			scannedOnceRef.current = true;
			scanFolder(playerStateRef.current.rootPath || undefined);
			return;
		}
		if (rootPath && media && media.root !== rootPath) {
			scanFolder(rootPath);
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [rootPath]);

	// ── Folder browser ──
	const browse = async (dirPath?: string) => {
		setIsBrowsing(true);
		setBrowseError(null);
		try {
			const url = dirPath
				? `/api/player/browse?path=${encodeURIComponent(dirPath)}`
				: '/api/player/browse';
			const res = await fetch(url);
			const data = await res.json();
			if (!res.ok) throw new Error(data?.error || `Browse failed (${res.status})`);
			setBrowseData(data);
			setBrowsePathInput(data.path);
		} catch (err) {
			setBrowseError(err instanceof Error ? err.message : 'Browse failed');
		} finally {
			setIsBrowsing(false);
		}
	};

	const useFolder = (folderPath: string) => {
		scanFolder(folderPath);
	};

	// ── Playback controls ──
	const allFiles = media ? flattenFiles(media.tree) : [];

	const playFile = (path: string) => {
		const a = audioRef.current;
		if (!a) return;
		const state = playerStateRef.current;
		a.volume = state.volume;
		a.loop = state.loop;
		a.src = fileUrl(path);
		a.currentTime = 0;
		a.play().catch(() => {});
		setDisplayTime(0);
		commitState(prev => ({
			...prev,
			currentTrack: path,
			isPlaying: true,
			currentTime: 0,
			duration: 0,
		}));
	};

	const togglePlay = () => {
		const a = audioRef.current;
		if (!a) return;
		const state = playerStateRef.current;

		if (!state.currentTrack) {
			if (allFiles.length > 0) playFile(allFiles[0].path);
			return;
		}

		if (state.isPlaying) {
			a.pause();
			commitState(prev => ({ ...prev, isPlaying: false, currentTime: a.currentTime || 0 }));
		} else {
			if (!a.getAttribute('src')) a.src = fileUrl(state.currentTrack);
			a.play().catch(() => {});
			commitState(prev => ({ ...prev, isPlaying: true }));
		}
	};

	const stop = () => {
		const a = audioRef.current;
		if (a) {
			a.pause();
			a.currentTime = 0;
		}
		setDisplayTime(0);
		commitState(prev => ({ ...prev, isPlaying: false, currentTime: 0 }));
	};

	const toggleLoop = () => {
		const a = audioRef.current;
		const next = !playerStateRef.current.loop;
		if (a) a.loop = next;
		commitState(prev => ({ ...prev, loop: next }));
	};

	const setVolume = (value: number) => {
		const a = audioRef.current;
		const clamped = Math.min(1, Math.max(0, value));
		if (a) a.volume = clamped;
		commitState(prev => ({ ...prev, volume: clamped }));
	};

	// ── Seek bar ──
	const seekToClientX = (clientX: number) => {
		const a = audioRef.current;
		const bar = seekBarRef.current;
		if (!a || !bar) return;
		const rect = bar.getBoundingClientRect();
		const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
		const dur = a.duration || playerStateRef.current.duration || 0;
		a.currentTime = ratio * dur;
		setDisplayTime(a.currentTime);
	};

	const onSeekPointerDown = (e: PointerEvent) => {
		setScrubbing(true);
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		seekToClientX(e.clientX);
	};

	const onSeekPointerMove = (e: PointerEvent) => {
		if (scrubbing) seekToClientX(e.clientX);
	};

	const onSeekPointerUp = () => {
		setScrubbing(false);
	};

	// ── Audio element event handlers ──
	const onAudioTimeUpdate = () => {
		const a = audioRef.current;
		if (a && !scrubbing) setDisplayTime(a.currentTime);
	};

	const onAudioLoadedMetadata = () => {
		const a = audioRef.current;
		if (a && Number.isFinite(a.duration)) {
			commitState(prev => ({ ...prev, duration: a.duration }));
		}
	};

	const onAudioPlay = () => {
		commitState(prev => (prev.isPlaying ? prev : { ...prev, isPlaying: true }));
	};

	const onAudioPause = () => {
		const a = audioRef.current;
		if (a && a.ended) return; // 'ended' handler owns the transition
		commitState(prev =>
			prev.isPlaying
				? { ...prev, isPlaying: false, currentTime: a ? a.currentTime : prev.currentTime }
				: prev,
		);
	};

	const onAudioSeeked = () => {
		const a = audioRef.current;
		if (a) commitState(prev => ({ ...prev, currentTime: a.currentTime }));
	};

	const onAudioEnded = () => {
		const a = audioRef.current;
		const state = playerStateRef.current;
		if (state.loop && a) {
			a.currentTime = 0;
			a.play().catch(() => {});
			commitState(prev => ({ ...prev, currentTime: 0, isPlaying: true }));
			return;
		}
		// Advance to the next track in traversal order
		const files = allFiles;
		const idx = files.findIndex(f => f.path === state.currentTrack);
		const next = idx >= 0 && idx + 1 < files.length ? files[idx + 1] : null;
		if (next) {
			playFile(next.path);
		} else if (a) {
			a.currentTime = 0;
			commitState(prev => ({ ...prev, isPlaying: false, currentTime: 0 }));
		}
	};

	// ── Derived display values ──
	const trackName = currentTrack ? baseName(currentTrack) : 'NO TRACK LOADED';
	const tags = getTrackTags(rootPath || media?.root || null, currentTrack);
	const duration = playerState.duration || (audioRef.current?.duration ?? 0) || 0;
	const progressPct = duration > 0 ? Math.min(100, (displayTime / duration) * 100) : 0;

	const updateTitle = (newTitle: string) => {
		commitState(prev => ({ ...prev, title: newTitle }));
	};

	// Unlink session from global state
	const unlink = () => {
		setIsLinked(false);
		try {
			sessionStorage.setItem(SESSION_LINKED_KEY, 'false');
			sessionStorage.setItem(SESSION_DATA_KEY, JSON.stringify(playerState));
		} catch {
			// ignore storage error
		}
	};

	// Relink session by adopting the current global state
	const linkAndAdoptGlobal = () => {
		const applyState = (state: PlayerState) => {
			setPlayerState(state);
			try {
				localStorage.setItem(GLOBAL_STORAGE_KEY, JSON.stringify(state));
			} catch {
				// ignore storage error
			}
		};

		if (typeof fetch !== 'undefined') {
			fetch('/api/player')
				.then(res => res.json())
				.then(data => {
					if (isPlayerState(data)) {
						applyState(data);
					} else {
						applyState(getStoredGlobalState());
					}
				})
				.catch(() => {
					applyState(getStoredGlobalState());
				});
		} else {
			applyState(getStoredGlobalState());
		}

		setIsLinked(true);
		try {
			sessionStorage.setItem(SESSION_LINKED_KEY, 'true');
			sessionStorage.removeItem(SESSION_DATA_KEY);
		} catch {
			// ignore storage error
		}
	};

	// Relink session by overwriting global state with local player
	const linkAndPushGlobal = () => {
		setIsLinked(true);
		broadcastState(playerState);
		try {
			sessionStorage.setItem(SESSION_LINKED_KEY, 'true');
			sessionStorage.removeItem(SESSION_DATA_KEY);
		} catch {
			// ignore storage error
		}
	};

	const toggleDir = (path: string) => {
		setExpandedDirs(prev => {
			const next = new Set(prev);
			if (next.has(path)) next.delete(path);
			else next.add(path);
			return next;
		});
	};

	const mediaRoot = media?.root || rootPath;
	const totalTracks = media ? countFiles(media.tree) : 0;

	return html`
		<div class="overlay_container player_container">
			<!-- Hidden audio element -->
			<audio
				ref=${audioRef}
				preload="auto"
				onTimeUpdate=${onAudioTimeUpdate}
				onLoadedMetadata=${onAudioLoadedMetadata}
				onPlay=${onAudioPlay}
				onPause=${onAudioPause}
				onSeeked=${onAudioSeeked}
				onEnded=${onAudioEnded}
			></audio>

			<div class="overlay_header_row">
				<h1 class="title_tag">${title}</h1>
				<span class="mode_indicator_pill ${isLinked ? 'pill_linked' : 'pill_unlinked'}" title="${isLinked ? 'Linked to Global State' : 'Unlinked (Independent Player)'}">
					${isLinked ? '🔗' : '🔓'}
				</span>
			</div>

			<!-- Now Playing Display -->
			<div class="now_playing">
				<div class="track_name_display ${currentTrack ? 'has_track' : ''}">${trackName}</div>

				<!-- Seek bar + loop toggle -->
				<div class="seek_row">
					<div
						class="seek_bar ${scrubbing ? 'scrubbing' : ''}"
						ref=${seekBarRef}
						onPointerDown=${onSeekPointerDown}
						onPointerMove=${onSeekPointerMove}
						onPointerUp=${onSeekPointerUp}
					>
						<div class="seek_track">
							<div class="seek_fill" style="width: ${progressPct}%"></div>
						</div>
						<div class="seek_thumb" style="left: ${progressPct}%"></div>
					</div>
					<button
						class="loop_btn ${loop ? 'loop_active' : ''}"
						onClick=${toggleLoop}
						title="${loop ? 'Loop: ON' : 'Loop: OFF'}"
					>
						⟳
					</button>
				</div>
				<div class="time_row">
					<span class="time_current">${formatTime(displayTime)}</span>
					<span class="time_duration">${formatTime(duration)}</span>
				</div>

				<!-- Category tags (folder hierarchy in traversal order) -->
				<div class="tags_row">
					${tags.length > 0
						? tags.map((tag, i) => html`<span class="tag_chip" key=${i}>${tag}</span>`)
						: html`<span class="tag_chip tag_empty">UNCATEGORIZED</span>`}
				</div>

				<!-- Transport controls -->
				<div class="controls_row">
					<button
						class="ctrl_btn ctrl_play ${isPlaying ? 'is_playing' : ''}"
						onClick=${togglePlay}
						title="${isPlaying ? 'Pause' : 'Play'}"
					>
						${isPlaying ? '❚❚' : '▶'}
					</button>
					<button class="ctrl_btn ctrl_stop" onClick=${stop} title="Stop">■</button>
					<div class="volume_wrap">
						<span class="volume_icon">🔊</span>
						<input
							class="volume_slider"
							type="range"
							min="0"
							max="1"
							step="0.01"
							value=${volume}
							onInput=${(e: Event) => setVolume(parseFloat((e.target as HTMLInputElement).value))}
						/>
					</div>
				</div>
			</div>

			<!-- Credits from credits.json in the media root -->
			${media?.credits
				? html`
						<div class="credits_bar">
							${media.credits.Author ? html`<span class="credit_item"><b>AUTHOR:</b> ${media.credits.Author}</span>` : ''}
							${media.credits.Attribution ? html`<span class="credit_item"><b>ATTRIBUTION:</b> ${media.credits.Attribution}</span>` : ''}
							${media.credits.Source ? html`<span class="credit_item"><b>SOURCE:</b> ${media.credits.Source}</span>` : ''}
						</div>
					`
				: ''}

			<!-- Playlist tree -->
			<div class="playlist_panel">
				<div class="playlist_header">
					<span class="playlist_title">PLAYLIST_TREE</span>
					<span class="playlist_meta">
						${isScanning ? 'SCANNING...' : media ? `${totalTracks} TRACKS // ${baseName(mediaRoot || '')}` : 'NO SOURCE'}
					</span>
				</div>
				<div class="playlist_tree">
					${scanError
						? html`<div class="tree_empty tree_error">⚠ ${scanError}</div>`
						: !media
							? html`<div class="tree_empty">LOADING LIBRARY...</div>`
							: media.tree.length === 0
								? html`<div class="tree_empty">NO AUDIO FILES FOUND</div>`
								: media.tree.map(node => html`
										<${TreeItem}
											node=${node}
											depth=${0}
											expandedDirs=${expandedDirs}
											toggleDir=${toggleDir}
											currentTrack=${currentTrack}
											onPlayFile=${playFile}
										/>
									`)}
				</div>
			</div>

			<!-- The Bridge Toggle Button -->
			<div class="bridge_container">
				<button class="toggle_btn" onClick=${() => setIsExpanded(!isExpanded)}>
					${isExpanded ? '▲' : '▼'}
				</button>
			</div>

			<!-- Config Card (Collapsible) -->
			<div class="control_card ${isExpanded ? 'visible' : 'hidden'}">
				<h3>CONFIG_PANEL</h3>

				<!-- Shared Storage & Sync Control Section -->
				<div class="sync_section">
					<div class="sync_status_header">
						<span class="sync_status_dot ${isLinked ? 'dot_linked' : 'dot_unlinked'}"></span>
						<span class="sync_status_label">SYNC MODE:</span>
						<span class="sync_status_badge ${isLinked ? 'badge_linked' : 'badge_unlinked'}">
							${isLinked ? '🔗 LINKED (GLOBAL)' : '🔓 UNLINKED (INDEPENDENT)'}
						</span>
					</div>

					<p class="sync_description">
						${isLinked
							? 'Real-time sync active across all browsers (Edge, Chrome, Firefox) and network devices.'
							: 'Operating standalone. Edits stay isolated to this session.'}
					</p>

					<div class="sync_actions">
						${isLinked
							? html`
									<button class="sync_btn btn_unlink" onClick=${unlink}>
										🔓 Unlink (Fork Separate Player)
									</button>
								`
							: html`
									<button class="sync_btn btn_link_adopt" onClick=${linkAndAdoptGlobal} title="Overwrite this player with current global state">
										🔗 Link (Adopt Global)
									</button>
									<button class="sync_btn btn_link_push" onClick=${linkAndPushGlobal} title="Publish this player state to all other sessions">
										⬆ Link (Push to Global)
									</button>
								`}
					</div>
				</div>

				<!-- Media Source Section -->
				<div class="media_section">
					<div class="media_status_header">
						<span class="sync_status_label">MEDIA ROOT:</span>
						<span class="media_root_path" title="${mediaRoot || ''}">${mediaRoot || 'NOT SET'}</span>
					</div>

					<input
						class="media_path_input"
						type="text"
						placeholder="Or type an absolute folder path..."
						value="${browsePathInput}"
						onInput=${(e: Event) => setBrowsePathInput((e.target as HTMLInputElement).value)}
						onKeyDown=${(e: KeyboardEvent) => {
							if (e.key === 'Enter' && browsePathInput.trim()) {
								useFolder(browsePathInput.trim());
							}
						}}
					/>

					<div class="sync_actions">
						<button class="sync_btn btn_browse" onClick=${() => browse(browsePathInput || undefined)} disabled=${isBrowsing}>
							${isBrowsing ? 'LOADING...' : '📁 BROWSE FOLDERS'}
						</button>
						<button class="sync_btn btn_link_adopt" onClick=${() => scanFolder(mediaRoot ?? undefined)} disabled=${isScanning}>
							${isScanning ? 'SCANNING...' : '↻ RESCAN'}
						</button>
					</div>

					${browseData
						? html`
								<div class="browser_panel">
									<div class="browser_path">${browseData.path}</div>
									<div class="browser_actions">
										${browseData.parent
											? html`<button class="browser_btn" onClick=${() => browse(browseData.parent)}>⬆ PARENT</button>`
											: ''}
										<button class="browser_btn btn_use_folder" onClick=${() => useFolder(browseData.path)}>
											✓ USE THIS FOLDER
										</button>
									</div>
									<div class="browser_entries">
										${browseData.entries.length === 0
											? html`<div class="browser_empty">NO SUBFOLDERS</div>`
											: browseData.entries.map(entry => html`
													<div
														class="browser_entry"
														key=${entry.path}
														onClick=${() => browse(entry.path)}
													>
														<span class="browser_icon">📁</span>
														<span class="browser_name">${entry.name}</span>
													</div>
												`)}
									</div>
								</div>
							`
						: ''}
					${browseError ? html`<div class="tree_empty tree_error">⚠ ${browseError}</div>` : ''}
				</div>

				<div class="title_config_container">
					<label>Overlay Title:</label><br/>
					<input
						class="title_input"
						type="text"
						value="${title}"
						onInput=${(e: Event) => updateTitle((e.target as HTMLInputElement).value)}
					/>
				</div>
				<br/>
			</div>
		</div>
	`;
}

if (typeof window !== 'undefined') {
	const appEl = document.getElementById('app');
	if (appEl) {
		hydrate(<App />, appEl);
	}
}

export async function prerender(data: Record<string, unknown>) {
	return await ssr(<App {...data} />);
}
