import { hydrate, prerender as ssr } from 'preact-iso';
import { useState, useEffect, useLayoutEffect, useRef } from 'preact/hooks';
import { html } from 'htm/preact';

import './style.css';

export interface Tracker {
	id: number;
	label: string;
	value: number;
	max: number;
	failed?: boolean;
}

export interface TrackerState {
	title: string;
	trackers: Tracker[];
}

const GLOBAL_STORAGE_KEY = 'overlay_tracker_global_v1';
const SESSION_LINKED_KEY = 'overlay_tracker_is_linked';
const SESSION_DATA_KEY = 'overlay_tracker_session_v1';
const BROADCAST_CHANNEL_NAME = 'overlay_tracker_sync_channel';

const DEFAULT_STATE: TrackerState = {
	title: 'Progression/Goals',
	trackers: [
		{ id: 1, label: 'Tracker 1', value: 45, max: 100, failed: false },
	],
};

function generateSessionId(): string {
	if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
		return crypto.randomUUID();
	}
	return `sess_${Math.random().toString(36).substring(2, 9)}`;
}

const TAB_SESSION_ID = generateSessionId();

function createNewTrackerId(): number {
	return Date.now();
}

const CARD_RESIZE_DURATION_MS = 420;
const CARD_RESIZE_EASING = 'cubic-bezier(0.22, 0.8, 0.24, 1)';

function getAnimatedWidth(element: HTMLElement) {
	const rect = element.getBoundingClientRect();
	const style = getComputedStyle(element);
	if (style.boxSizing === 'border-box') return rect.width;

	const borderX =
		parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth);
	const paddingX = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);

	return Math.max(
		0,
		rect.width - borderX - (style.boxSizing === 'padding-box' ? 0 : paddingX),
	);
}

function useAnimatedCardWidth<T extends HTMLElement>() {
	const elementRef = useRef<T | null>(null);
	const targetWidthRef = useRef<number | null>(null);
	const animationRef = useRef<Animation | null>(null);

	useLayoutEffect(() => {
		const element = elementRef.current;
		if (!element || typeof element.animate !== 'function') return;

		const visualWidth = getAnimatedWidth(element);
		const activeAnimation = animationRef.current;
		const isAnimating =
			activeAnimation?.playState === 'running' ||
			activeAnimation?.playState === 'pending';
		const currentTime =
			typeof activeAnimation?.currentTime === 'number'
				? activeAnimation.currentTime
				: 0;

		activeAnimation?.cancel();
		const targetWidth = getAnimatedWidth(element);

		const previousWidth = targetWidthRef.current;
		targetWidthRef.current = targetWidth;
		if (previousWidth === null) return;

		const from = isAnimating ? visualWidth : previousWidth;
		const targetChanged = Math.abs(targetWidth - previousWidth) > 0.5;
		const visualChanged = Math.abs(targetWidth - from) > 0.5;

		if (!visualChanged) return;
		if (!targetChanged && !isAnimating) return;

		animationRef.current = element.animate(
			[
				{ width: `${from}px` },
				{ width: `${targetWidth}px` },
			],
			{
				duration: targetChanged
					? CARD_RESIZE_DURATION_MS
					: Math.max(80, CARD_RESIZE_DURATION_MS - currentTime),
				easing: CARD_RESIZE_EASING,
			},
		);
	});

	useEffect(() => () => animationRef.current?.cancel(), []);

	return elementRef;
}

function getStoredGlobalState(): TrackerState {
	if (typeof window === 'undefined') return DEFAULT_STATE;
	try {
		const raw = localStorage.getItem(GLOBAL_STORAGE_KEY);
		if (raw) {
			const parsed = JSON.parse(raw);
			if (parsed && typeof parsed.title === 'string' && Array.isArray(parsed.trackers)) {
				return parsed;
			}
		}
	} catch {
		// fallback to default
	}
	return DEFAULT_STATE;
}

