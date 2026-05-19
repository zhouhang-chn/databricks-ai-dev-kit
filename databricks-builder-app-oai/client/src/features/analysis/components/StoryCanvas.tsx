import { Sparkles } from 'lucide-react';
import { StoryCard } from '@/features/analysis/components/StoryCard';
import type { AnalysisStory } from '@/features/analysis/types';

export function StoryCanvas({
  stories,
  activeStoryId,
  onSelectStory,
  onSuggestedNextStep,
  onRetryStory,
  retryDisabled,
  emptyTitle,
  emptyDescription,
  starterPrompts,
  onStarterPrompt,
}: {
  stories: AnalysisStory[];
  activeStoryId?: string;
  onSelectStory: (storyId: string) => void;
  onSuggestedNextStep: (step: string) => void;
  onRetryStory: (story: AnalysisStory) => void;
  retryDisabled: boolean;
  emptyTitle: string;
  emptyDescription: string;
  starterPrompts: Array<{ title: string; desc: string; prompt: string }>;
  onStarterPrompt: (prompt: string) => void;
}) {
  if (stories.length === 0) {
    return (
      <div className="flex h-full items-center justify-center px-6">
        <div className="w-full max-w-xl text-center">
          <div className="mb-6 inline-flex h-14 w-14 items-center justify-center rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
            <Sparkles className="h-7 w-7 text-[var(--color-accent-primary)]" />
          </div>
          <h3 className="text-2xl font-bold text-[var(--color-text-heading)]">
            {emptyTitle}
          </h3>
          <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-[var(--color-text-muted)]">
            {emptyDescription}
          </p>
          <div className="mt-10 grid grid-cols-2 gap-3 text-left">
            {starterPrompts.map((item) => (
              <button
                key={item.title}
                type="button"
                onClick={() => onStarterPrompt(item.prompt)}
                className="group rounded-lg border border-[var(--color-border)]/50 bg-[var(--color-background)] p-4 text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-[var(--color-accent-primary)]/30 hover:shadow-lg hover:shadow-[var(--color-accent-primary)]/5"
              >
                <span className="text-sm font-semibold text-[var(--color-text-heading)] transition-colors group-hover:text-[var(--color-accent-primary)]">
                  {item.title}
                </span>
                <p className="mt-1.5 text-xs leading-relaxed text-[var(--color-text-muted)]">
                  {item.desc}
                </p>
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-4xl px-6 py-6">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-[var(--color-text-heading)]">
            Analysis Canvas
          </h2>
        </div>
        <span className="rounded-md border border-[var(--color-border)] px-2 py-1 text-xs text-[var(--color-text-muted)]">
          {stories.length} stor{stories.length === 1 ? 'y' : 'ies'}
        </span>
      </div>
      <div className="space-y-4">
        {stories.map((story) => (
          <StoryCard
            key={story.id}
            story={story}
            isActive={story.id === activeStoryId}
            onSelect={onSelectStory}
            onSuggestedNextStep={onSuggestedNextStep}
            onRetry={onRetryStory}
            retryDisabled={retryDisabled}
          />
        ))}
      </div>
    </div>
  );
}
