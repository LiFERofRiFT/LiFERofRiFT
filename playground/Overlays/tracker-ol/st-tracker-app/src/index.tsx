import { hydrate, prerender as ssr } from 'preact-iso';
import { useState } from 'preact/hooks';
import { html } from 'htm/preact';

import preactLogo from './assets/preact.svg';
import './style.css';

export function App() {
        const [title, setTitle] = useState("SYSTEM_STATUS");
        const [trackers, setTrackers] = useState([
            { id: 1, label: "CPU_LOAD", value: 45, max: 100 },
            { id: 2, label: "SYNC_RATE", value: 88, max: 100 },
            { id: 3, label: "MEM_POOL", value: 72, max: 128 }
        ]);

        const [isExpanded, setIsExpanded] = useState(false);

        const updateTracker = (id, field, val) => {
            setTrackers(prev => prev.map(t => t.id === id ? { ...t, [field]: (field === 'value' || field === 'max') ? Number(val) : val } : t));
        };

        const addTracker = () => {
            const newId = Date.now();
            setTrackers([...trackers, { id: newId, label: "NEW_LINK", value: 0, max: 100 }]);
        };

        const removeTracker = (id) => setTrackers(trackers.filter(t => t.id !== id));

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
                                    <span>${t.value}/${t.max}</span>
                                </div>
                                <div class="progress_container">
                                    <div class="progress_fill" style="width: ${pct}%"></div>
                                </div>
                            </div>`;
                    })}
                </div>

                <!-- The Bridge Toggle Button -->
                <div class="bridge_container">
                    <button class="toggle_btn" onClick=${() => setIsExpanded(!isExpanded)}>
                        ${isExpanded ? "▲" : "▼"}
                    </button>
                </div>

                <!-- Config Card (Collapsible) -->
                <div class="control_card ${isExpanded ? 'visible' : 'hidden'}">
                    <h3>CONFIG_PANEL</h3>
                    <div class="title_config_container">
                        <label>Main Title:</label><br/>
                        <input type="text" value="${title}" onInput=${(e) => setTitle(e.target.value)} style="width: 90%; margin-top:5px;"/>
                    </div>
                    <b/>

                    ${trackers.map(t => html`
                        <div class="input_group">
                            <input type="text" value="${t.label}" onInput=${(e) => updateTracker(t.id, 'label', e.target.value)}/>
                            <input type="number" value="${t.value}" onInput=${(e) => updateTracker(t.id, 'value', e.target.value)}/>
                            <button onClick=${() => removeTracker(t.id)}>X</button>
                        </div>
                    `)}

                    <button class="add_btn" onClick=${addTracker}>+ ADD NEW TRACKER</button>
                </div>
            </div>
        `;
    
}

function Resource(props) {
	return (
		<a href={props.href} target="_blank" class="resource">
			<h2>{props.title}</h2>
			<p>{props.description}</p>
		</a>
	);
}

if (typeof window !== 'undefined') {
	hydrate(<App />, document.getElementById('app'));
}

export async function prerender(data) {
	return await ssr(<App {...data} />);
}
