import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  FileText,
  Loader2,
  Pin,
  RotateCcw,
  Search,
  Sparkles,
  Wrench,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type {
  AnalysisStory,
  EvidenceBlock,
  NextMove,
  PlanRevision,
  PlanStep,
  ToolCallSummary,
} from '@/features/analysis/types';
import { cn } from '@/lib/utils';
import { EvidenceContent } from './EvidenceContent';

const INLINE_EVIDENCE_LIMIT = 3;
const NON_NARRATIVE_TOOLS = new Set([
  'get_table_stats_and_schema',
  'get_volume_folder_details',
  'list_compute',
  'list_sql_warehouses',
  'get_best_sql_warehouse',
]);

function StatusBadge({ status }: { status: AnalysisStory['status'] }) {
  const inFlight = status === 'discovery' || status === 'planning' || status === 'running';
  const label = status === 'done'
    ? 'Done'
    : status === 'error'
    ? 'Error'
    : status === 'discovery'
    ? 'Scoping'
    : status === 'planning'
    ? 'Planning'
    : 'Running';
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-medium',
        status === 'done' && 'border-[var(--color-success)]/30 text-[var(--color-success)]',
        status === 'error' && 'border-[var(--color-error)]/30 text-[var(--color-error)]',
        inFlight && 'border-[var(--color-border)] text-[var(--color-text-muted)]'
      )}
    >
      {inFlight ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : status === 'error' ? (
        <AlertTriangle className="h-3 w-3" />
      ) : (
        <CheckCircle2 className="h-3 w-3" />
      )}
      {label}
    </span>
  );
}

function NextMoveButton({
  move,
  onSelect,
}: {
  move: NextMove;
  onSelect: (move: NextMove) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(move)}
      className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-2 text-left text-xs text-[var(--color-text-primary)] hover:border-[var(--color-accent-primary)]/40 hover:text-[var(--color-accent-primary)] transition-colors"
    >
      {move.label}
    </button>
  );
}

function StepIcon({ status }: { status: PlanStep['status'] }) {
  if (status === 'running') return <Loader2 className="h-4 w-4 animate-spin text-[var(--color-accent-primary)]" />;
  if (status === 'done') return <CheckCircle2 className="h-4 w-4 text-[var(--color-success)]" />;
  if (status === 'failed') return <AlertTriangle className="h-4 w-4 text-[var(--color-error)]" />;
  return <Circle className="h-4 w-4 text-[var(--color-text-muted)]" />;
}

function friendlyToolName(name: string): string {
  return name.replace(/^mcp__databricks__/, '').replace(/_/g, ' ');
}

function normalizeToolName(name?: string): string {
  return (name || '').replace(/^mcp__databricks__/, '');
}

