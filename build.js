/* Zero-dependency build:
 *   src/ -> dist/     (for Joplin "Development plugins" loading)
 *   src/ -> publish/  (unpacked, then scripts/pack-jpl.js adds publish/plugin.jpl)
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const SRC = path.join(ROOT, 'src');

for (const target of ['dist', 'publish']) {
	const out = path.join(ROOT, target);
	fs.rmSync(out, { recursive: true, force: true });
	fs.mkdirSync(out, { recursive: true });
	for (const f of fs.readdirSync(SRC)) {
		fs.copyFileSync(path.join(SRC, f), path.join(out, f));
	}
	console.log(target + '/ built: ' + fs.readdirSync(out).join(', '));
}