function getStoredSessionState(): TrackerState | null {
	if (typeof window === 'undefined') return null;
	try {
		const raw = sessionStorage.getItem(SESSION_DATA_KEY);
		if (raw) {
			const parsed = JSON.parse(raw);
			if (parsed && typeof parsed.title === 'string' && Array.isArray(parsed.trackers)) {
				return parsed;
			}
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

export function App() {
	// Initialize link status and state safely for SSR and client
	const [isLinked, setIsLinked] = useState<boolean>(getStoredLinkStatus);
	const [trackerState, setTrackerState] = useState<TrackerState>(() => {
		const initiallyLinked = getStoredLinkStatus();
		if (!initiallyLinked) {
			const local = getStoredSessionState();
			if (local) return local;
		}
		return getStoredGlobalState();
	});

	const [isExpanded, setIsExpanded] = useState(false);
	const overlayRef = useAnimatedCardWidth<HTMLDivElement>();
	const controlCardRef = useAnimatedCardWidth<HTMLDivElement>();

	const isLinkedRef = useRef(isLinked);
	const trackerStateRef = useRef(trackerState);

	useEffect(() => {
		isLinkedRef.current = isLinked;
		trackerStateRef.current = trackerState;
	}, [isLinked, trackerState]);

	const { title, trackers } = trackerState;

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
				eventSource = new EventSource('/api/tracker/events');
				eventSource.onmessage = (event: MessageEvent) => {
					try {
						const data = JSON.parse(event.data);
						if (!data || data.senderId === TAB_SESSION_ID) return;

						if ((data.type === 'SYNC_UPDATE' || data.type === 'INIT') && data.state) {
							if (isLinkedRef.current) {
								setTrackerState(data.state);
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

				if (data.type === 'SYNC_UPDATE') {
					if (isLinkedRef.current && data.state) {
						setTrackerState(data.state);
					}
				} else if (data.type === 'REQUEST_GLOBAL_STATE') {
					if (isLinkedRef.current && channel) {
						channel.postMessage({
							type: 'PROVIDE_GLOBAL_STATE',
							targetId: data.senderId,
							senderId: TAB_SESSION_ID,
							state: trackerStateRef.current,
						});
					}
				} else if (data.type === 'PROVIDE_GLOBAL_STATE') {
					if (isLinkedRef.current && data.targetId === TAB_SESSION_ID && data.state) {
						setTrackerState(data.state);
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
					if (parsed && typeof parsed.title === 'string' && Array.isArray(parsed.trackers)) {
						setTrackerState(parsed);
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
	const broadcastState = (newState: TrackerState) => {
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
			fetch('/api/tracker', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ state: newState, senderId: TAB_SESSION_ID }),
			}).catch(() => {
				// Server may be offline or standalone; silently continue with local storage
			});
		}
	};

	// Save changes depending on link state
	const commitState = (updater: (prev: TrackerState) => TrackerState) => {
		setTrackerState(prev => {
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

	// State modification handlers
	const updateTitle = (newTitle: string) => {
		commitState(prev => ({ ...prev, title: newTitle }));
	};

	const updateTracker = (id: number, field: keyof Tracker, val: string) => {
		commitState(prev => ({
			...prev,
			trackers: prev.trackers.map(t =>
				t.id === id
					? {
							...t,
							[field]:
								field === 'value' || field === 'max'
									? Number(val)
									: val,
						}
					: t,
			),
		}));
	};

	const addTracker = () => {
		const newId = createNewTrackerId();
		commitState(prev => ({
			...prev,
			trackers: [
				...prev.trackers,
				{
					id: newId,
					label: `Tracker ${(prev.trackers?.length ?? 0) + 1}`,
					value: 0,
					max: 100,
				},
			],
		}));
	};

	const removeTracker = (id: number) => {
		commitState(prev => ({
			...prev,
			trackers: prev.trackers.filter(t => t.id !== id),
		}));
	};

	// Unlink session from global state
	const unlink = () => {
		setIsLinked(false);
		try {
			sessionStorage.setItem(SESSION_LINKED_KEY, 'false');
			sessionStorage.setItem(SESSION_DATA_KEY, JSON.stringify(trackerState));
		} catch {
			// ignore storage error
		}
	};

	// Relink session by adopting the current global state
	const linkAndAdoptGlobal = () => {
		const applyState = (state: TrackerState) => {
			setTrackerState(state);
			try {
				localStorage.setItem(GLOBAL_STORAGE_KEY, JSON.stringify(state));
			} catch {
				// ignore storage error
			}
		};

		if (typeof fetch !== 'undefined') {
			fetch('/api/tracker')
				.then(res => res.json())
				.then(data => {
					if (data && typeof data.title === 'string' && Array.isArray(data.trackers)) {
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

	// Relink session by overwriting global state with local tracker
	const linkAndPushGlobal = () => {
		setIsLinked(true);
		broadcastState(trackerState);
		try {
			sessionStorage.setItem(SESSION_LINKED_KEY, 'true');
			sessionStorage.removeItem(SESSION_DATA_KEY);
		} catch {
			// ignore storage error
		}
	};

	// toggle for tracker failure
	const toggleTrackerFailed = (id: number) => {
			commitState(prev => ({
					...prev,
					trackers: prev.trackers.map(t =>
							t.id === id ? { ...t, failed: !t.failed } : t
					),
			}));
	};

	const isInvalid = (t: Tracker) => t.value > t.max;

	return html`
		<div class="overlay_container" ref=${overlayRef}>
			<div class="overlay_header_row">
				<h1 class="title_tag">${title}</h1>
				<span class="mode_indicator_pill ${isLinked ? 'pill_linked' : 'pill_unlinked'}" title="${isLinked ? 'Linked to Global State' : 'Unlinked (Independent Tracker)'}">
					${isLinked ? '🔗 GLOBAL' : '🔓 LOCAL'}
				</span>
			</div>

			<div class="tracker_list">
				${trackers.map(t => {
					const pct = Math.min((t.value / t.max) * 100, 100);
					const isFailed = Boolean(t.failed);
					return html`
						<div class="tracker_item ${isFailed? 'tracker_failed' : ''}" key=${t.id}>
							<div class="tracker_header">
								<div class="tracker_label_wrap">
									<span class="tracker_label">${t.label}</span>
								${isFailed ? html`<span class="fail_status_badge">FAILED //</span?`:''}
								</div>
								<span class="tracker_value_text">${t.value}/${t.max}</span>
							</div>

							<div class="progress_container ${isFailed? 'progress_failed': ''}">
								<div class="progress_fill ${isFailed ? "fill_failed": ''}" style="width: ${pct}%"></div>
							</div>
						</div>
					`;
				})}
			</div>

			<!-- The Bridge Toggle Button -->
			<div class="bridge_container">
				<button class="toggle_btn" onClick=${() => setIsExpanded(!isExpanded)}>
					${isExpanded ? '▲' : '▼'}
				</button>
			</div>

			<!-- Config Card (Collapsible) -->
			<div class="control_card ${isExpanded ? 'visible' : 'hidden'}" ref=${controlCardRef}>
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
										🔓 Unlink (Fork Separate Tracker)
									</button>
								`
							: html`
									<button class="sync_btn btn_link_adopt" onClick=${linkAndAdoptGlobal} title="Overwrite this tracker with current global data">
										🔗 Link (Adopt Global)
									</button>
									<button class="sync_btn btn_link_push" onClick=${linkAndPushGlobal} title="Publish this tracker data to all other sessions">
										⬆ Link (Push to Global)
									</button>
								`}
					</div>
				</div>

				<div class="title_config_container">
					<label>Main Title:</label><br/>
					<input
						class="title_input"
						type="text"
						value="${title}"
						onInput=${(e: Event) => updateTitle((e.target as HTMLInputElement).value)}
					/>
				</div>
				<br/>

				${trackers.map(t => {
					const invalid = isInvalid(t);
					return html`
						<div class="input_group" key=${t.id}>
							<input
								class="tracker_label_input"
								type="text"
								value="${t.label}"
								onInput=${(e: Event) => updateTracker(t.id, 'label', (e.target as HTMLInputElement).value)}
							/>
							<div class="val_field_wrap ${invalid ? 'has_error' : ''}">
								<input
									class="val_input ${invalid ? 'input_error' : ''}"
									type="number"
									value="${t.value}"
									onInput=${(e: Event) => updateTracker(t.id, 'value', (e.target as HTMLInputElement).value)}
								/>
								${invalid
									? html`
											<div class="warn_icon" title="Value exceeds max! (${t.value} > ${t.max})">
												<span class="warn_triangle"><span class="warn_triangle_text">!</span></span>
												<div class="warn_tooltip">⚠ value (${t.value}) exceeds max (${t.max})</div>
											</div>
										`
									: ''}
							</div>
							<div class="val_field_wrap ${invalid ? 'has_error' : ''}">
								<input
									class="val_input ${invalid ? 'input_error' : ''}"
									type="number"
									value="${t.max}"
									onInput=${(e: Event) => updateTracker(t.id, 'max', (e.target as HTMLInputElement).value)}
								/>
								${invalid
									? html`
											<div class="warn_icon" title="Max is below current value! (${t.max} < ${t.value})">
												<span class="warn_triangle"><span class="warn_triangle_text">!</span></span>
												<div class="warn_tooltip">⚠ max (${t.max}) is below value (${t.value})</div>
											</div>
										`
									: ''}
							</div>
							<button
									type="button"
									class="fail_toggle_btn ${t.failed ? 'btn_is_failed' : ''}"
									onClick=${() => toggleTrackerFailed(t.id)}
									title="${t.failed ? 'Click to mark as Active' : 'Click to mark as Failed'}"
							>
									${t.failed ? '☠ FAIL' : '✓ OK'}
							</button>
							<button onClick=${() => removeTracker(t.id)}>X</button>
						</div>
					`;
				})}

				<button class="add_btn" onClick=${addTracker}>+ ADD NEW TRACKER</button>
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

