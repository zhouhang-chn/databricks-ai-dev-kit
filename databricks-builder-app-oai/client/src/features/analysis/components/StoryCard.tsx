import { useState, useEffect } from 'react';
import { 
  Activity,
  Brain, 
  Check, 
  CheckCircle2, 
  ChevronDown, 
  ChevronRight, 
  Loader2, 
  Pin, 
  Search, 
  Wrench 
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { ActivityItem, AnalysisStory, NextMove } from '@/features/analysis/types';
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

function ActivityRow({ item }: { item: ActivityItem }) {
  const isThinking = item.type === 'thinking';
  const isTool = item.type === 'tool_use';
  const isResult = item.type === 'tool_result';

  return (
    <div className="flex items-start gap-2.5 py-1.5">
      <div className="mt-0.5 shrink-0">
        {isThinking ? (
          <Brain className="h-3.5 w-3.5 text-[var(--color-text-muted)]" />
        ) : isTool ? (
          <Wrench className="h-3.5 w-3.5 text-[var(--color-accent-primary)]" />
        ) : (
          <Check className="h-3.5 w-3.5 text-[var(--color-success)]" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[12px] leading-5 text-[var(--color-text-primary)]">
          {isThinking ? 'Thought for a few seconds' : item.content}
        </div>
        {(isThinking || isTool) && item.content && !isThinking && (
          <div className="mt-1 text-[11px] text-[var(--color-text-muted)] line-clamp-1 opacity-60">
            {item.content}
          </div>
        )}
      </div>
    </div>
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
  const [isExpanded, setIsExpanded] = useState(story.status !== 'done');
  
  // Auto-fold when completed
  useEffect(() => {
    if (story.status === 'done') {
      setIsExpanded(false);
    } else if (story.status === 'running') {
      setIsExpanded(true);
    }
  }, [story.status]);

  const activityCount = story.activity.length;

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

      {/* Activity Feed / Scratchpad */}
      {activityCount > 0 && (
        <section className="mt-4 overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)]/30">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setIsExpanded(!isExpanded);
            }}
            className="flex w-full items-center justify-between px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)] hover:bg-[var(--color-bg-secondary)]/50 transition-colors"
          >
            <div className="flex items-center gap-2">
              <Activity className="h-3.5 w-3.5" />
              <span>
                {story.status === 'done' ? `Worked for ${activityCount} steps` : 'Execution Activity'}
              </span>
            </div>
            {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </button>
          
          {isExpanded && (
            <div className="border-t border-[var(--color-border)] px-3 py-1 bg-[var(--color-background)]/40">
              <div className="space-y-0.5 divide-y divide-[var(--color-border)]/40">
                {story.activity.map((item) => (
                  <ActivityRow key={item.id} item={item} />
                ))}
                {story.status === 'running' && (
                  <div className="flex items-center gap-2 py-3 text-[12px] text-[var(--color-text-muted)]">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    <span>Processing...</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </section>
      )}

      <section className="mt-4">
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

      {story.nextMoves.length > 0 && (
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
