import { defineConfig, type Plugin } from 'vite';
import preact from '@preact/preset-vite';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
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

const AUDIO_EXTENSIONS = new Set([
	'.mp3', '.wav', '.ogg', '.oga', '.flac', '.m4a', '.aac', '.opus', '.webm', '.wma',
]);

const MIME_TYPES: Record<string, string> = {
	'.mp3': 'audio/mpeg',
	'.wav': 'audio/wav',
	'.ogg': 'audio/ogg',
	'.oga': 'audio/ogg',
	'.flac': 'audio/flac',
	'.m4a': 'audio/mp4',
	'.aac': 'audio/aac',
	'.opus': 'audio/ogg',
	'.webm': 'audio/webm',
	'.wma': 'audio/x-ms-wma',
};

const MAX_SCAN_DEPTH = 4;

interface TreeNode {
	name: string;
	path: string;
	type: 'dir' | 'file';
	children?: TreeNode[];
}

function isAudioFile(name: string) {
	return AUDIO_EXTENSIONS.has(path.extname(name).toLowerCase());
}

function defaultMediaRoot() {
	if (process.env.MEDIA_ROOT) return process.env.MEDIA_ROOT;
	const musicDir = path.join(os.homedir(), 'Music');
	if (fs.existsSync(musicDir)) return musicDir;
	return fileURLToPath(new URL('./music', import.meta.url));
}

function readJsonFile(filePath: string) {
	try {
		return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
	} catch {
		return null;
	}
}

function scanDirectory(dirPath: string, depth: number): TreeNode[] {
	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(dirPath, { withFileTypes: true });
	} catch {
		return [];
	}

	const dirs = entries
		.filter(e => e.isDirectory() && !e.name.startsWith('.'))
		.map(e => path.join(dirPath, e.name))
		.sort((a, b) => path.basename(a).localeCompare(path.basename(b)));

	const files = entries
		.filter(e => e.isFile() && isAudioFile(e.name))
		.map(e => path.join(dirPath, e.name))
		.sort((a, b) => path.basename(a).localeCompare(path.basename(b)));

	const nodes: TreeNode[] = [];

	for (const dir of dirs) {
		const node: TreeNode = {
			name: path.basename(dir),
			path: dir,
			type: 'dir',
		};
		if (depth < MAX_SCAN_DEPTH) {
			node.children = scanDirectory(dir, depth + 1);
		}
		nodes.push(node);
	}

	for (const file of files) {
		nodes.push({ name: path.basename(file), path: file, type: 'file' });
	}

	return nodes;
}

function sendJson(res: ServerResponse, status: number, data: unknown) {
	res.writeHead(status, { 'Content-Type': 'application/json' });
	res.end(JSON.stringify(data));
}

function playerPlugin(): Plugin {
	const dataFilePath = fileURLToPath(new URL('./player-data.json', import.meta.url));

	const defaultState = {
		title: 'AUDIO_PLAYER',
		rootPath: null,
		currentTrack: null,
		isPlaying: false,
		volume: 0.8,
		loop: false,
		currentTime: 0,
		duration: 0,
	};

	function loadPersistedState() {
		try {
			if (fs.existsSync(dataFilePath)) {
				const raw = fs.readFileSync(dataFilePath, 'utf-8');
				const parsed = JSON.parse(raw);
				if (parsed && typeof parsed === 'object') return parsed;
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
		const [pathname, queryString] = rawUrl.split('?');
		const query = new URLSearchParams(queryString || '');

		// ── Global synced player state (mirrors tracker app) ──
		if (pathname === '/api/player/events') {
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

		if (pathname === '/api/player') {
			res.setHeader('Access-Control-Allow-Origin', '*');
			res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

			if (req.method === 'OPTIONS') {
				res.writeHead(204);
				res.end();
				return;
			}

			if (req.method === 'GET') {
				sendJson(res, 200, currentState);
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
							sendJson(res, 200, { ok: true });
							return;
						}
					} catch {
						// bad json
					}
					sendJson(res, 400, { error: 'Invalid state payload' });
				});
				return;
			}
		}

		// ── Folder scan: builds the playlist tree + credits.json ──
		if (pathname === '/api/player/scan') {
			const root = query.get('path') || defaultMediaRoot();
			try {
				const stat = fs.statSync(root);
				if (!stat.isDirectory()) {
					sendJson(res, 400, { error: 'Path is not a directory' });
					return;
				}
			} catch {
				sendJson(res, 400, { error: `Cannot access directory: ${root}` });
				return;
			}

			const credits = readJsonFile(path.join(root, 'credits.json'));
			const tree = scanDirectory(root, 0);
			sendJson(res, 200, {
				root,
				credits,
				tree,
			});
			return;
		}

		// ── Directory browser for picking the main media folder ──
		if (pathname === '/api/player/browse') {
			const dir = query.get('path') || defaultMediaRoot();
			let resolved = dir;
			try {
				resolved = fs.realpathSync(dir);
			} catch {
				sendJson(res, 400, { error: `Cannot access directory: ${dir}` });
				return;
			}

			let dirents: fs.Dirent[];
			try {
				dirents = fs.readdirSync(resolved, { withFileTypes: true });
			} catch {
				sendJson(res, 400, { error: `Cannot read directory: ${resolved}` });
				return;
			}

			const entries = dirents
				.filter(e => e.isDirectory() && !e.name.startsWith('.'))
				.map(e => ({
					name: e.name,
					path: path.join(resolved, e.name),
					type: 'dir' as const,
				}))
				.sort((a, b) => a.name.localeCompare(b.name));

			const parent = path.dirname(resolved);
			sendJson(res, 200, {
				path: resolved,
				parent: parent !== resolved ? parent : null,
				entries,
			});
			return;
		}

		// ── Audio file streaming with Range support for seeking ──
		if (pathname === '/api/player/file') {
			const filePath = query.get('path') || '';
			try {
				const stat = fs.statSync(filePath);
				if (!stat.isFile() || !isAudioFile(filePath)) {
					sendJson(res, 400, { error: 'Not a supported audio file' });
					return;
				}

				const ext = path.extname(filePath).toLowerCase();
				const total = stat.size;
				const range = req.headers.range;

				res.setHeader('Accept-Ranges', 'bytes');
				res.setHeader('Content-Type', MIME_TYPES[ext] || 'application/octet-stream');

				if (range) {
					const match = /bytes=(\d*)-(\d*)/.exec(range);
					let start = match && match[1] ? parseInt(match[1], 10) : 0;
					let end = match && match[2] ? parseInt(match[2], 10) : total - 1;
					if (Number.isNaN(start)) start = Math.max(0, total - end);
					if (Number.isNaN(end) || end >= total) end = total - 1;
					if (start > end || start >= total) {
						res.writeHead(416, { 'Content-Range': `bytes */${total}` });
						res.end();
						return;
					}
					res.writeHead(206, {
						'Content-Range': `bytes ${start}-${end}/${total}`,
						'Content-Length': end - start + 1,
					});
					fs.createReadStream(filePath, { start, end }).pipe(res);
				} else {
					res.writeHead(200, {
						'Content-Length': total,
					});
					fs.createReadStream(filePath).pipe(res);
				}
			} catch {
				sendJson(res, 404, { error: 'File not found' });
			}
			return;
		}

		next();
	};

	return {
		name: 'audio-player-plugin',
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
		playerPlugin(),
	],
});
