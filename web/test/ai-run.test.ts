import { describe, expect, it } from 'vitest';
import {
  AI_RUN_TAKING_TOO_LONG_MS,
  aiRunSettled,
  canRequestDigest,
  digestPhase,
  isAiRunInFlight,
} from '@/lib/ai-run';
import type { AiRun, AiRunStatus } from '@/lib/ai-types';

const CREATED_AT = '2026-08-18T10:00:00Z';
const CREATED_MS = Date.parse(CREATED_AT);

function run(status: AiRunStatus, overrides: Partial<AiRun> = {}): AiRun {
  return {
    id: 7,
    document_id: 3,
    type: 'digest',
    variant: null,
    status,
    model: 'claude-sonnet-5',
    tokens: 0,
    cost: 0,
    output: null,
    error: null,
    created_at: CREATED_AT,
    updated_at: CREATED_AT,
    ...overrides,
  };
}

describe('isAiRunInFlight', () => {
  it('treats pending and running as still on their way to an answer', () => {
    expect(isAiRunInFlight('pending')).toBe(true);
    expect(isAiRunInFlight('running')).toBe(true);
    expect(isAiRunInFlight('completed')).toBe(false);
    expect(isAiRunInFlight('failed')).toBe(false);
  });
});

describe('aiRunSettled', () => {
  it('keeps the poll loop alive while the run is in flight', () => {
    expect(aiRunSettled(run('pending'))).toBeNull();
    expect(aiRunSettled(run('running'))).toBeNull();
  });

  it('keeps the loop alive on a dropped read rather than settling', () => {
    expect(aiRunSettled(null)).toBeNull();
  });

  it('settles on either terminal status', () => {
    expect(aiRunSettled(run('completed'))?.status).toBe('completed');
    expect(aiRunSettled(run('failed'))?.status).toBe('failed');
  });
});

describe('digestPhase', () => {
  it('is idle before anything has been requested', () => {
    expect(digestPhase(null, CREATED_MS)).toBe('idle');
  });

  it('runs until the client ceiling, then reports taking-too-long', () => {
    expect(digestPhase(run('pending'), CREATED_MS)).toBe('running');
    expect(digestPhase(run('running'), CREATED_MS + AI_RUN_TAKING_TOO_LONG_MS - 1)).toBe('running');
    expect(digestPhase(run('running'), CREATED_MS + AI_RUN_TAKING_TOO_LONG_MS)).toBe('taking-too-long');
  });

  it('measures from the run itself, so re-attaching to an abandoned run says so at once', () => {
    const yesterday = run('running', { created_at: '2026-08-17T10:00:00Z' });

    expect(digestPhase(yesterday, CREATED_MS)).toBe('taking-too-long');
  });

  it('never overrides a terminal status with the ceiling', () => {
    const later = CREATED_MS + AI_RUN_TAKING_TOO_LONG_MS * 10;

    expect(digestPhase(run('completed'), later)).toBe('completed');
    expect(digestPhase(run('failed'), later)).toBe('failed');
  });

  it('does not report taking-too-long on an unparseable timestamp', () => {
    expect(digestPhase(run('running', { created_at: 'not a date' }), CREATED_MS)).toBe('running');
  });
});

describe('canRequestDigest', () => {
  it('offers generate or retry everywhere except a healthy in-flight run', () => {
    expect(canRequestDigest('idle')).toBe(true);
    expect(canRequestDigest('completed')).toBe(true);
    expect(canRequestDigest('failed')).toBe(true);
    expect(canRequestDigest('taking-too-long')).toBe(true);
    expect(canRequestDigest('running')).toBe(false);
  });
});