function tryParseJson(text: string): unknown | null {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function isEmptyEvidenceBlock(block: EvidenceBlock): boolean {
  const raw = block.rawContent ?? block.content ?? '';
  const parsed = tryParseJson(raw);
  if (Array.isArray(parsed)) return parsed.length === 0;
  if (parsed && typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>;
    const rowsField = obj.rows ?? obj.data ?? obj.results ?? obj.records;
    if (Array.isArray(rowsField)) return rowsField.length === 0;
  }
  return false;
}

function selectInlineEvidence(story: AnalysisStory): { blocks: EvidenceBlock[]; hiddenCount: number } {
  const successful = story.evidence.filter((block) => !block.isError);
  if (successful.length === 0) return { blocks: [], hiddenCount: 0 };

  const narrativeFirst = successful.filter((block) => !NON_NARRATIVE_TOOLS.has(normalizeToolName(block.toolName)));
  const source = narrativeFirst.length > 0 ? narrativeFirst : successful;
  const nonEmpty = source.filter((block) => !isEmptyEvidenceBlock(block));
  const candidates = nonEmpty.length > 0 ? nonEmpty : source;

  const ranked = candidates
    .map((block, idx) => {
      const toolName = normalizeToolName(block.toolName);
      let score = idx;
      if (block.type === 'chart') score += 60;
      if (toolName === 'execute_sql' || toolName === 'execute_sql_multi') score += 40;
      if (block.rawContent?.startsWith('{') || block.rawContent?.startsWith('[')) score += 10;
      return { block, score };
    })
    .sort((a, b) => b.score - a.score);

  const blocks = ranked.slice(0, INLINE_EVIDENCE_LIMIT).map((entry) => entry.block);
  return { blocks, hiddenCount: Math.max(0, source.length - blocks.length) };
}

function ToolCallRow({ call }: { call: ToolCallSummary }) {
  const [open, setOpen] = useState(false);
  const expandable = Boolean(call.inputPreview);
  return (
    <li className="group/tool">
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); if (expandable) setOpen((v) => !v); }}
        className={cn(
          'flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors',
          expandable && 'hover:bg-[var(--color-bg-secondary)]/60'
        )}
      >
        <Wrench className={cn(
          'mt-0.5 h-3 w-3 shrink-0',
          call.isError ? 'text-[var(--color-error)]' : 'text-[var(--color-text-muted)]'
        )} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="text-[12px] font-medium text-[var(--color-text-primary)] capitalize">
              {friendlyToolName(call.toolName)}
            </span>
            {call.count > 1 && (
              <span className="text-[10px] tabular-nums text-[var(--color-text-muted)]">
                ×{call.count}
              </span>
            )}
          </div>
          <div className={cn(
            'truncate text-[11px]',
            call.isError ? 'text-[var(--color-error)]' : 'text-[var(--color-text-muted)]'
          )}>
            {call.resultSummary}
          </div>
        </div>
        {expandable && (
          <ChevronRight className={cn(
            'mt-1 h-3 w-3 shrink-0 text-[var(--color-text-muted)] transition-transform',
            open && 'rotate-90'
          )} />
        )}
      </button>
      {expandable && open && call.inputPreview && (
        <pre className="ml-5 mr-2 mt-1 mb-2 max-h-24 overflow-auto rounded bg-[var(--color-bg-tertiary)] px-2 py-1.5 text-[10px] leading-4 text-[var(--color-text-muted)]">
          {call.inputPreview}
        </pre>
      )}
    </li>
  );
}

function StepRow({
  step,
  isLast,
  isStreamingTail,
}: {
  step: PlanStep;
  isLast: boolean;
  isStreamingTail: boolean;
}) {
  const [expanded, setExpanded] = useState(step.status === 'running' || step.status === 'failed');
  const hasTools = step.toolCalls.length > 0;

  return (
    <li className="relative">
      {!isLast && (
        <span
          aria-hidden
          className="absolute left-[7px] top-6 bottom-0 w-px bg-[var(--color-border)]"
        />
      )}
      <div className="flex items-start gap-3 py-1.5">
        <div className="mt-0.5 shrink-0">
          <StepIcon status={step.status} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className={cn(
                'text-[13px] font-medium leading-5',
                step.status === 'done' && 'text-[var(--color-text-muted)]',
                step.status === 'running' && 'text-[var(--color-text-heading)]',
                step.status === 'pending' && 'text-[var(--color-text-muted)]',
                step.status === 'failed' && 'text-[var(--color-error)]'
              )}>
                {step.title}
              </div>
              {step.status === 'running' && step.narrative && (
                <div className="mt-0.5 text-[12px] italic text-[var(--color-accent-primary)]">
                  {step.narrative}
                </div>
              )}
              {(step.status === 'done' || step.status === 'failed') && step.finding && (
                <div className="mt-0.5 text-[12px] text-[var(--color-text-primary)]/80">
                  {step.finding}
                </div>
              )}
            </div>
            {hasTools && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v); }}
                className="shrink-0 rounded-md px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-[var(--color-text-muted)] hover:bg-[var(--color-bg-secondary)] hover:text-[var(--color-text-primary)]"
              >
                {step.toolCalls.length} tool{step.toolCalls.length === 1 ? '' : 's'}
                <ChevronDown className={cn(
                  'ml-0.5 inline h-3 w-3 transition-transform',
                  expanded && 'rotate-180'
                )} />
              </button>
            )}
          </div>
          {hasTools && expanded && (
            <ul className="mt-1.5 space-y-0.5 border-l border-[var(--color-border)]/40 pl-2">
              {step.toolCalls.map((call, idx) => (
                <ToolCallRow key={`${call.toolName}-${idx}`} call={call} />
              ))}
              {step.status === 'running' && isStreamingTail && (
                <li className="flex items-center gap-2 px-2 py-1 text-[11px] text-[var(--color-text-muted)]">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Working…
                </li>
              )}
            </ul>
          )}
        </div>
      </div>
    </li>
  );
}

