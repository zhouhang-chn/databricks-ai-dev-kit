import { FileText, GitBranch, Lightbulb, SlidersHorizontal } from 'lucide-react';
import type { AnalysisStory, NextMove } from '@/features/analysis/types';
import { cn } from '@/lib/utils';

export function RightInspectPanel({
  story,
  onNextMove,
}: {
  story?: AnalysisStory;
  onNextMove: (move: NextMove) => void;
}) {
  return (
    <aside className="hidden w-80 shrink-0 border-l border-[var(--color-border)] bg-[var(--color-bg-secondary)]/20 xl:block">
      <div className="sticky top-0 max-h-full overflow-y-auto p-4">
        <div className="mb-4 flex items-center gap-2">
          <SlidersHorizontal className="h-4 w-4 text-[var(--color-accent-primary)]" />
          <h3 className="text-sm font-semibold text-[var(--color-text-heading)]">
            Inspect
          </h3>
        </div>

        {!story ? (
          <div className="rounded-lg border border-dashed border-[var(--color-border)] p-4 text-sm text-[var(--color-text-muted)]">
            Select a story to inspect trace, evidence, context, and next moves.
          </div>
        ) : (
          <div className="space-y-5">
            <section>
              <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase text-[var(--color-text-muted)]">
                <GitBranch className="h-3.5 w-3.5" />
                Trace
              </div>
              <div className="space-y-2">
                {story.trace.length === 0 ? (
                  <p className="text-xs text-[var(--color-text-muted)]">No trace events yet.</p>
                ) : story.trace.map((step) => (
                  <div key={step.id} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] p-3">
                    <div className="flex items-center gap-2">
                      <span className={cn(
                        'h-2 w-2 rounded-full',
                        step.status === 'running' && 'bg-[var(--color-accent-primary)]',
                        step.status === 'done' && 'bg-[var(--color-success)]',
                        step.status === 'error' && 'bg-[var(--color-error)]'
                      )} />
                      <span className="text-xs font-medium text-[var(--color-text-heading)]">
                        {step.label}
                      </span>
                    </div>
                    {step.detail && (
                      <pre className="mt-2 max-h-28 overflow-auto whitespace-pre-wrap text-[11px] leading-5 text-[var(--color-text-muted)]">
                        {step.detail}
                      </pre>
                    )}
                  </div>
                ))}
              </div>
            </section>

            <section>
              <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase text-[var(--color-text-muted)]">
                <FileText className="h-3.5 w-3.5" />
                Evidence
              </div>
              <div className="space-y-2">
                {story.evidence.length === 0 ? (
                  <p className="text-xs text-[var(--color-text-muted)]">No evidence blocks yet.</p>
                ) : story.evidence.map((block) => (
                  <div key={block.id} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] p-3">
                    <div className={cn('text-xs font-medium', block.isError ? 'text-[var(--color-error)]' : 'text-[var(--color-text-heading)]')}>
                      {block.title}
                    </div>
                    <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap text-[11px] leading-5 text-[var(--color-text-muted)]">
                      {block.content}
                    </pre>
                  </div>
                ))}
              </div>
            </section>

            <section>
              <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase text-[var(--color-text-muted)]">
                <Lightbulb className="h-3.5 w-3.5" />
                Next Moves
              </div>
              <div className="space-y-2">
                {story.nextMoves.length === 0 ? (
                  <p className="text-xs text-[var(--color-text-muted)]">Next moves appear after the story completes.</p>
                ) : story.nextMoves.map((move) => (
                  <button
                    key={move.id}
                    type="button"
                    onClick={() => onNextMove(move)}
                    className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-2 text-left text-xs text-[var(--color-text-primary)] hover:border-[var(--color-accent-primary)]/40 hover:text-[var(--color-accent-primary)]"
                  >
                    {move.label}
                  </button>
                ))}
              </div>
            </section>

            <section>
              <div className="mb-2 text-xs font-semibold uppercase text-[var(--color-text-muted)]">
                Context
              </div>
              <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] p-3 text-[11px] leading-5 text-[var(--color-text-muted)]">
                <div>Conversation: {story.context.conversationId || 'pending'}</div>
                <div>Metrics: {story.context.metrics.length || 0}</div>
                <div>Dimensions: {story.context.dimensions.length || 0}</div>
                <div>Filters: {story.context.filters.length || 0}</div>
              </div>
            </section>
          </div>
        )}
      </div>
    </aside>
  );
}
