'use client';

import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckCircle2,
  MessageSquare,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  RefreshCw,
  XCircle,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import { AiAskAction, type AskRequest } from './ai-ask-action';
import { AiDigestAction } from './ai-digest-action';
import { AiImprovePromptAction } from './ai-improve-prompt-action';
import { DocumentCommentComposer, type ComposerState } from './document-comment-composer';
import {
  DocumentNewVersionBanner,
  newerVersionNoticeFromDocument,
  newerVersionNoticeFromVersion,
  type NewerVersionNotice,
} from './document-new-version-banner';
import { DocumentReviewHeader } from './document-review-header';
import { DocumentReviewSidebar } from './document-review-sidebar';
import { DocumentThreadRail, type ReattachStatus } from './document-thread-rail';
import { DocumentVersionSwitcher } from './document-version-switcher';
import { MobileThreadSheet } from './mobile-thread-sheet';
import { askQuoteFromSelector } from '@/lib/ai-ask';
import { captureAnchorFromSelection } from '@/lib/anchor-capture-dom';
import { commentComposerSubmitState } from '@/lib/comment-composer';
import { postDocumentComposerDraft } from '@/lib/comment-composer-actions';
import { createCommentForkGuard, type CommentForkGuard } from '@/lib/comment-fork-guard';
import {
  createSuggestionThread,
  createThread,
  deleteComment,
  editComment,
  forkComment,
  listThreads,
  reanchorThread,
  replyToThread,
  toggleCommentReaction,
  updateSuggestionStatus,
  updateThreadStatus,
  type ReplyToThreadInput,
} from '@/lib/comments-client';
import { readDocument, resyncDocument, updateDocumentLifecycle } from '@/lib/documents-client';
import {
  refreshSurfaceAfterResync,
  waitForResyncCompletion,
} from '@/lib/resync-polling';
import { UpdateContentAction } from './update-content-action';
import { assignDocumentProject } from '@/lib/projects-client';
import {
  decorateAnchorHighlights,
  firstAnchorHighlightForThread,
  restyleAnchorHighlights,
  threadIdsFromAttribute,
} from '@/lib/anchor-highlight-dom';
import {
  commentDraftContextKey,
  newCommentDraftIdempotencyKey,
  useCommentDraft,
} from '@/lib/comment-draft';
import { useCollapsePreference } from '@/lib/collapse-preference';
import {
  activeHeadingIdForScroll,
  deriveTocEntriesFromHeadings,
  type HeadingPosition,
  type TocEntry,
} from '@/lib/review-surface-layout';
import { cn } from '@/lib/cn';
import { approveDocument, revokeApproval } from '@/lib/approvals-client';
import type { Approval, Document, DocumentVersion, LifecycleStatus, Project, SyncStatus } from '@/lib/document-types';
import { versionLabel as displayVersionLabel } from '@/lib/version-label';
import type { AnchorSelector } from '@/lib/anchor-capture-core';
import type { ReviewThread, SuggestionStatus, ThreadAnchorPayload, ThreadComment, ThreadStatus } from '@/lib/thread-types';

const SCROLL_SPY_OFFSET = 136;
const MOBILE_BREAKPOINT = 1280;
const NEW_VERSION_POLL_INTERVAL_MS = 15000;
const LIFECYCLE_OPTIONS: LifecycleStatus[] = ['draft', 'in_review', 'approved', 'superseded'];

