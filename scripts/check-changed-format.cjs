const { execFileSync } = require('node:child_process');

function changedSourceFiles(base, head) {
  if (!/^[a-f0-9]{40}$/.test(head || '')) throw new Error('A full release commit is required');
  if (base && !/^[a-f0-9]{40}$/.test(base)) throw new Error('A full base commit is required');
  // A missing base commit is a failed gate, not an empty change list. Checkout
  // fetches history so pushes and pull requests both resolve their real base.
  const args =
    !base || /^0{40}$/.test(base) ? ['ls-files', '-z'] : ['diff', '--name-only', '--diff-filter=ACM', '-z', base, head];
  return execFileSync('git', args, { encoding: 'utf8' })
    .split('\0')
    .filter((file) => /\.(?:js|jsx|mjs|cjs|css|html)$/.test(file));
}

if (require.main === module) {
  try {
    const files = changedSourceFiles(process.argv[2], process.argv[3]);
    if (!files.length) console.log('No changed source files require a formatting check.');
    else
      execFileSync(process.execPath, ['node_modules/prettier/bin/prettier.cjs', '--check', ...files], {
        stdio: 'inherit',
      });
  } catch (error) {
    console.error('Changed-source formatting gate failed.');
    process.exitCode = Number.isInteger(error.status) && error.status > 0 ? error.status : 1;
  }
}
module.exports = { changedSourceFiles };