function ContextLoadsFooter({ loads }: { loads: ToolCallSummary[] }) {
  if (loads.length === 0) return null;
  const totalCount = loads.reduce((acc, c) => acc + c.count, 0);
  return (
    <div className="mt-2 flex items-center gap-1.5 text-[11px] text-[var(--color-text-muted)]/80">
      <FileText className="h-3 w-3" />
      <span>
        Loaded context: {loads.map((c) => `${friendlyToolName(c.toolName)}${c.count > 1 ? ` ×${c.count}` : ''}`).join(', ')}
        {totalCount > 1 && ` · ${totalCount} reads`}
      </span>
    </div>
  );
}

function RevisionBanner({ revisions }: { revisions: PlanRevision[] }) {
  const [open, setOpen] = useState(false);
  if (revisions.length === 0) return null;
  const latest = revisions[revisions.length - 1];
  return (
    <div className="mb-3 rounded-lg border border-[var(--color-warning)]/30 bg-[var(--color-warning)]/5 px-3 py-2">
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        className="flex w-full items-center justify-between gap-2 text-left"
      >
        <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-warning)]">
          Plan revised
        </span>
        <ChevronDown className={cn('h-3 w-3 text-[var(--color-warning)] transition-transform', open && 'rotate-180')} />
      </button>
      <div className="mt-1 text-[12px] text-[var(--color-text-primary)]">{latest.reason || 'Plan was updated.'}</div>
      {open && (
        <ol className="mt-2 space-y-1 text-[11px] text-[var(--color-text-muted)] line-through">
          {latest.steps.map((step) => (
            <li key={step.id}>· {step.title}</li>
          ))}
        </ol>
      )}
    </div>
  );
}

