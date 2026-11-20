import { defineConfig, type Plugin } from 'vite';
import preact from '@preact/preset-vite';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { IncomingMessage, ServerResponse } from 'node:http';

function trackerSyncPlugin(): Plugin {
	const dataFilePath = fileURLToPath(new URL('./tracker-data.json', import.meta.url));

	const defaultState = {
		title: 'Progression/Goals',
		trackers: [{ id: 1, label: 'Tracker 1', value: 45, max: 100 }],
	};

	function loadPersistedState() {
		try {
			if (fs.existsSync(dataFilePath)) {
				const raw = fs.readFileSync(dataFilePath, 'utf-8');
				const parsed = JSON.parse(raw);
				if (parsed && typeof parsed.title === 'string' && Array.isArray(parsed.trackers)) {
					return parsed;
				}
			}
		} catch {
			// fallback to default
		}
		return defaultState;
	}

	function persistState(state: unknown) {
		try {
			fs.writeFileSync(dataFilePath, JSON.stringify(state, null, 2), 'utf-8');
		} catch {
			// ignore storage error
		}
	}

	let currentState = loadPersistedState();
	const sseClients = new Set<ServerResponse>();

	function broadcastState(state: unknown, senderId?: string) {
		currentState = state;
		persistState(state);
		const payload = `data: ${JSON.stringify({ type: 'SYNC_UPDATE', senderId, state })}\n\n`;
		for (const client of sseClients) {
			try {
				client.write(payload);
			} catch {
				sseClients.delete(client);
			}
		}
	}

	const middleware = (req: IncomingMessage, res: ServerResponse, next: () => void) => {
		const rawUrl = req.url || '';
		const pathname = rawUrl.split('?')[0];

		if (pathname === '/api/tracker/events') {
			res.writeHead(200, {
				'Content-Type': 'text/event-stream',
				'Cache-Control': 'no-cache',
				'Connection': 'keep-alive',
				'Access-Control-Allow-Origin': '*',
			});
			res.write(`data: ${JSON.stringify({ type: 'INIT', state: currentState })}\n\n`);
			sseClients.add(res);

			req.on('close', () => {
				sseClients.delete(res);
			});
			return;
		}

		if (pathname === '/api/tracker') {
			res.setHeader('Access-Control-Allow-Origin', '*');
			res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

			if (req.method === 'OPTIONS') {
				res.writeHead(204);
				res.end();
				return;
			}

			if (req.method === 'GET') {
				res.writeHead(200, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify(currentState));
				return;
			}

			if (req.method === 'POST') {
				let body = '';
				req.on('data', chunk => {
					body += chunk;
				});
				req.on('end', () => {
					try {
						const data = JSON.parse(body);
						if (data && data.state) {
							broadcastState(data.state, data.senderId);
							res.writeHead(200, { 'Content-Type': 'application/json' });
							res.end(JSON.stringify({ ok: true }));
							return;
						}
					} catch {
						// bad json
					}
					res.writeHead(400, { 'Content-Type': 'application/json' });
					res.end(JSON.stringify({ error: 'Invalid state payload' }));
				});
				return;
			}
		}

		next();
	};

	return {
		name: 'tracker-sync-plugin',
		configureServer(server) {
			server.middlewares.use(middleware);
		},
		configurePreviewServer(server) {
			server.middlewares.use(middleware);
		},
	};
}

// https://vitejs.dev/config/
export default defineConfig({
	server: {
		host: '0.0.0.0',
		port: 5173,
	},
	preview: {
		host: '0.0.0.0',
		port: 5173,
	},
	plugins: [
		preact({
			prerender: {
				enabled: true,
				renderTarget: '#app',
			},
		}),
		trackerSyncPlugin(),
	],
});
