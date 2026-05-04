import { CheckCircle2, Loader2, Pin, Search, Wrench } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { AnalysisStory, NextMove } from '@/features/analysis/types';
import { cn } from '@/lib/utils';

function StatusBadge({ status }: { status: AnalysisStory['status'] }) {
  const label = status === 'done' ? 'Done' : status === 'error' ? 'Error' : 'Running';
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-medium',
        status === 'done' && 'border-[var(--color-success)]/30 text-[var(--color-success)]',
        status === 'error' && 'border-[var(--color-error)]/30 text-[var(--color-error)]',
        status !== 'done' && status !== 'error' && 'border-[var(--color-border)] text-[var(--color-text-muted)]'
      )}
    >
      {status === 'running' || status === 'planning' ? (
        <Loader2 className="h-3 w-3 animate-spin" />
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

export function StoryCard({
  story,
  isActive,
  onSelect,
  onNextMove,
}: {
  story: AnalysisStory;
  isActive: boolean;
  onSelect: (storyId: string) => void;
  onNextMove: (move: NextMove) => void;
}) {
  const visibleTrace = story.trace.slice(-4);

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
        </div>
        <StatusBadge status={story.status} />
      </header>

      <section className="mt-4">
        <div className="mb-1 text-xs font-semibold uppercase text-[var(--color-text-muted)]">
          Conclusion
        </div>
        {story.conclusion ? (
          <div className="prose prose-xs max-w-none text-[14px] leading-7 text-[var(--color-text-primary)]">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {story.conclusion}
            </ReactMarkdown>
          </div>
        ) : (
          <div className="flex items-center gap-2 rounded-lg bg-[var(--color-bg-secondary)] px-3 py-2 text-sm text-[var(--color-text-muted)]">
            <Loader2 className="h-4 w-4 animate-spin" />
            Preparing analysis...
          </div>
        )}
      </section>

      {visibleTrace.length > 0 && (
        <section className="mt-4">
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase text-[var(--color-text-muted)]">
            <Wrench className="h-3.5 w-3.5" />
            Trace
          </div>
          <div className="flex flex-wrap gap-1.5">
            {visibleTrace.map((step) => (
              <span
                key={step.id}
                className="inline-flex max-w-full items-center gap-1.5 rounded-md bg-[var(--color-bg-secondary)] px-2 py-1 text-[11px] text-[var(--color-text-muted)]"
              >
                <span className={cn(
                  'h-1.5 w-1.5 rounded-full',
                  step.status === 'error' ? 'bg-[var(--color-error)]' : 'bg-[var(--color-success)]'
                )} />
                <span className="truncate">{step.label}</span>
              </span>
            ))}
          </div>
        </section>
      )}

      {story.nextMoves.length > 0 && (
        <section className="mt-4">
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
