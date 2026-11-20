import { hydrate, prerender as ssr } from 'preact-iso';
import { useState } from 'preact/hooks';
import { html } from 'htm/preact';

import './style.css';

interface Tracker {
	id: number;
	label: string;
	value: number;
	max: number;
}

export function App() {
	const [title, setTitle] = useState('Header');
	const [trackers, setTrackers] = useState<Tracker[]>([
		{ id: 1, label: 'Tracker 1', value: 45, max: 100 },
		{ id: 2, label: 'Tracker 2', value: 88, max: 100 },
		{ id: 3, label: 'Tracker 3', value: 72, max: 128 },
	]);

	const [isExpanded, setIsExpanded] = useState(false);

	const updateTracker = (id: number, field: keyof Tracker, val: string) => {
		setTrackers(prev =>
			prev.map(t =>
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
		);
	};

	const isInvalid = (t: Tracker) => t.value > t.max;

	const addTracker = () => {
		const newId = Date.now();
		setTrackers([
			...trackers,
			{
				id: newId,
				label: `Tracker ${(trackers?.length ?? 0) + 1}`,
				value: 0,
				max: 100,
			},
		]);
	};

	const removeTracker = (id: number) =>
		setTrackers(trackers.filter(t => t.id !== id));

	return html`
		<div class="overlay_container">
			<h1 class="title_tag">${title}</h1>
			<div class="tracker_list">
				${trackers.map(t => {
					const pct = Math.min((t.value / t.max) * 100, 100);
					return html`
						<div class="tracker_item">
							<div class="tracker_header">
								<span class="tracker_label">${t.label}</span>
								<span class="tracker_value_text">${t.value}/${t.max}</span>
							</div>
							<div class="progress_container">
								<div class="progress_fill" style="width: ${pct}%"></div>
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
			<div class="control_card ${isExpanded ? 'visible' : 'hidden'}">
				<h3>CONFIG_PANEL</h3>
				<div class="title_config_container">
					<label>Main Title:</label><br/>
					<input
						type="text"
						value="${title}"
						onInput=${(e: Event) => setTitle((e.target as HTMLInputElement).value)}
						style="width: 90%; margin-top:5px;"
					/>
				</div>
				<br/>

				${trackers.map(t => {
					const invalid = isInvalid(t);
					return html`
						<div class="input_group">
							<input
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
	hydrate(<App />, document.getElementById('app'));
}

export async function prerender(data: Record<string, unknown>) {
	return await ssr(<App {...data} />);
}
