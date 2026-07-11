// Thin wrapper so the preview launcher never has to pass a
// space-containing argument (e.g. "LANDING PAGE") through its own spawn —
// that combination breaks on this Windows setup when the resolved
// executable path also contains a space (C:\Program Files\...). Node's
// child_process here handles the argv array correctly either way.
const { spawn } = require('child_process');
const path = require('path');

const cwd = path.join(__dirname, '..', 'LANDING PAGE');
const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';

// Windows .cmd shims (npm.cmd) must go through a shell — spawning them
// directly throws EINVAL.
const child = spawn(npmCmd, ['run', 'dev'], { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
child.on('exit', (code) => process.exit(code ?? 0));
