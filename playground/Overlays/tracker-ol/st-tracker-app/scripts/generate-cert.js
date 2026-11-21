import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const certsDir = path.resolve(__dirname, '../certs');

// 1. Gather all active local IPs
const nets = os.networkInterfaces();
const ipList = ['127.0.0.1'];
for (const name of Object.keys(nets)) {
	const entries = nets[name];
	if (!entries) continue;
	for (const net of entries) {
		if (net.family === 'IPv4' && !net.internal && !ipList.includes(net.address)) {
			ipList.push(net.address);
		}
	}
}

const sanEntries = ['DNS:localhost', ...ipList.map(ip => `IP:${ip}`), 'DNS:*.local'];
const sanString = sanEntries.join(',');

// 2. Locate OpenSSL binary
const opensslCandidates = [
	'openssl',
	'C:\\Program Files\\Git\\ucrt64\\bin\\openssl.exe',
	'C:\\Program Files\\Git\\usr\\bin\\openssl.exe',
];

let opensslBin = null;
for (const candidate of opensslCandidates) {
	try {
		execSync(`"${candidate}" version`, { stdio: 'ignore' });
		opensslBin = candidate;
		break;
	} catch {
		// continue searching
	}
}

if (!opensslBin) {
	console.error('Error: Could not locate OpenSSL to generate certificate.');
	process.exit(1);
}

// 3. Ensure certs directory exists
if (!fs.existsSync(certsDir)) {
	fs.mkdirSync(certsDir, { recursive: true });
}

const keyPath = path.join(certsDir, 'key.pem');
const certPath = path.join(certsDir, 'cert.pem');
const tempKey = path.join(os.tmpdir(), `tracker_key_${Date.now()}.pem`);
const tempCert = path.join(os.tmpdir(), `tracker_cert_${Date.now()}.pem`);

console.log('Generating self-signed certificate with SAN entries:');
console.log(sanString);

try {
	const cmd = `"${opensslBin}" req -x509 -newkey rsa:2048 -nodes -keyout "${tempKey}" -out "${tempCert}" -days 365 -subj "/CN=st-tracker-app" -addext "subjectAltName=${sanString}"`;
	execSync(cmd, { stdio: 'inherit' });

	fs.writeFileSync(keyPath, fs.readFileSync(tempKey));
	fs.writeFileSync(certPath, fs.readFileSync(tempCert));

	try {
		fs.unlinkSync(tempKey);
		fs.unlinkSync(tempCert);
	} catch {
		// ignore temp cleanup
	}

	console.log('\n✅ Certificates generated successfully in certs/ directory:');
	console.log(` - Key:  ${keyPath}`);
	console.log(` - Cert: ${certPath}`);
	console.log('\nYou can now access the tracker over HTTPS:');
	for (const ip of ipList) {
		console.log(` ➜  https://${ip}:5173/`);
	}
} catch (err) {
	console.error('Failed to generate certificates:', err);
	process.exit(1);
}
