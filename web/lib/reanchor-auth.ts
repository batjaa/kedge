import { isAuthorized, projectionSecret, PROJECTION_SECRET_HEADER } from './projection-auth';

export const REANCHOR_SECRET_HEADER = PROJECTION_SECRET_HEADER;

export function reanchorSecret(
  env: Record<string, string | undefined> = process.env,
): string | null {
  const configured = env.REANCHOR_SHARED_SECRET;
  if (configured && configured.length > 0) return configured;

  return projectionSecret(env);
}

export function isReanchorAuthorized(
  provided: string | null | undefined,
  env: Record<string, string | undefined> = process.env,
): boolean {
  const secret = reanchorSecret(env);
  if (secret === null) return false;

  return isAuthorized(provided, {
    ...env,
    PROJECTION_SHARED_SECRET: secret,
  });
}
