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
  const timelineEvents = useMemo(() => {
    if (!story) return [];
    
    const events: Array<{
      id: string;
      type: 'trace' | 'evidence' | 'plan_step';
      timestamp: string;
      label: string;
      detail?: string;
      status?: string;
      durationMs?: number;
      block?: EvidenceBlock; // For evidence type
      planStep?: PlanStep;   // For plan_step type
    }> = [];

    // Add Trace steps
    story.trace.forEach(step => {
      const startTime = new Date(step.createdAt);
      const endTime = step.completedAt ? new Date(step.completedAt) : null;
      events.push({
        id: step.id,
        type: 'trace',
        timestamp: step.createdAt,
        label: step.label,
        detail: step.detail,
        status: step.status,
        durationMs: endTime ? endTime.getTime() - startTime.getTime() : undefined,
      });
    });

    // Add Evidence blocks
    story.evidence.forEach(block => {
      events.push({
        id: block.id,
        type: 'evidence',
        timestamp: block.createdAt,
        label: block.title,
        block,
      });
    });

    // Add Plan steps that have started
    story.plan?.steps.forEach(step => {
      if (step.startedAt) {
        const startTime = new Date(step.startedAt);
        const endTime = step.finishedAt ? new Date(step.finishedAt) : null;
        events.push({
          id: step.id,
          type: 'plan_step',
          timestamp: step.startedAt,
          label: `Plan Step: ${step.title}`,
          detail: step.finding || step.narrative,
          status: step.status,
          durationMs: endTime ? endTime.getTime() - startTime.getTime() : undefined,
          planStep: step,
        });
      }
    });

    // Sort by timestamp
    return events.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  }, [story]);

  return (
    <aside className="hidden h-full min-h-0 min-w-0 w-full overflow-hidden border-l border-[var(--color-border)] bg-[var(--color-bg-secondary)]/20 xl:block">
      <div className="h-full overflow-y-auto p-4 pb-8 no-scrollbar">
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <SlidersHorizontal className="h-4 w-4 text-[var(--color-accent-primary)]" />
            <h3 className="text-sm font-semibold text-[var(--color-text-heading)]">
              Inspect
            </h3>
          </div>
          {story && (
            <span className="text-[10px] font-mono text-[var(--color-text-muted)] bg-[var(--color-bg-tertiary)] px-2 py-0.5 rounded-full border border-[var(--color-border)]/50">
              {timelineEvents.length} Events
            </span>
          )}
        </div>

        {!story ? (
          <div className="rounded-lg border border-dashed border-[var(--color-border)] p-4 text-sm text-[var(--color-text-muted)]">
            Select a story to inspect the execution timeline and evidence.
          </div>
        ) : (
          <div className="space-y-8">
            <section>
              <div className="mb-6 flex items-center gap-2 text-xs font-semibold uppercase text-[var(--color-text-muted)] tracking-widest">
                <GitBranch className="h-3.5 w-3.5" />
                Execution Timeline
              </div>
              
              <div className="relative space-y-8 pl-6">
                {/* Vertical Timeline Rail */}
                <div className="absolute left-2 top-2 bottom-2 w-px bg-gradient-to-b from-[var(--color-border)]/80 via-[var(--color-border)]/60 to-transparent" />
                
                {timelineEvents.length === 0 ? (
                  <p className="text-xs text-[var(--color-text-muted)] ml-2 italic">Waiting for activity...</p>
                ) : timelineEvents.map((event, idx) => {
                  const timeStr = new Date(event.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
                  
                  return (
                    <div key={event.id} className="relative group animate-in fade-in slide-in-from-left-2 duration-300">
                      {/* Timeline Dot/Icon */}
                      <div className={cn(
                        'absolute -left-6 top-1 h-3 w-3 rounded-full border-2 border-[var(--color-bg-secondary)] ring-4 ring-transparent transition-all z-10',
                        event.type === 'plan_step' && 'bg-[var(--color-accent-primary)] ring-[var(--color-accent-primary)]/10',
                        event.type === 'trace' && (
                          event.status === 'running' ? 'bg-[var(--color-accent-primary)] animate-pulse shadow-[0_0_10px_var(--color-accent-primary)]' :
                          event.status === 'error' ? 'bg-[var(--color-error)]' : 'bg-[var(--color-success)]'
                        ),
                        event.type === 'evidence' && 'bg-white border-[var(--color-accent-primary)] scale-110 shadow-sm'
                      )}>
                        {event.type === 'evidence' && (
                          <div className="absolute inset-0 flex items-center justify-center">
                            <div className="h-1 w-1 bg-[var(--color-accent-primary)] rounded-full" />
                          </div>
                        )}
                      </div>
                      
                      <div className="flex flex-col gap-2">
                        {/* Header */}
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            {event.type === 'plan_step' && <Pin className="h-3 w-3 text-[var(--color-accent-primary)] opacity-70" />}
                            {event.type === 'evidence' && <FileText className="h-3 w-3 text-[var(--color-accent-primary)] opacity-70" />}
                            <span className={cn(
                              "text-[12px] font-semibold leading-none",
                              event.type === 'plan_step' ? "text-[var(--color-accent-primary)]" : "text-[var(--color-text-heading)]"
                            )}>
                              {event.label}
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5 opacity-40 group-hover:opacity-100 transition-opacity">
                            <span className="text-[9px] font-mono tabular-nums text-[var(--color-text-muted)]">
                              {timeStr}
                            </span>
                            {event.durationMs !== undefined && (
                              <span className="text-[9px] font-mono tabular-nums text-[var(--color-success)] bg-[var(--color-success)]/10 px-1 rounded">
                                {(event.durationMs / 1000).toFixed(1)}s
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Content */}
                        {event.type === 'evidence' && event.block && (
                          <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-background)] p-3 shadow-sm hover:shadow-md hover:border-[var(--color-border-hover)] transition-all">
                            {event.block.toolInput && (
                              <details className="mb-2 group/details">
                                <summary className="cursor-pointer text-[9px] uppercase tracking-wider text-[var(--color-text-muted)] hover:text-[var(--color-accent-primary)] flex items-center gap-1">
                                  {summarizeInputLabel(event.block.toolName, event.block.toolInput)}
                                  <ChevronRight className="h-2.5 w-2.5 transition-transform group-open/details:rotate-90" />
                                </summary>
                                <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded-lg bg-[var(--color-bg-tertiary)] p-2.5 text-[10px] leading-relaxed text-[var(--color-text-muted)] no-scrollbar font-mono">
                                  {prettyToolInput(event.block.toolName, event.block.toolInput)}
                                </pre>
                              </details>
                            )}
                            <EvidenceContent block={event.block} />
                          </div>
                        )}

                        {event.type !== 'evidence' && event.detail && (
                          <div className={cn(
                            "rounded-xl border p-3 shadow-sm hover:shadow-md transition-all",
                            event.type === 'plan_step' 
                              ? "bg-[var(--color-accent-primary)]/[0.03] border-[var(--color-accent-primary)]/20 hover:border-[var(--color-accent-primary)]/40" 
                              : "bg-[var(--color-background)] border-[var(--color-border)] hover:border-[var(--color-border-hover)]"
                          )}>
                            <pre className="max-h-32 overflow-auto whitespace-pre-wrap text-[10px] leading-relaxed text-[var(--color-text-muted)] no-scrollbar font-mono">
                              {event.detail}
                            </pre>
                            {event.type === 'plan_step' && event.planStep && event.planStep.toolCalls.length > 0 && (
                              <div className="mt-2 pt-2 border-t border-[var(--color-accent-primary)]/10 flex flex-wrap gap-1.5">
                                {event.planStep.toolCalls.map((call, cidx) => (
                                  <span key={cidx} className="text-[9px] bg-[var(--color-bg-tertiary)] text-[var(--color-text-muted)] px-1.5 py-0.5 rounded border border-[var(--color-border)]/50">
                                    {friendlyToolName(call.toolName)}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="pt-4 border-t border-[var(--color-border)]/30">
              <div className="mb-4 text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--color-text-muted)] opacity-50">
                Metadata Context
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl bg-[var(--color-bg-tertiary)]/50 p-2.5 border border-[var(--color-border)]/30">
                  <div className="text-[9px] text-[var(--color-text-muted)] mb-1">Conversation</div>
                  <div className="text-[11px] font-mono font-medium truncate">{story.context.conversationId || 'Pending'}</div>
                </div>
                <div className="rounded-xl bg-[var(--color-bg-tertiary)]/50 p-2.5 border border-[var(--color-border)]/30">
                  <div className="text-[9px] text-[var(--color-text-muted)] mb-1">Metrics</div>
                  <div className="text-[11px] font-semibold">{story.context.metrics.length}</div>
                </div>
                <div className="rounded-xl bg-[var(--color-bg-tertiary)]/50 p-2.5 border border-[var(--color-border)]/30">
                  <div className="text-[9px] text-[var(--color-text-muted)] mb-1">Dimensions</div>
                  <div className="text-[11px] font-semibold">{story.context.dimensions.length}</div>
                </div>
                <div className="rounded-xl bg-[var(--color-bg-tertiary)]/50 p-2.5 border border-[var(--color-border)]/30">
                  <div className="text-[9px] text-[var(--color-text-muted)] mb-1">Filters</div>
                  <div className="text-[11px] font-semibold">{story.context.filters.length}</div>
                </div>
              </div>
            </section>
          </div>
        )}
      </div>
    </aside>
  );
}