export function DocumentReviewSurface({
  documentId,
  title,
  surfaceLabel,
  sourceUrl,
  lifecycleStatus,
  versions = [],
  viewedVersionId,
  currentVersionId,
  versionLabel,
  syncedAt,
  approvals = [],
  currentUserId = null,
  canUpdateLifecycle = false,
  projects = [],
  projectId = null,
  backHref,
  backLabel,
  plainText,
  projectionVersion,
  canResync = false,
  canUpdateContent = false,
  canRunAi = false,
  canProposeCommentSplits = false,
  lastSyncStatus = null,
  syncError = null,
  children,
}: {
  documentId: number;
  title: string;
  surfaceLabel: string;
  sourceUrl?: string | null;
  lifecycleStatus?: LifecycleStatus | null;
  versions?: DocumentVersion[];
  viewedVersionId: number;
  currentVersionId: number;
  versionLabel?: string | null;
  syncedAt?: string | null;
  approvals?: Approval[];
  currentUserId?: number | null;
  canUpdateLifecycle?: boolean;
  /** The workspace's projects for the assignment selector (M3.6). */
  projects?: Project[];
  /** The document's current project, or null for Unfiled. */
  projectId?: number | null;
  backHref?: string | null;
  backLabel?: string | null;
  plainText: string | null;
  projectionVersion: string | null;
  canResync?: boolean;
  /**
   * Upload-sourced documents (#113): the author can re-paste the body to mint a
   * new version through the same pipeline a re-sync uses. Mutually exclusive with
   * `canResync` — a document has either a URL to re-pull or a body to re-paste,
   * never both — and, like `canResync`, only ever true on the authenticated
   * surface (the share surface passes neither).
   */
  canUpdateContent?: boolean;
  /**
   * The BYO-key AI surface (SPEC §14, M4). True only when the API reports an
   * Anthropic key configured — the capability read fails closed, and the share
   * surface never passes it, so a keyless instance and a share reviewer both see
   * no AI affordance at all rather than a button that 404s. Gates every artifact
   * in the header (digest, improve-the-doc prompt) as one switch.
   */
  canRunAi?: boolean;
  /**
   * The per-comment AI split affordance (#134). Gated on the same BYO key as the
   * digest, and passed separately because it is a separate surface: an instance
   * with no key, and the share surface, both leave it false and get no button.
   */
  canProposeCommentSplits?: boolean;
  lastSyncStatus?: SyncStatus | null;
  syncError?: string | null;
  children: ReactNode;
}) {
  const router = useRouter();
  const t = useTranslations('review');
  const tChips = useTranslations('chips');
  const format = useFormatter();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const headingPositionsRef = useRef<HeadingPosition[]>([]);
  const [threads, setThreads] = useState<ReviewThread[]>([]);
  const [page, setPage] = useState(1);
  const [lastPage, setLastPage] = useState(1);
  const [activeThreadId, setActiveThreadId] = useState<number | null>(null);
  const [hoveredThreadId, setHoveredThreadId] = useState<number | null>(null);
  const [mobileThreadId, setMobileThreadId] = useState<number | null>(null);
  const [tocEntries, setTocEntries] = useState<TocEntry[]>([]);
  const [activeHeadingId, setActiveHeadingId] = useState<string | null>(null);
  const [anchorPositions, setAnchorPositions] = useState<Record<number, number>>({});
  const [documentHeight, setDocumentHeight] = useState(320);
  const [composer, setComposer] = useState<ComposerState>({ open: false });
  // The ask panel (#139), open when non-null and carrying the passage it was
  // opened for. Held here rather than in the component because two affordances
  // open it — the header button and the selection popover — and a reader must
  // never end up with two panels holding two different answers. Closing it
  // unmounts the panel, which is what makes the answer ephemeral.
  const [askRequest, setAskRequest] = useState<AskRequest | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [headerMessage, setHeaderMessage] = useState<string | null>(null);
  const [resyncPending, setResyncPending] = useState(false);
  const [resyncError, setResyncError] = useState<string | null>(null);
  const [newerVersionNotice, setNewerVersionNotice] = useState<NewerVersionNotice | null>(() => {
    const currentVersion = versions.find((version) => version.id === currentVersionId) ?? null;
    return newerVersionNoticeFromVersion({ currentVersion, documentId, viewedVersionId });
  });
  const [approvalRoster, setApprovalRoster] = useState<Approval[]>(approvals);
  const [approvalPending, setApprovalPending] = useState(false);
  const [lifecycleValue, setLifecycleValue] = useState<LifecycleStatus | null>(lifecycleStatus ?? null);
  const [lifecyclePending, setLifecyclePending] = useState(false);
  const [projectValue, setProjectValue] = useState<number | null>(projectId);
  const [projectPending, setProjectPending] = useState(false);
  const [pendingReattachThreadId, setPendingReattachThreadId] = useState<number | null>(null);
  const [reattachingThreadId, setReattachingThreadId] = useState<number | null>(null);
  const [reattachStatus, setReattachStatus] = useState<ReattachStatus | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useCollapsePreference('kedge:review:sidebar-collapsed');
  const [railCollapsed, setRailCollapsed] = useCollapsePreference('kedge:review:rail-collapsed');
  const [forkingCommentIds, setForkingCommentIds] = useState<ReadonlySet<number>>(() => new Set());
  const submittingRef = useRef(false);
  const forkGuardRef = useRef<CommentForkGuard | null>(null);
  const loadedPageRef = useRef(1);
  if (forkGuardRef.current === null) {
    forkGuardRef.current = createCommentForkGuard(newCommentDraftIdempotencyKey);
  }
  const numericProjectionVersion = projectionVersion == null ? NaN : Number(projectionVersion);
  const canCapture = plainText != null && Number.isFinite(numericProjectionVersion);
  const openThreadCount = threads.filter((thread) => thread.status === 'open').length;
  const orphanedThreadCount = threads.filter((thread) => thread.anchor?.state === 'orphaned').length;
  const highlightedThreadId = hoveredThreadId ?? activeThreadId;
  const currentUserApproval = useMemo(() => {
    if (currentUserId === null) return null;

    return approvalRoster.find((approval) => approval.user.id === currentUserId && !approval.stale) ?? null;
  }, [approvalRoster, currentUserId]);
  const selectedMobileThread = useMemo(() => {
    return mobileThreadId === null ? null : threads.find((thread) => thread.id === mobileThreadId) ?? null;
  }, [mobileThreadId, threads]);
  const composerDraftContextKey = useMemo(() => {
    if (!composer.open) return null;

    return commentDraftContextKey({
      documentId,
      target: composer.mode === 'inline' && composer.anchor
        ? { type: 'anchor', anchor: composer.anchor }
        : { type: 'document' },
    });
  }, [composer, documentId]);
  const composerInitialProposedText = composer.open && composer.mode === 'inline' && composer.anchor
    ? composer.anchor.exact
    : '';
  const composerDraft = useCommentDraft(composerDraftContextKey, {
    initialMode: 'comment',
    initialProposedText: composerInitialProposedText,
  });
  const composerCanSuggest = composer.open
    && composer.mode === 'inline'
    && composer.anchor != null
    && composer.failure == null;
  const composerCommentType = composerCanSuggest ? composerDraft.mode : 'comment';
  const visibleSyncError = resyncError ?? (lastSyncStatus === 'failed' ? syncError : null);
  const currentVersionLabel = displayVersionLabel(versions.find((version) => version.id === currentVersionId))
    ?? (currentVersionId === viewedVersionId ? versionLabel ?? null : null);

  const reloadThreads = useCallback(async (targetPage = 1) => {
    const firstPage = await listThreads(documentId, 1, viewedVersionId);
    const last = firstPage.meta?.last_page ?? 1;
    const finalPage = Math.min(Math.max(1, targetPage), last);
    const remainingPages = finalPage > 1
      ? await Promise.all(Array.from({ length: finalPage - 1 }, (_, index) => listThreads(documentId, index + 2, viewedVersionId)))
      : [];
    const pages = [firstPage, ...remainingPages];

    loadedPageRef.current = finalPage;
    setThreads(pages.flatMap((threadPage) => threadPage.data));
    setPage(finalPage);
    setLastPage(last);
  }, [documentId, viewedVersionId]);

  const refreshLoadedThreads = useCallback(async () => {
    await reloadThreads(loadedPageRef.current);
  }, [reloadThreads]);

  useEffect(() => {
    void reloadThreads(1);
  }, [reloadThreads]);

  // Build the highlight marks only when the thread set or projection changes;
  // hover/active changes restyle the existing marks in place. Rebuilding on
  // hover would swap the DOM node out from under an in-flight click (mousedown
  // target disconnects → the browser never fires the click).
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    decorateAnchorHighlights(root, threads, null, plainText ?? '');
  }, [threads, plainText]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    restyleAnchorHighlights(root, highlightedThreadId);
  }, [threads, plainText, highlightedThreadId]);

  const refreshDocumentLayout = useCallback(() => {
    const root = rootRef.current;
    if (!root) return;

    const { entries, positions } = collectTocFromRenderedHeadings(root);
    headingPositionsRef.current = positions;
    setTocEntries((current) => tocEntriesEqual(current, entries) ? current : entries);
    setActiveHeadingId(activeHeadingIdForScroll(positions, window.scrollY, SCROLL_SPY_OFFSET));
    const nextAnchorPositions = measureAnchorPositions(root, threads);
    setAnchorPositions((current) => anchorPositionsEqual(current, nextAnchorPositions) ? current : nextAnchorPositions);
    setDocumentHeight(Math.ceil(root.getBoundingClientRect().height));
  }, [threads]);

  useEffect(() => {
    setApprovalRoster(approvals);
  }, [approvals]);

  useEffect(() => {
    setLifecycleValue(lifecycleStatus ?? null);
  }, [lifecycleStatus]);

  useEffect(() => {
    setProjectValue(projectId);
  }, [projectId]);

  useEffect(() => {
    const currentVersion = versions.find((version) => version.id === currentVersionId) ?? null;
    setNewerVersionNotice(newerVersionNoticeFromVersion({ currentVersion, documentId, viewedVersionId }));
  }, [currentVersionId, documentId, viewedVersionId, versions]);

  useEffect(() => {
    if (versions.length === 0) return;

    let cancelled = false;

    async function pollForNewerVersion() {
      const document = await readDocument(documentId).catch(() => null);
      if (cancelled) return;
      if (!document) return;

      setNewerVersionNotice(newerVersionNoticeFromDocument({
        document,
        documentId,
        viewedVersionId,
      }));
    }

    void pollForNewerVersion();
    const interval = window.setInterval(() => void pollForNewerVersion(), NEW_VERSION_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [documentId, viewedVersionId, versions.length]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let frame = 0;
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(refreshDocumentLayout);
    };

    schedule();
    window.addEventListener('resize', schedule);
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(schedule);
      observer.observe(root);

      return () => {
        cancelAnimationFrame(frame);
        window.removeEventListener('resize', schedule);
        observer.disconnect();
      };
    }

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', schedule);
    };
  }, [refreshDocumentLayout]);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        setActiveHeadingId(activeHeadingIdForScroll(headingPositionsRef.current, window.scrollY, SCROLL_SPY_OFFSET));
      });
    };

    update();
    window.addEventListener('scroll', update, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', update);
    };
  }, []);

  const openMobileThread = useCallback((threadId: number | null = null) => {
    const targetId = threadId
      ?? activeThreadId
      ?? threads.find((thread) => thread.status === 'open')?.id
      ?? threads[0]?.id
      ?? null;
    setMobileThreadId(targetId);
    if (targetId !== null) setActiveThreadId(targetId);
  }, [activeThreadId, threads]);

  const activateThreadCard = useCallback((threadId: number) => {
    setActiveThreadId(threadId);
    setHoveredThreadId(null);
    setRailCollapsed(false);
    // The rail may be mounting right now (it was collapsed): retry across a few
    // frames until the card exists.
    const focusCard = (attemptsLeft: number) => {
      window.requestAnimationFrame(() => {
        const card = document.querySelector<HTMLElement>(`[data-thread-card-id="${threadId}"]`);
        if (!card) {
          if (attemptsLeft > 0) focusCard(attemptsLeft - 1);
          return;
        }
        card.scrollIntoView({ block: 'center', behavior: 'smooth' });
        card.focus({ preventScroll: true });
      });
    };
    focusCard(5);
  }, [setRailCollapsed]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    function over(event: MouseEvent) {
      const id = firstThreadIdFromTarget(event.target);
      if (id) setHoveredThreadId(id);
    }

    function out(event: MouseEvent) {
      const current = event.target instanceof Element
        ? event.target.closest('[data-kedge-thread-ids]')
        : null;
      if (!current) return;
      const next = event.relatedTarget instanceof Element
        ? event.relatedTarget.closest('[data-kedge-thread-ids]')
        : null;
      if (current !== next) setHoveredThreadId(null);
    }

    function focusIn(event: FocusEvent) {
      const id = firstThreadIdFromTarget(event.target);
      if (id) setActiveThreadId(id);
    }

    function click(event: MouseEvent) {
      const id = firstThreadIdFromTarget(event.target);
      if (!id) return;
      event.preventDefault();
      if (window.innerWidth < MOBILE_BREAKPOINT) {
        openMobileThread(id);
      } else {
        activateThreadCard(id);
      }
    }

    function keyDown(event: KeyboardEvent) {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const id = firstThreadIdFromTarget(event.target);
      if (!id) return;
      event.preventDefault();
      if (window.innerWidth < MOBILE_BREAKPOINT) {
        openMobileThread(id);
      } else {
        activateThreadCard(id);
      }
    }

    root.addEventListener('mouseover', over);
    root.addEventListener('mouseout', out);
    root.addEventListener('focusin', focusIn);
    root.addEventListener('click', click);
    root.addEventListener('keydown', keyDown);
    return () => {
      root.removeEventListener('mouseover', over);
      root.removeEventListener('mouseout', out);
      root.removeEventListener('focusin', focusIn);
      root.removeEventListener('click', click);
      root.removeEventListener('keydown', keyDown);
    };
  }, [activateThreadCard, openMobileThread]);

  function captureSelection() {
    if (!canCapture || !rootRef.current) return;
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      setComposer({ open: false });
      return;
    }

    const range = selection.getRangeAt(0);
    if (!rootRef.current.contains(range.commonAncestorContainer)) return;
    const rect = range.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return;

    const result = captureAnchorFromSelection({
      root: rootRef.current,
      plainText,
      projectionVersion: numericProjectionVersion,
      selection,
    });

    const base = {
      open: true as const,
      stage: 'affordance' as const,
      x: Math.min(window.innerWidth - 180, Math.max(16, rect.left + rect.width / 2)),
      y: Math.max(16, rect.top - 44),
    };

    if (result.ok) {
      if (pendingReattachThreadId !== null) {
        void reattachToSelection(pendingReattachThreadId, result.selector);
        return;
      }

      setComposer({ ...base, mode: 'inline', anchor: result.selector, failure: null });
    } else {
      console.warn('anchor capture failed', result);
      if (pendingReattachThreadId !== null) {
        setReattachStatus({
          threadId: pendingReattachThreadId,
          tone: 'error',
          message: t('surface.captureFailed'),
        });
        return;
      }

      setComposer({ ...base, mode: 'document', anchor: null, failure: result });
    }
  }

  async function reattachToSelection(threadId: number, anchor: AnchorSelector) {
    if (reattachingThreadId !== null) return;

    setMessage(null);
    setReattachingThreadId(threadId);

    try {
      const outcome = await reanchorThread(threadId, {
        ...anchor,
        projection_version: String(anchor.projection_version),
      });
      if (!outcome.ok) {
        setReattachStatus({ threadId, tone: 'error', message: outcome.message });
        return;
      }

      setPendingReattachThreadId(null);
      setReattachStatus(null);
      window.getSelection()?.removeAllRanges();
      await refreshLoadedThreads();
      setActiveThreadId(outcome.thread.id);
    } finally {
      setReattachingThreadId(null);
    }
  }

  async function submit() {
    if (!composer.open || submittingRef.current) return;
    const body = composerDraft.body;
    const proposedText = composerDraft.proposedText;
    const validity = commentComposerSubmitState({
      canSuggest: composer.mode === 'inline' && composer.anchor != null && composer.failure == null,
      commentType: composerDraft.mode,
      body,
      proposedText,
      anchorExact: composer.anchor?.exact,
    });
    if (validity.submitDisabled) {
      if (validity.suggestionUnchanged) setMessage(t('surface.suggestionUnchanged'));

      return;
    }
    setMessage(null);
    submittingRef.current = true;
    setSubmitting(true);

    try {
      const result = await postDocumentComposerDraft({
        documentId,
        draft: {
          mode: composer.mode,
          commentType: composerDraft.mode,
          anchor: composer.anchor,
          failedCapture: composer.failure != null,
          body,
          proposedText,
          idempotencyKey: composerDraft.idempotencyKey,
        },
        documentVersionId: viewedVersionId,
        createThread,
        createSuggestionThread,
      });

      if (result.status === 'failed') {
        setMessage(result.message);
        return;
      }
      if (result.status === 'invalid') return;

      composerDraft.clear();
      setComposer({ open: false });
      window.getSelection()?.removeAllRanges();
      await refreshLoadedThreads();
      setActiveThreadId(result.value.id);
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  async function setThreadStatus(thread: ReviewThread, status: ThreadStatus): Promise<string | null> {
    const outcome = await updateThreadStatus(thread.id, status);
    if (!outcome.ok) return outcome.message;

    await refreshLoadedThreads();
    setActiveThreadId(outcome.thread.id);

    return null;
  }

  async function setSuggestionStatus(comment: ThreadComment, status: SuggestionStatus): Promise<string | null> {
    const outcome = await updateSuggestionStatus(comment.id, status);
    if (!outcome.ok) return outcome.message;

    await refreshLoadedThreads();
    setActiveThreadId(comment.thread_id);

    return null;
  }

  async function reply(
    thread: ReviewThread,
    input: ReplyToThreadInput,
    idempotencyKey: string,
  ): Promise<string | null> {
    const outcome = await replyToThread(thread.id, input, idempotencyKey);
    if (!outcome.ok) return outcome.message;

    await refreshLoadedThreads();
    setActiveThreadId(thread.id);

    return null;
  }

  async function fork(_thread: ReviewThread, comment: ThreadComment): Promise<string | null> {
    const forkGuard = forkGuardRef.current;
    if (!forkGuard) return null;
    const started = forkGuard.start(comment.id);
    if (!started.started) return null;
    syncForkingCommentIds();

    let posted = false;
    try {
      const outcome = await forkComment(comment.id, started.idempotencyKey);
      if (!outcome.ok) return outcome.message;

      posted = true;
      await refreshLoadedThreads();
      setActiveThreadId(outcome.thread.id);
    } finally {
      forkGuard.finish(comment.id, { posted });
      syncForkingCommentIds();
    }

    return null;
  }

  /**
   * Approve one AI split proposal (#134). This is the ONLY place a proposal
   * becomes review data, and it does so by calling the ordinary fork endpoint —
   * same Policy, same server-side anchor validation, same idempotency as the
   * fork button beside it. The AI proposed; this click is the write.
   *
   * A rejected anchor comes back as the endpoint's own message and is reported
   * against its proposal; the panel keeps the remaining proposals approvable.
   */
  async function approveSplit(
    commentId: number,
    idempotencyKey: string,
    anchor: ThreadAnchorPayload | null,
  ): Promise<string | null> {
    const outcome = await forkComment(commentId, idempotencyKey, anchor);
    if (!outcome.ok) return outcome.message;

    await refreshLoadedThreads();
    setActiveThreadId(outcome.thread.id);

    return null;
  }

  function syncForkingCommentIds() {
    setForkingCommentIds(forkGuardRef.current?.forkingCommentIds() ?? new Set());
  }

  async function edit(comment: ThreadComment, nextBody: string): Promise<string | null> {
    const outcome = await editComment(comment.id, nextBody);
    if (!outcome.ok) return outcome.message;

    await refreshLoadedThreads();
    setActiveThreadId(comment.thread_id);

    return null;
  }

  async function remove(comment: ThreadComment): Promise<string | null> {
    const outcome = await deleteComment(comment.id);
    if (!outcome.ok) return outcome.message;

    await refreshLoadedThreads();
    setActiveThreadId(comment.thread_id);

    return null;
  }

  async function toggleReaction(comment: ThreadComment): Promise<string | null> {
    const outcome = await toggleCommentReaction(comment.id);
    if (!outcome.ok) return outcome.message;

    await refreshLoadedThreads();
    setActiveThreadId(comment.thread_id);

    return null;
  }

  function focusThread(thread: ReviewThread) {
    setActiveThreadId(thread.id);
    setHoveredThreadId(null);
    setRailCollapsed(false);
    const root = rootRef.current;
    const target = firstAnchorHighlightForThread(root, thread.id);
    if (target) {
      target.scrollIntoView({ block: 'center', behavior: 'smooth' });
      return;
    }

    const card = document.querySelector<HTMLElement>(`[data-thread-card-id="${thread.id}"]`);
    card?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  function jumpToHeading(id: string) {
    const target = document.getElementById(id);
    target?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    setActiveHeadingId(id);
  }

  async function resync() {
    if (resyncPending) return;
    const startingVersionLabel = currentVersionLabel;
    setResyncPending(true);
    setResyncError(null);
    setHeaderMessage(null);

    try {
      const outcome = await resyncDocument(documentId);
      if (!outcome.ok) {
        setResyncError(outcome.message);
        return;
      }

      const result = await waitForResyncCompletion(documentId, startingVersionLabel);
      if (result.status === 'failed') {
        setResyncError(result.message);
        router.refresh();
        return;
      }

      await refreshSurfaceAfterResync(refreshLoadedThreads, () => router.refresh());
    } catch {
      setResyncError(t('surface.resyncError'));
    } finally {
      setResyncPending(false);
    }
  }

  async function toggleApproval() {
    if (approvalPending || currentUserId === null) return;

    setApprovalPending(true);
    setHeaderMessage(null);

    try {
      if (currentUserApproval) {
        const outcome = await revokeApproval(currentUserApproval.id);
        if (!outcome.ok) {
          setHeaderMessage(outcome.message);
          return;
        }
        setApprovalRoster((previous) => previous.filter((approval) => approval.id !== currentUserApproval.id));
        router.refresh();
        return;
      }

      const outcome = await approveDocument(documentId);
      if (!outcome.ok) {
        setHeaderMessage(outcome.message);
        return;
      }
      setApprovalRoster((previous) => [
        ...previous.filter((approval) => approval.id !== outcome.approval.id),
        outcome.approval,
      ].sort((a, b) => a.id - b.id));
      router.refresh();
    } finally {
      setApprovalPending(false);
    }
  }

  async function changeLifecycle(nextStatus: LifecycleStatus) {
    if (lifecyclePending || lifecycleValue === nextStatus) return;

    const previousStatus = lifecycleValue;
    setLifecycleValue(nextStatus);
    setLifecyclePending(true);
    setHeaderMessage(null);

    try {
      const outcome = await updateDocumentLifecycle(documentId, nextStatus);
      if (!outcome.ok) {
        setLifecycleValue(previousStatus);
        setHeaderMessage(outcome.message);
        return;
      }

      setLifecycleValue(outcome.document.lifecycle_status);
      setApprovalRoster((previous) => outcome.document.approvals ?? previous);
      router.refresh();
    } finally {
      setLifecyclePending(false);
    }
  }

  async function changeProject(nextId: number | null) {
    if (projectPending || projectValue === nextId) return;

    const previousId = projectValue;
    setProjectValue(nextId);
    setProjectPending(true);
    setHeaderMessage(null);

    try {
      const outcome = await assignDocumentProject(documentId, nextId);
      if (!outcome.ok) {
        setProjectValue(previousId);
        setHeaderMessage(outcome.message);
        return;
      }

      setProjectValue(outcome.document.project?.id ?? null);
      router.refresh();
    } finally {
      setProjectPending(false);
    }
  }

  // Assignment is capability-gated exactly like lifecycle (author only, M3.6);
  // with no projects to file under, the selector would offer only Unfiled, so it
  // stays hidden until the workspace has at least one project.
  const projectControl = canUpdateLifecycle && projects.length > 0 ? (
    <select
      aria-label={t('surface.projectLabel')}
      value={projectValue === null ? '' : String(projectValue)}
      disabled={projectPending}
      onChange={(event) => void changeProject(event.target.value === '' ? null : Number(event.target.value))}
      className="h-8 max-w-[12rem] truncate rounded-full bg-zinc-100 px-3 text-sm font-medium text-zinc-700 ring-1 ring-inset ring-zinc-900/10 hover:bg-zinc-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:opacity-60 dark:bg-white/5 dark:text-zinc-200 dark:ring-white/10 dark:hover:bg-white/10"
    >
      <option value="">{t('surface.unfiled')}</option>
      {projects.map((project) => (
        <option key={project.id} value={project.id}>
          {project.name}
        </option>
      ))}
    </select>
  ) : null;

  const lifecycleControl = canUpdateLifecycle && lifecycleValue ? (
    <select
      aria-label={t('surface.lifecycleLabel')}
      value={lifecycleValue}
      disabled={lifecyclePending}
      onChange={(event) => void changeLifecycle(event.target.value as LifecycleStatus)}
      className="h-8 rounded-full bg-zinc-100 px-3 text-sm font-medium text-zinc-700 ring-1 ring-inset ring-zinc-900/10 hover:bg-zinc-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:opacity-60 dark:bg-white/5 dark:text-zinc-200 dark:ring-white/10 dark:hover:bg-white/10"
    >
      {LIFECYCLE_OPTIONS.map((status) => (
        <option key={status} value={status}>
          {tChips(`lifecycle.${status}`)}
        </option>
      ))}
    </select>
  ) : null;

  const approvalControl = currentUserId !== null ? (
    <button
      type="button"
      onClick={() => void toggleApproval()}
      disabled={approvalPending}
      className={cn(
        'inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:opacity-60',
        currentUserApproval
          ? 'bg-zinc-100 text-zinc-700 ring-1 ring-inset ring-zinc-900/10 hover:bg-zinc-200 dark:bg-white/5 dark:text-zinc-200 dark:ring-white/10 dark:hover:bg-white/10'
          : 'bg-zinc-900 text-white hover:bg-zinc-700 dark:bg-emerald-400/10 dark:text-emerald-400 dark:ring-1 dark:ring-inset dark:ring-emerald-400/20 dark:hover:bg-emerald-400/15',
      )}
    >
      {currentUserApproval ? (
        <XCircle className="h-4 w-4" aria-hidden="true" />
      ) : (
        <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
      )}
      {approvalPending ? t('surface.saving') : currentUserApproval ? t('surface.revoke') : t('surface.approve')}
    </button>
  ) : null;

  const resyncControl = canResync ? (
    <button
      type="button"
      onClick={() => void resync()}
      disabled={resyncPending}
      className="inline-flex items-center gap-2 rounded-full bg-zinc-900 px-3.5 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:opacity-60 dark:bg-emerald-400/10 dark:text-emerald-400 dark:ring-1 dark:ring-inset dark:ring-emerald-400/20 dark:hover:bg-emerald-400/15"
    >
      <RefreshCw className={cn('h-4 w-4', resyncPending ? 'animate-spin' : '')} aria-hidden="true" />
      {resyncPending ? t('surface.resyncing') : t('surface.resync')}
    </button>
  ) : null;

  // An upload-sourced document's manual-versioning affordance (#113): re-paste
  // the body to mint a new version through the same pipeline. Owns its own dialog
  // + polling state; it refreshes this surface's threads and server props on a
  // successful flip, exactly as resync() does.
  const updateContentControl = canUpdateContent ? (
    <UpdateContentAction
      documentId={documentId}
      currentVersionLabel={currentVersionLabel}
      refreshThreads={refreshLoadedThreads}
      onServerRefresh={() => router.refresh()}
    />
  ) : null;

  // The per-comment split affordance's capability (#134): passing the approval
  // callback IS the gate, so a keyless instance renders no button at all.
  //
  // Absent while reading anything but the live current version. Proposals are
  // generated against, and approved into, whatever the CURRENT version is at
  // that moment — so offering them beside a page showing older text would let
  // the author approve anchors into passages they cannot see. The notice, not
  // the server-rendered ids, is the test: it also catches a version that landed
  // while this page was open.
  // One gate for both ask affordances (the header button and the selection
  // popover), so the panel can never be opened by a route that outlives the
  // control rendering it.
  const canAsk = canRunAi && viewedVersionId === currentVersionId;

  const splitCapability = canProposeCommentSplits
    && viewedVersionId === currentVersionId
    && newerVersionNotice === null
    ? { documentVersionId: currentVersionId, approve: approveSplit }
    : undefined;

  // The header's AI artifacts (DESIGN.md header anatomy): the digest (#130) and
  // the improve-the-doc prompt (#132). Each owns its own panel, run request, and
  // poll loop; neither writes review data, so they need nothing from this
  // surface but the document they read.
  //
  // Hidden while reading a historical version: all of them are taken over the
  // CURRENT version and its threads, so offering them here would silently
  // answer a different question than the one the page appears to be asking.
  //
  // Ask (#139) joins them with one difference: its panel is also reachable from
  // a text selection, so the OPEN state lives here rather than inside the
  // component — one panel, two ways in, and only one place an answer can be.
  const aiArtifactControls = canAsk ? (
    <>
      <AiDigestAction documentId={documentId} documentTitle={title} />
      <AiImprovePromptAction documentId={documentId} />
      <AiAskAction
        documentId={documentId}
        request={askRequest}
        onOpen={(quote) => setAskRequest({ quote })}
        onClose={() => setAskRequest(null)}
      />
    </>
  ) : null;

  const versionSwitcher = versions.length > 0 ? (
    <DocumentVersionSwitcher
      documentId={documentId}
      versions={versions}
      viewedVersionId={viewedVersionId}
      currentVersionId={currentVersionId}
    />
  ) : null;

  const headerActions = versionSwitcher || projectControl || lifecycleControl || approvalControl || resyncControl || updateContentControl || aiArtifactControls ? (
    <>
      {versionSwitcher}
      {projectControl}
      {lifecycleControl}
      {approvalControl}
      {resyncControl}
      {updateContentControl}
      {aiArtifactControls}
    </>
  ) : null;

  return (
    <div>
      <DocumentReviewHeader
        title={title}
        surfaceLabel={surfaceLabel}
        sourceUrl={sourceUrl}
        lifecycleStatus={lifecycleValue}
        versionLabel={versionLabel}
        currentVersionLabel={currentVersionLabel}
        syncedAt={syncedAt}
        approvals={approvalRoster}
        openThreadCount={openThreadCount}
        backHref={backHref}
        backLabel={backLabel}
        syncError={visibleSyncError}
        actions={headerActions}
      />

      {headerMessage ? (
        <div className="px-6">
          <div className="mx-auto mt-3 max-w-7xl rounded-lg bg-rose-50 px-4 py-2 text-sm text-rose-700 ring-1 ring-rose-600/15 dark:bg-rose-400/10 dark:text-rose-200 dark:ring-rose-400/20">
            {headerMessage}
          </div>
        </div>
      ) : null}

      <DocumentNewVersionBanner notice={newerVersionNotice} />

      {/* Full-viewport review row (DESIGN.md: the docs grid must not reserve
          space for chrome that isn't there). The sidebar and thread rail are
          collapsible; the prose column keeps its 52rem measure and centers in
          whatever width remains. */}
      <div className="flex">
        <div className={cn('hidden shrink-0 lg:block', sidebarCollapsed ? 'w-12' : 'w-72')}>
          {sidebarCollapsed ? (
            <div className="sticky top-32 flex justify-center py-8">
              <ColumnToggleButton
                label={t('sidebar.show')}
                onClick={() => setSidebarCollapsed(false)}
              >
                <PanelLeftOpen className="h-4 w-4" aria-hidden="true" />
              </ColumnToggleButton>
            </div>
          ) : (
            <DocumentReviewSidebar
              tocEntries={tocEntries}
              activeHeadingId={activeHeadingId}
              threads={threads}
              activeThreadId={activeThreadId}
              lifecycleStatus={lifecycleStatus}
              versionLabel={versionLabel}
              onJumpToHeading={jumpToHeading}
              onFocusThread={focusThread}
              onCollapse={() => setSidebarCollapsed(true)}
            />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div
            className={cn(
              'mx-auto grid max-w-7xl grid-cols-1 items-start gap-10 px-6 py-8 xl:justify-center',
              railCollapsed
                ? 'xl:grid-cols-[minmax(0,52rem)]'
                : 'xl:grid-cols-[minmax(0,52rem)_320px] 2xl:grid-cols-[minmax(0,52rem)_360px]',
            )}
          >
            <div
              ref={rootRef}
              onMouseUp={captureSelection}
              onKeyUp={captureSelection}
              className="mx-auto w-full min-w-0 max-w-[52rem]"
            >
              {children}
            </div>

            {railCollapsed ? null : (
              <DocumentThreadRail
                threads={threads}
                page={page}
                lastPage={lastPage}
                activeThreadId={activeThreadId}
                highlightedThreadId={highlightedThreadId}
                anchorPositions={anchorPositions}
                documentHeight={documentHeight}
                onFocusThread={focusThread}
                onActivateThread={(thread) => setActiveThreadId(thread.id)}
                onHoverThread={(thread) => setHoveredThreadId(thread.id)}
                onLeaveThread={() => setHoveredThreadId(null)}
                onLoadMore={() => void reloadThreads(page + 1)}
                onSetThreadStatus={setThreadStatus}
                onStartReattach={(thread) => {
                  setPendingReattachThreadId(thread.id);
                  setMessage(null);
                  setReattachStatus({
                    threadId: thread.id,
                    tone: 'info',
                    message: t('surface.reattachPrompt'),
                  });
                  setComposer({ open: false });
                  setActiveThreadId(thread.id);
                }}
                onReply={reply}
                onForkComment={fork}
                forkingCommentIds={forkingCommentIds}
                onEditComment={edit}
                onDeleteComment={remove}
                onSetSuggestionStatus={setSuggestionStatus}
                onToggleReaction={toggleReaction}
                splitCapability={splitCapability}
                pendingReattachThreadId={pendingReattachThreadId}
                reattachingThreadId={reattachingThreadId}
                reattachStatus={reattachStatus}
              />
            )}
          </div>
        </div>

        <div className="hidden w-12 shrink-0 xl:block">
          <div className="sticky top-32 flex flex-col items-center gap-2 py-8">
            <ColumnToggleButton
              label={railCollapsed ? t('surface.showRail') : t('surface.hideRail')}
              onClick={() => setRailCollapsed(!railCollapsed)}
            >
              {railCollapsed ? (
                <PanelRightOpen className="h-4 w-4" aria-hidden="true" />
              ) : (
                <PanelRightClose className="h-4 w-4" aria-hidden="true" />
              )}
            </ColumnToggleButton>
            {railCollapsed && threads.length > 0 ? (
              <span
                title={t('surface.openThreadsCount', { count: openThreadCount })}
                className="rounded-full bg-zinc-100 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-zinc-600 ring-1 ring-inset ring-zinc-900/10 dark:bg-white/5 dark:text-zinc-300 dark:ring-white/10"
              >
                {format.number(openThreadCount)}
              </span>
            ) : null}
            {railCollapsed && orphanedThreadCount > 0 ? (
              <span
                title={t('surface.orphanedThreadsCount', { count: orphanedThreadCount })}
                className="h-2 w-2 rounded-full bg-rose-500"
              />
            ) : null}
          </div>
        </div>
      </div>

      {threads.length > 0 ? (
        <div className="fixed inset-x-0 bottom-5 z-40 flex justify-center px-4 xl:hidden">
          <button
            type="button"
            onClick={() => openMobileThread()}
            className="inline-flex items-center gap-2 rounded-full bg-zinc-900 px-5 py-2.5 text-sm font-medium text-white shadow-xl ring-1 ring-white/10 hover:bg-zinc-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:bg-emerald-400/10 dark:text-emerald-400 dark:ring-emerald-400/20 dark:hover:bg-emerald-400/15"
          >
            <MessageSquare className="h-4 w-4" aria-hidden="true" />
            {t('surface.openThreadsCount', { count: openThreadCount })}
          </button>
        </div>
      ) : null}

      <MobileThreadSheet
        open={mobileThreadId !== null}
        thread={selectedMobileThread}
        onClose={() => setMobileThreadId(null)}
        onSetThreadStatus={setThreadStatus}
        onReply={reply}
        onForkComment={fork}
        forkingCommentIds={forkingCommentIds}
        onEditComment={edit}
        onDeleteComment={remove}
        onSetSuggestionStatus={setSuggestionStatus}
        onToggleReaction={toggleReaction}
        splitCapability={splitCapability}
      />

      <DocumentCommentComposer
        documentId={documentId}
        composer={composer}
        commentType={composerCommentType}
        body={composerDraft.body}
        proposedText={composerDraft.proposedText}
        message={message}
        submitting={submitting}
        onBodyChange={(body) => {
          if (!submittingRef.current) composerDraft.setBody(body);
        }}
        onProposedTextChange={(proposedText) => {
          if (!submittingRef.current) composerDraft.setProposedText(proposedText);
        }}
        onCommentTypeChange={(commentType) => {
          if (!composer.open || submittingRef.current) return;
          if (commentType === 'suggestion' && composerDraft.proposedText === '' && composer.mode === 'inline' && composer.anchor) {
            composerDraft.setProposedText(composer.anchor.exact);
          }
          composerDraft.setMode(commentType);
        }}
        onClose={() => {
          if (submittingRef.current) return;
          composerDraft.clear();
          setComposer({ open: false });
          setMessage(null);
        }}
        onOpenPanel={() => {
          if (submittingRef.current) return;
          if (composer.open) setComposer({ ...composer, stage: 'panel' });
        }}
        onAsk={canAsk ? () => {
          if (!composer.open) return;
          // The selection's own text becomes the quoted passage; a selection
          // that failed to anchor still HAS text, so an ask about it is a
          // doc-wide ask rather than nothing at all.
          setAskRequest({ quote: composer.anchor ? askQuoteFromSelector(composer.anchor) : null });
          setComposer({ open: false });
        } : undefined}
        onSubmit={() => void submit()}
      />
    </div>
  );
}

function ColumnToggleButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="rounded-full p-2 text-zinc-400 ring-1 ring-inset ring-zinc-900/10 hover:bg-zinc-100 hover:text-zinc-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:ring-white/10 dark:hover:bg-white/5 dark:hover:text-zinc-200"
    >
      {children}
    </button>
  );
}

function collectTocFromRenderedHeadings(root: HTMLElement): { entries: TocEntry[]; positions: HeadingPosition[] } {
  const headingElements = Array.from(root.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6'));
  const validElements = headingElements.filter((element) => {
    return /^h[1-6]$/i.test(element.tagName) && (element.textContent ?? '').trim() !== '';
  });
  const entries = deriveTocEntriesFromHeadings(validElements.map((element) => ({
    tagName: element.tagName.toLowerCase(),
    text: element.textContent ?? '',
    id: element.id || null,
  })));

  const positions = entries.map((entry, index) => {
    const element = validElements[index];
    element.id = entry.id;
    element.classList.add('scroll-mt-32');

    return {
      id: entry.id,
      top: element.getBoundingClientRect().top + window.scrollY,
    };
  });

  return { entries, positions };
}

function measureAnchorPositions(root: HTMLElement, threads: ReviewThread[]): Record<number, number> {
  const rootRect = root.getBoundingClientRect();
  const positions: Record<number, number> = {};

  for (const thread of threads) {
    if (!thread.anchor) continue;
    const target = firstAnchorHighlightForThread(root, thread.id);
    if (!target) continue;
    const targetRect = target.getBoundingClientRect();
    positions[thread.id] = targetRect.top - rootRect.top + targetRect.height / 2;
  }

  return positions;
}

function tocEntriesEqual(left: TocEntry[], right: TocEntry[]): boolean {
  if (left.length !== right.length) return false;

  return left.every((entry, index) => {
    const other = right[index];
    return entry.id === other.id && entry.title === other.title && entry.level === other.level;
  });
}

function anchorPositionsEqual(left: Record<number, number>, right: Record<number, number>): boolean {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;

  return leftKeys.every((key) => left[Number(key)] === right[Number(key)]);
}

function firstThreadIdFromTarget(target: EventTarget | null): number | null {
  const element = target instanceof Element
    ? target.closest<HTMLElement>('[data-kedge-thread-ids]')
    : null;
  const id = threadIdsFromAttribute(element?.dataset.kedgeThreadIds)[0];
  return id ? Number(id) : null;
}

