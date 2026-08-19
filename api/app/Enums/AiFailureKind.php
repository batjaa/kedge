<?php

namespace App\Enums;

/**
 * The M1 deterministic/transient failure split (SPEC §19 failure registry, m4
 * eng review §5 — the #55 bug class), applied to AI generation.
 *
 * `transient` — provider overload, rate limiting, a 5xx, a connection timeout:
 * retrying with backoff is likely to work, so the job retries and only lands
 * `failed` once its attempts are spent.
 *
 * `deterministic` — an invalid or removed key, a content-policy refusal,
 * structured output that still won't parse after the SDK's own retry, an
 * exhausted quota: retrying burns the queue for the same answer, so the run
 * fails immediately with no retries.
 *
 * The kind rides on `ai_run.failed` so the alertable half (transient spikes =
 * provider trouble) is separable from the operator half (deterministic = the
 * key or the prompt is wrong).
 */
enum AiFailureKind: string
{
    case Deterministic = 'deterministic';
    case Transient = 'transient';
}
