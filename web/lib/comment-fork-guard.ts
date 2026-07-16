export interface CommentForkStarted {
  started: true;
  idempotencyKey: string;
}

export interface CommentForkSkipped {
  started: false;
}

export type CommentForkStartResult = CommentForkStarted | CommentForkSkipped;

export interface CommentForkGuard {
  start: (commentId: number) => CommentForkStartResult;
  finish: (commentId: number, result: { posted: boolean }) => void;
  forkingCommentIds: () => ReadonlySet<number>;
}

export function createCommentForkGuard(generateIdempotencyKey: () => string): CommentForkGuard {
  const inFlight = new Set<number>();
  const idempotencyKeys = new Map<number, string>();

  return {
    start(commentId) {
      if (inFlight.has(commentId)) return { started: false };

      const idempotencyKey = idempotencyKeys.get(commentId) ?? generateIdempotencyKey();
      idempotencyKeys.set(commentId, idempotencyKey);
      inFlight.add(commentId);

      return { started: true, idempotencyKey };
    },
    finish(commentId, result) {
      inFlight.delete(commentId);
      if (result.posted) idempotencyKeys.delete(commentId);
    },
    forkingCommentIds() {
      return new Set(inFlight);
    },
  };
}