function ConclusionCard({
  story,
}: {
  story: AnalysisStory;
}) {
  const conclusion = story.conclusion;
  const narrative = story.narrative;
  if (!conclusion) {
    const text = story.conclusionText?.trim();
    if (!text) return null;
    return (
      <div className="prose prose-xs max-w-none text-[14px] leading-7 text-[var(--color-text-primary)]">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[var(--color-accent-primary)]">
        <Sparkles className="h-3.5 w-3.5" />
        Conclusion
      </div>
      <div className="prose prose-xs max-w-none text-[14px] leading-7 text-[var(--color-text-primary)]">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{conclusion.summary}</ReactMarkdown>
      </div>
      {(narrative?.confidence || narrative?.caveat || narrative?.recommendedNextStep || narrative?.hasContradiction) && (
        <div className="space-y-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)]/40 p-3">
          {narrative?.confidence && (
            <div className="text-[11px] text-[var(--color-text-muted)]">
              Confidence: <span className="font-semibold text-[var(--color-text-primary)] capitalize">{narrative.confidence}</span>
            </div>
          )}
          {narrative?.caveat && (
            <div className="text-[12px] text-[var(--color-text-primary)]">
              Caveat: {narrative.caveat}
            </div>
          )}
          {narrative?.hasContradiction && (
            <div className="text-[12px] text-[var(--color-error)]">
              Evidence and conclusion signals conflict. Validate before acting.
            </div>
          )}
          {narrative?.recommendedNextStep && (
            <div className="text-[12px] text-[var(--color-text-primary)]">
              Recommended next step: {narrative.recommendedNextStep}
            </div>
          )}
        </div>
      )}
      {conclusion.highlights.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {conclusion.highlights.map((h, i) => (
            <div
              key={i}
              className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)]/60 px-3 py-1.5"
            >
              <div className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)]">{h.label}</div>
              <div className="text-sm font-semibold text-[var(--color-text-heading)]">{h.value}</div>
            </div>
          ))}
        </div>
      )}
      {conclusion.nextSteps.length > 0 && (
        <div>
          <div className="mb-1 text-[10px] uppercase tracking-wider text-[var(--color-text-muted)]">Suggested next steps</div>
          <ul className="space-y-0.5 text-[12px] text-[var(--color-text-primary)]">
            {conclusion.nextSteps.map((s, i) => (
              <li key={i}>· {s}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function FailureRecoveryCard({
  story,
  retryDisabled,
  onRetry,
  onViewDetails,
}: {
  story: AnalysisStory;
  retryDisabled: boolean;
  onRetry: (story: AnalysisStory) => void;
  onViewDetails: () => void;
}) {
  const failure = story.failure;
  if (!failure) return null;

  return (
    <div className="mt-4 rounded-lg border border-[var(--color-error)]/25 bg-[var(--color-error)]/[0.04] p-3">
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-error)]" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-[var(--color-text-heading)]">
            {failure.retryable ? 'Temporary service issue' : 'Analysis stopped before it could finish'}
          </div>
          <div className="mt-0.5 text-[12px] leading-5 text-[var(--color-text-muted)]">
            {failure.retryable
              ? 'The system could not finish this run. Retrying the same request is a reasonable next step.'
              : 'The run needs inspection before another attempt.'}
          </div>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {failure.retryable && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onRetry(story);
            }}
            disabled={retryDisabled}
            className="inline-flex h-8 items-center gap-1.5 rounded-md bg-[var(--color-accent-primary)] px-3 text-xs font-medium text-white transition-colors hover:bg-[var(--color-accent-primary)]/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Retry
          </button>
        )}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onViewDetails();
          }}
          className="inline-flex h-8 items-center rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-3 text-xs font-medium text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-bg-secondary)]"
        >
          View details
        </button>
      </div>
    </div>
  );
}

