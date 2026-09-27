import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { test } from '@playwright/test';

const execFileAsync = promisify(execFile);
const routeProbe = fileURLToPath(
  new URL('../../deploy/preview/proxy/test-routes.sh', import.meta.url),
);

test('the preview proxy delivers account-confirmation routes to Laravel', async () => {
  // The probe runs the shipped Caddy image with isolated API/web marker
  // upstreams. It protects the root-level /email routes without changing the
  // BFF or the web confirmation screen's owner.
  await execFileAsync('bash', [routeProbe], { timeout: 120_000 });
});
