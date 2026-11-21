import { defineConfig, type Plugin } from 'vite';
import preact from '@preact/preset-vite';
import fs from 'node:fs';
import https from 'node:https';
import { fileURLToPath } from 'node:url';
import type { IncomingMessage, ServerResponse } from 'node:http';

const certPath = fileURLToPath(new URL('./certs/cert.pem', import.meta.url));
const keyPath = fileURLToPath(new URL('./certs/key.pem', import.meta.url));

const httpsConfig =
	fs.existsSync(certPath) && fs.existsSync(keyPath)
		? {
				cert: fs.readFileSync(certPath),
				key: fs.readFileSync(keyPath),
			}
		: null;

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

			// Companion HTTPS server on port 5174 for network/vEthernet while keeping port 5173 plain HTTP for local overlays
			if (httpsConfig) {
				const httpsServer = https.createServer(httpsConfig, (req, res) => {
					server.middlewares(req, res);
				});

				httpsServer.on('upgrade', (req, socket, head) => {
					server.httpServer?.emit('upgrade', req, socket, head);
				});

				const HTTPS_PORT = 5174;
				httpsServer.listen(HTTPS_PORT, '0.0.0.0', () => {
					// eslint-disable-next-line no-console
					console.log(`\n  🔓 HTTP  (Local Overlay):     http://localhost:5173/`);
					// eslint-disable-next-line no-console
					console.log(`  🔒 HTTPS (Network / Wi-Fi):   https://192.168.1.4:${HTTPS_PORT}/`);
					// eslint-disable-next-line no-console
					console.log(`  🔒 HTTPS (vEthernet Hyper-V): https://172.27.48.1:${HTTPS_PORT}/\n`);
				});

				server.httpServer?.on('close', () => {
					httpsServer.close();
				});
			}
		},
		configurePreviewServer(server) {
			server.middlewares.use(middleware);

			if (httpsConfig) {
				const httpsServer = https.createServer(httpsConfig, (req, res) => {
					server.middlewares(req, res);
				});

				httpsServer.on('upgrade', (req, socket, head) => {
					server.httpServer?.emit('upgrade', req, socket, head);
				});

				const HTTPS_PORT = 5174;
				httpsServer.listen(HTTPS_PORT, '0.0.0.0', () => {
					// eslint-disable-next-line no-console
					console.log(`\n  🔓 HTTP  (Local Preview):     http://localhost:5173/`);
					// eslint-disable-next-line no-console
					console.log(`  🔒 HTTPS (Network Preview):    https://192.168.1.4:${HTTPS_PORT}/\n`);
				});

				server.httpServer?.on('close', () => {
					httpsServer.close();
				});
			}
		},
	};
}

// https://vitejs.dev/config/
export default defineConfig({
	server: {
		host: '0.0.0.0',
		port: 5173,
		// Primary server remains plain HTTP so local OBS / desktop overlays on localhost work without certificate blocks
		https: undefined,
	},
	preview: {
		host: '0.0.0.0',
		port: 5173,
		https: undefined,
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