export function StoryCard({
  story,
  isActive,
  onSelect,
  onNextMove,
  onRetry,
  retryDisabled,
}: {
  story: AnalysisStory;
  isActive: boolean;
  onSelect: (storyId: string) => void;
  onNextMove: (move: NextMove) => void;
  onRetry: (story: AnalysisStory) => void;
  retryDisabled: boolean;
}) {
  const [stepperCollapsed, setStepperCollapsed] = useState(false);
  const isStreaming = story.status === 'discovery' || story.status === 'planning' || story.status === 'running';
  const plan = story.plan;
  const totalSteps = plan?.steps.length ?? 0;
  const doneSteps = plan?.steps.filter((s) => s.status === 'done' || s.status === 'failed').length ?? 0;
  const showStepper = !!plan;
  const showScoping = !plan && isStreaming;
  const inlineEvidence = useMemo(() => selectInlineEvidence(story), [story]);

  return (
    <article
      onClick={() => onSelect(story.id)}
      className={cn(
        'rounded-lg border bg-[var(--color-background)] p-4 transition-all',
        isActive
          ? 'border-[var(--color-accent-primary)]/50 shadow-lg shadow-[var(--color-accent-primary)]/10'
          : 'border-[var(--color-border)] hover:border-[var(--color-border)]/80'
      )}
    >
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="mb-2 flex items-center gap-2">
            <Search className="h-4 w-4 text-[var(--color-accent-primary)]" />
            <span className="text-xs font-semibold uppercase text-[var(--color-text-muted)]">
              Analysis Story
            </span>
          </div>
          <h3 className="text-sm font-semibold leading-6 text-[var(--color-text-heading)]">
            {story.question}
          </h3>
          {plan?.objective && plan.objective !== story.question && (
            <p className="mt-1 text-[12px] text-[var(--color-text-muted)]">{plan.objective}</p>
          )}
        </div>
        <StatusBadge status={story.status} />
      </header>

      {showScoping && (
        <div className="mt-4 flex items-center gap-2 rounded-lg bg-[var(--color-bg-secondary)] px-3 py-2 text-sm text-[var(--color-text-muted)]">
          <Loader2 className="h-4 w-4 animate-spin" />
          Scoping the work…
        </div>
      )}

      {showStepper && plan && (
        <section className="mt-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)]/30 p-3">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setStepperCollapsed((v) => !v); }}
            className="mb-2 flex w-full items-center justify-between gap-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)]"
          >
            <span>
              {story.status === 'done' ? `Worked through ${totalSteps} step${totalSteps === 1 ? '' : 's'}` : 'Plan'}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="tabular-nums">{doneSteps}/{totalSteps}</span>
              <ChevronDown className={cn('h-3 w-3 transition-transform', stepperCollapsed && '-rotate-90')} />
            </span>
          </button>
          {!stepperCollapsed && (
            <>
              <RevisionBanner revisions={plan.revisions} />
              <ol className="space-y-0">
                {plan.steps.map((step, idx) => (
                  <StepRow
                    key={step.id}
                    step={step}
                    isLast={idx === plan.steps.length - 1}
                    isStreamingTail={isStreaming && step.id === plan.currentStepId}
                  />
                ))}
              </ol>
              <ContextLoadsFooter loads={story.contextLoads} />
            </>
          )}
        </section>
      )}

      {inlineEvidence.blocks.length > 0 && (
        <section
          className="mt-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)]/20 p-3"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
            <FileText className="h-3.5 w-3.5" />
            Evidence
          </div>
          <div className="space-y-2">
            {inlineEvidence.blocks.map((block) => (
              <div key={block.id} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] p-3">
                <div className="text-[11px] font-medium text-[var(--color-text-heading)]">
                  {block.title}
                </div>
                <EvidenceContent block={block} />
              </div>
            ))}
          </div>
          {inlineEvidence.hiddenCount > 0 && (
            <div className="mt-2 text-[11px] text-[var(--color-text-muted)]">
              {inlineEvidence.hiddenCount} more evidence block{inlineEvidence.hiddenCount === 1 ? '' : 's'} in Inspect.
            </div>
          )}
        </section>
      )}

      <section className="mt-4">
        <ConclusionCard story={story} />
        <FailureRecoveryCard
          story={story}
          retryDisabled={retryDisabled}
          onRetry={onRetry}
          onViewDetails={() => onSelect(story.id)}
        />
        {story.status === 'error' && !story.failure && !story.conclusion && !story.conclusionText && (
          <div className="flex items-center gap-2 rounded-lg border border-[var(--color-error)]/30 bg-[var(--color-error)]/5 px-3 py-2 text-sm text-[var(--color-error)]">
            <AlertTriangle className="h-4 w-4" />
            Analysis failed.
          </div>
        )}
        {isStreaming && !story.conclusion && !story.conclusionText && !showScoping && totalSteps === 0 && (
          <div className="flex items-center gap-2 rounded-lg bg-[var(--color-bg-secondary)] px-3 py-2 text-sm text-[var(--color-text-muted)]">
            <Loader2 className="h-4 w-4 animate-spin" />
            Preparing analysis…
          </div>
        )}
      </section>

      {story.nextMoves.length > 0 && !story.failure?.retryable && (
        <section className="mt-6 border-t border-[var(--color-border)]/60 pt-4">
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase text-[var(--color-text-muted)]">
            <Pin className="h-3.5 w-3.5" />
            Next Moves
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            {story.nextMoves.slice(0, 3).map((move) => (
              <NextMoveButton key={move.id} move={move} onSelect={onNextMove} />
            ))}
          </div>
        </section>
      )}
    </article>
  );
}
