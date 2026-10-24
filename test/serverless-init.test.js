const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const root = path.join(__dirname, '..');

test('server health works and readiness fails closed when Vercel filesystem is read-only', () => {
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
        "const app = require('./server.js');",
        "const server = app.listen(0, async () => {",
        "  try {",
        "    const base = 'http://127.0.0.1:' + server.address().port;",
        "    const health = await fetch(base + '/health');",
        "    if (health.status !== 200) throw new Error('/health returned ' + health.status);",
        "    const healthBody = await health.json();",
        "    if (healthBody.status !== 'operational') throw new Error('/health body was unexpected');",
        "    const ready = await fetch(base + '/ready');",
        "    if (ready.status !== 503) throw new Error('/ready returned ' + ready.status);",
        "    const readyBody = await ready.json();",
        "    if (readyBody.reason !== 'database_not_configured') throw new Error('/ready reason was unexpected');",
        "    process.stdout.write(JSON.stringify({health: 200, readiness: 503, reason: readyBody.reason}));",
        "  } catch (error) {",
        "    console.error(error && error.stack ? error.stack : String(error));",
        "    process.exitCode = 1;",
        "  } finally {",
        "    server.close();",
        "  }",
        "});"
    ].join('\n');

    const result = spawnSync(process.execPath, ['-e', script], {
        cwd: root,
        env: {
            ...process.env,
            VERCEL: '1',
            VERCEL_ENV: 'preview',
            SUPABASE_URL: '',
            SUPABASE_SERVICE_ROLE_KEY: '',
            LINC_API_KEY: ''
        },
        encoding: 'utf8',
        timeout: 10000
    });

    assert.equal(result.error, undefined, result.error && result.error.message);
    assert.equal(
        result.status,
        0,
        `read-only filesystem smoke failed:\n${result.stderr}\n${result.stdout}`
    );
    assert.match(result.stdout, /"health":200/);
    assert.match(result.stdout, /"readiness":503/);
    assert.match(result.stdout, /"reason":"database_not_configured"/);
});
