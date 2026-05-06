import { FileText, GitBranch, SlidersHorizontal } from 'lucide-react';
import type { AnalysisStory } from '@/features/analysis/types';
import { cn } from '@/lib/utils';
import { EvidenceContent } from './EvidenceContent';

function summarizeInputLabel(toolName?: string, toolInput?: string): string {
  if (!toolInput) return 'Show input';
  if (toolName === 'execute_sql' || toolName === 'execute_sql_multi') return 'Show SQL';
  if (toolName === 'execute_code') return 'Show code';
  return 'Show call input';
}

function prettyToolInput(toolName: string | undefined, raw: string): string {
  if (toolName === 'execute_sql' || toolName === 'execute_sql_multi') {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const sql = parsed.sql_query ?? parsed.query ?? parsed.sql;
      if (typeof sql === 'string') return sql;
    } catch { /* fall through */ }
  }
  if (toolName === 'execute_code') {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const code = parsed.code ?? parsed.script;
      if (typeof code === 'string') return code;
    } catch { /* fall through */ }
  }
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

export function RightInspectPanel({
  story,
}: {
  story?: AnalysisStory;
}) {
  return (
    <aside className="hidden h-full min-h-0 min-w-0 w-full overflow-hidden border-l border-[var(--color-border)] bg-[var(--color-bg-secondary)]/20 xl:block">
      <div className="h-full overflow-y-auto p-4 pb-8 no-scrollbar">
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
          <div className="space-y-6">
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
                    <div className={cn(
                      'flex items-center gap-1.5 font-mono text-[11px] font-medium',
                      block.isError ? 'text-[var(--color-error)]' : 'text-[var(--color-text-heading)]'
                    )}>
                      {block.title}
                    </div>
                    {block.toolInput && (
                      <details className="mt-2 group">
                        <summary className="cursor-pointer text-[10px] uppercase tracking-wide text-[var(--color-text-muted)] hover:text-[var(--color-accent-primary)]">
                          {summarizeInputLabel(block.toolName, block.toolInput)}
                        </summary>
                        <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-[var(--color-bg-tertiary)] p-2 text-[10px] leading-4 text-[var(--color-text-muted)]">
                          {prettyToolInput(block.toolName, block.toolInput)}
                        </pre>
                      </details>
                    )}
                    <EvidenceContent block={block} />
                  </div>
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
