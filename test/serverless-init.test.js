const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const root = path.join(__dirname, '..');

test('server module import succeeds when the Vercel filesystem rejects legacy JSON writes', () => {
    const script = [
        "const fs = require('node:fs');",
        "const path = require('node:path');",
        "const originalWriteFileSync = fs.writeFileSync;",
        "fs.writeFileSync = function (file, ...args) {",
        "  if (path.basename(String(file)) === 'linc_data.json') {",
        "    const error = new Error('read-only deployment filesystem');",
        "    error.code = 'EROFS';",
        "    throw error;",
        "  }",
        "  return originalWriteFileSync.call(this, file, ...args);",
        "};",
        "require('./server.js');",
        "process.stdout.write('SERVER_IMPORT_OK');"
    ].join('\n');

    const result = spawnSync(process.execPath, ['-e', script], {
        cwd: root,
        env: {
            ...process.env,
            VERCEL: '1',
            VERCEL_ENV: 'preview',
            SUPABASE_URL: '',
            SUPABASE_SERVICE_ROLE_KEY: ''
        },
        encoding: 'utf8',
        timeout: 10000
    });

    assert.equal(result.error, undefined, result.error && result.error.message);
    assert.equal(
        result.status,
        0,
        `server import failed under read-only filesystem simulation:\n${result.stderr}`
    );
    assert.match(result.stdout, /SERVER_IMPORT_OK/);
});
