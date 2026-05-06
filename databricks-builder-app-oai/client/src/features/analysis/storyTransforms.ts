import type {
  AnalysisEvent,
  AnalysisStep,
  AnalysisStory,
  EvidenceBlock,
  NextMove,
  PlanStep,
  StoryFromMessagesOptions,
  StreamStoryEvent,
  ToolCallSummary,
} from '@/features/analysis/types';

const UTILITY_TOOL_NAMES = new Set([
  'read_project_file',
  'list_project_files',
  'grep_project_files',
  'get_project_tree',
]);

function nowIso(): string {
  return new Date().toISOString();
}

function makeId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function asText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value == null) return '';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function tryParseJson(text: string): unknown | null {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function countLabel(key: string): string {
  const normalized = key.toLowerCase();
  if (normalized.includes('row')) return 'rows';
  if (normalized.includes('catalog')) return 'catalogs';
  if (normalized.includes('table')) return 'tables';
  if (normalized.includes('schema')) return 'schemas';
  if (normalized.includes('result')) return 'results';
  return 'records';
}

function structuredSummary(value: unknown): string | null {
  if (Array.isArray(value)) {
    return value.length === 1 ? '1 record returned.' : `${value.length} records returned.`;
  }

  const record = objectRecord(value);
  if (!record) return null;

  for (const key of ['items', 'rows', 'data', 'results', 'records', 'catalogs', 'schemas', 'tables']) {
    const child = record[key];
    if (Array.isArray(child)) {
      const label = countLabel(key);
      return child.length === 1 ? `1 ${label.slice(0, -1)} returned.` : `${child.length} ${label} returned.`;
    }
  }

  const message = record.message || record.summary || record.text;
  if (typeof message === 'string' && message.trim()) {
    const trimmed = message.trim();
    return trimmed.length > 80 ? `${trimmed.slice(0, 77)}...` : trimmed;
  }

  const keys = Object.keys(record);
  if (keys.length > 0) {
    return keys.length === 1
      ? '1 field returned.'
      : `${keys.length} fields returned.`;
  }

  return 'Tool completed.';
}

function cleanToolError(text: string): string {
  const xmlMatch = text.match(/<tool_use_error>(.*?)<\/tool_use_error>/s);
  const cleaned = (xmlMatch ? xmlMatch[1] : text).trim();
  if (!cleaned) return 'Tool failed.';
  return cleaned.length > 120 ? `${cleaned.slice(0, 117)}...` : cleaned;
}

function summarizeToolResult(content: unknown, isError: boolean): string {
  const text = asText(content).trim();
  if (isError) return cleanToolError(text);

  const parsed = typeof content === 'string' ? tryParseJson(content) : content;
  const summary = structuredSummary(parsed);
  if (summary) return summary;

  if (!text) return 'Done.';
  // Don't dump multi-line or markdown payloads inline — they belong in the inspector.
  if (text[0] === '{' || text[0] === '[' || text.includes('\n')) return 'Returned structured data.';
  return text.length > 80 ? `${text.slice(0, 77)}...` : text;
}

function summarizeToolInput(toolName: string, raw: string): string | undefined {
  if (!raw) return undefined;
  if (toolName === 'execute_sql' || toolName === 'execute_sql_multi') {
    const parsed = tryParseJson(raw) as Record<string, unknown> | null;
    const sql = parsed && (parsed.sql_query ?? parsed.query ?? parsed.sql);
    if (typeof sql === 'string') {
      const firstLine = sql.split('\n').map((line) => line.trim()).find((line) => line.length > 0) || sql;
      return firstLine.length > 80 ? `${firstLine.slice(0, 77)}...` : firstLine;
    }
  }
  if (toolName === 'execute_code') {
    const parsed = tryParseJson(raw) as Record<string, unknown> | null;
    const code = parsed && (parsed.code ?? parsed.script);
    if (typeof code === 'string') {
      const firstLine = code.split('\n').map((line) => line.trim()).find((line) => line.length > 0) || code;
      return firstLine.length > 80 ? `${firstLine.slice(0, 77)}...` : firstLine;
    }
  }
  // For project file tools, surface the path
  const parsed = tryParseJson(raw) as Record<string, unknown> | null;
  if (parsed && typeof parsed.path === 'string') return parsed.path;
  return undefined;
}

function unescapePythonReprText(text: string): string {
  return text
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\'/g, "'")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\');
}

function cleanAssistantText(text?: string): string | undefined {
  if (!text) return text;
  if (!text.includes('ResponseOutputText(')) return text;

  const withoutEmptySdkBlocks = text.replace(
    /"?ResponseOutputText\(annotations=\[\], text=(['"])\1, type=['"]output_text['"], logprobs=\[\]\)"?/g,
    ''
  );
  const match = withoutEmptySdkBlocks.match(/text=(['"])([\s\S]*?)\1\s*,\s*type=/);
  const cleaned = match ? unescapePythonReprText(match[2]) : withoutEmptySdkBlocks;
  return cleaned.trim() || text;
}

function defaultNextMoves(question: string): NextMove[] {
  return [
    {
      id: makeId('move-explain'),
      label: 'Explain evidence',
      prompt: `Explain the evidence and assumptions behind this result: ${question}`,
      actionType: 'explain',
      source: 'heuristic',
    },
    {
      id: makeId('move-drill'),
      label: 'Drill down',
      prompt: `Drill down into the most important segment or dimension for: ${question}`,
      actionType: 'drill',
      source: 'heuristic',
    },
    {
      id: makeId('move-validate'),
      label: 'Validate',
      prompt: `Validate the data sources, caveats, and confidence for: ${question}`,
      actionType: 'validate',
      source: 'heuristic',
    },
  ];
}

function nextMoveType(value: unknown): NextMove['actionType'] {
  return (
    value === 'drill'
    || value === 'compare'
    || value === 'validate'
    || value === 'explain'
    || value === 'pivot'
  ) ? value : 'pivot';
}

function nextMoveSource(value: unknown): NextMove['source'] {
  return value === 'model' || value === 'heuristic' ? value : undefined;
}

function nextMoveConfidence(value: unknown): number | undefined {
  if (typeof value !== 'number' || Number.isNaN(value)) return undefined;
  return Math.max(0, Math.min(value, 1));
}

export function createAnalysisStory(args: {
  id?: string;
  conversationId?: string;
  question: string;
  status?: AnalysisStory['status'];
  conclusionText?: string;
  messageIds?: string[];
}): AnalysisStory {
  const timestamp = nowIso();
  const conclusionText = cleanAssistantText(args.conclusionText);
  const status = args.status || 'discovery';
  return {
    id: args.id || makeId('story'),
    conversationId: args.conversationId,
    question: args.question,
    status,
    contextLoads: [],
    conclusionText,
    evidence: [],
    trace: [],
    nextMoves: status === 'done' ? defaultNextMoves(args.question) : [],
    context: {
      conversationId: args.conversationId,
      messageIds: args.messageIds || [],
      metrics: [],
      dimensions: [],
      filters: [],
    },
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function storiesFromMessages({
  messages,
  messageTools = {},
}: StoryFromMessagesOptions): AnalysisStory[] {
  const stories: AnalysisStory[] = [];
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (message.role !== 'user') continue;

    const assistant = messages.slice(index + 1).find((candidate) => candidate.role === 'assistant');
    const story = createAnalysisStory({
      id: `story-${message.id}`,
      conversationId: message.conversation_id,
      question: message.content,
      status: assistant?.is_error ? 'error' : assistant ? 'done' : 'discovery',
      conclusionText: assistant?.content,
      messageIds: assistant ? [message.id, assistant.id] : [message.id],
    });

    const tools = assistant ? messageTools[assistant.id] || [] : [];
    story.trace = tools.map((toolName) => ({
      id: makeId('trace-tool'),
      label: toolName.replace(/^mcp__databricks__/, '').replace(/_/g, ' '),
      status: 'done',
      createdAt: assistant?.timestamp || story.createdAt,
      completedAt: assistant?.timestamp || story.updatedAt,
    }));

    stories.push(story);
  }
  return stories;
}

function updateStory(
  stories: AnalysisStory[],
  storyId: string,
  updater: (story: AnalysisStory) => AnalysisStory
): AnalysisStory[] {
  return stories.map((story) => (story.id === storyId ? updater(story) : story));
}

function appendTrace(story: AnalysisStory, step: AnalysisStep): AnalysisStory {
  return {
    ...story,
    status: story.status === 'done' || story.status === 'error' ? story.status : 'running',
    trace: [...story.trace, step],
    updatedAt: nowIso(),
  };
}

function appendEvidence(story: AnalysisStory, block: EvidenceBlock): AnalysisStory {
  return {
    ...story,
    evidence: [...story.evidence, block],
    updatedAt: nowIso(),
  };
}

function attachToolCall(
  story: AnalysisStory,
  toolName: string,
  inputPreview: string | undefined
): AnalysisStory {
  const summary: ToolCallSummary = {
    toolName,
    count: 1,
    inputPreview,
    resultSummary: '…',
  };
  // Utility reads before plan creation → contextLoads footer
  if (UTILITY_TOOL_NAMES.has(toolName) && (!story.plan || !story.plan.currentStepId)) {
    return mergeOrAppendSummary(story, summary, 'context');
  }
  if (!story.plan || !story.plan.currentStepId) {
    // No active step yet — buffer as context until the agent commits to a step
    return mergeOrAppendSummary(story, summary, 'context');
  }
  return mergeOrAppendSummary(story, summary, 'step');
}

function mergeOrAppendSummary(
  story: AnalysisStory,
  summary: ToolCallSummary,
  target: 'step' | 'context'
): AnalysisStory {
  if (target === 'context') {
    const existing = story.contextLoads.findIndex((s) => s.toolName === summary.toolName && !s.evidenceId);
    let nextLoads: ToolCallSummary[];
    if (existing >= 0) {
      nextLoads = story.contextLoads.map((s, idx) => idx === existing ? { ...s, count: s.count + 1, inputPreview: s.inputPreview ?? summary.inputPreview } : s);
    } else {
      nextLoads = [...story.contextLoads, summary];
    }
    return { ...story, contextLoads: nextLoads, updatedAt: nowIso() };
  }
  // step target — find currentStep and append/merge there
  if (!story.plan || !story.plan.currentStepId) return story;
  const currentId = story.plan.currentStepId;
  const nextSteps = story.plan.steps.map((step) => {
    if (step.id !== currentId) return step;
    const existing = step.toolCalls.findIndex((s) => s.toolName === summary.toolName && !s.evidenceId);
    if (existing >= 0) {
      const updated = step.toolCalls.map((s, idx) => idx === existing ? {
        ...s,
        count: s.count + 1,
        inputPreview: s.inputPreview ?? summary.inputPreview,
      } : s);
      return { ...step, toolCalls: updated };
    }
    return { ...step, toolCalls: [...step.toolCalls, summary] };
  });
  return {
    ...story,
    plan: { ...story.plan, steps: nextSteps },
    updatedAt: nowIso(),
  };
}

function fillResultOnLastPending(
  story: AnalysisStory,
  resultSummary: string,
  evidenceId: string | undefined,
  isError: boolean
): AnalysisStory {
  const fillIn = (calls: ToolCallSummary[]): ToolCallSummary[] => {
    for (let i = calls.length - 1; i >= 0; i -= 1) {
      if (!calls[i].evidenceId) {
        const updated = [...calls];
        updated[i] = { ...calls[i], resultSummary, evidenceId, isError };
        return updated;
      }
    }
    return calls;
  };

  if (story.plan && story.plan.currentStepId) {
    const nextSteps = story.plan.steps.map((step) =>
      step.id === story.plan!.currentStepId
        ? { ...step, toolCalls: fillIn(step.toolCalls) }
        : step
    );
    // Did we actually fill anything in the active step? If yes, return.
    const stepCalls = story.plan.steps.find((s) => s.id === story.plan!.currentStepId)?.toolCalls ?? [];
    const hadPending = stepCalls.some((c) => !c.evidenceId);
    if (hadPending) {
      return { ...story, plan: { ...story.plan, steps: nextSteps }, updatedAt: nowIso() };
    }
  }
  // Otherwise, try contextLoads (utility tool result before plan creation)
  return { ...story, contextLoads: fillIn(story.contextLoads), updatedAt: nowIso() };
}

export function reduceAnalysisEvent(
  stories: AnalysisStory[],
  event: AnalysisEvent
): AnalysisStory[] {
  switch (event.type) {
    case 'story.created':
      return [...stories, event.story];
    case 'story.attach_conversation':
      return updateStory(stories, event.storyId, (story) => ({
        ...story,
        conversationId: event.conversationId,
        context: { ...story.context, conversationId: event.conversationId },
        updatedAt: nowIso(),
      }));
    case 'plan.created':
      return updateStory(stories, event.storyId, (story) => {
        // If we already have a plan with steps, and the new event has no steps,
        // it might be a redundant "final" call from the agent. Ignore it to preserve state.
        const currentSteps = story.plan?.steps || [];
        const incomingSteps = Array.isArray(event.steps) ? event.steps : [];
        if (currentSteps.length > 0 && incomingSteps.length === 0) {
          return {
            ...story,
            plan: {
              ...story.plan!,
              objective: event.objective || story.plan!.objective,
            },
            updatedAt: nowIso(),
          };
        }

        return {
          ...story,
          status: 'planning',
          // If the question is generic, use the objective as the question
          question: (story.question === 'New Chat' || !story.question) && event.objective 
            ? event.objective 
            : story.question,
          plan: {
            objective: event.objective,
            steps: incomingSteps.map((s, i) => ({
              id: String(s.id || `step-${i + 1}`),
              title: String(s.title || `Step ${i + 1}`),
              status: 'pending',
              toolCalls: [],
            })),
            currentStepId: undefined,
            revisions: story.plan?.revisions ?? [],
          },
          updatedAt: nowIso(),
        };
      });
    case 'plan.step_started':
      return updateStory(stories, event.storyId, (story) => {
        if (!story.plan) return story;
        const startedAt = nowIso();
        const nextSteps = story.plan.steps.map((step) =>
          step.id === event.stepId
            ? { ...step, status: 'running' as const, narrative: event.narrative, startedAt }
            : step
        );
        return {
          ...story,
          status: 'running',
          plan: { ...story.plan, steps: nextSteps, currentStepId: event.stepId },
          updatedAt: startedAt,
        };
      });
    case 'plan.step_finished':
      return updateStory(stories, event.storyId, (story) => {
        if (!story.plan) return story;
        const finishedAt = nowIso();
        const nextSteps: PlanStep[] = story.plan.steps.map((step) =>
          step.id === event.stepId
            ? {
              ...step,
              status: event.status === 'failed' ? 'failed' : 'done',
              finding: event.finding,
              finishedAt,
            }
            : step
        );
        const nextCurrent = story.plan.currentStepId === event.stepId ? undefined : story.plan.currentStepId;
        return {
          ...story,
          plan: { ...story.plan, steps: nextSteps, currentStepId: nextCurrent },
          updatedAt: finishedAt,
        };
      });
    case 'plan.revised':
      return updateStory(stories, event.storyId, (story) => {
        const prior = story.plan;
        const nextRevisions = prior
          ? [...prior.revisions, { steps: prior.steps, reason: event.reason, revisedAt: nowIso() }]
          : [];
        return {
          ...story,
          status: 'planning',
          plan: {
            objective: prior?.objective ?? '',
            steps: event.steps.map((s) => ({
              id: s.id,
              title: s.title,
              status: 'pending' as const,
              toolCalls: [],
            })),
            currentStepId: undefined,
            revisions: nextRevisions,
          },
          updatedAt: nowIso(),
        };
      });
    case 'synthesis.appended':
      return updateStory(stories, event.storyId, (story) => {
        const incomingHighlights = Array.isArray(event.highlights) ? event.highlights : [];
        const incomingNextSteps = Array.isArray(event.nextSteps) ? event.nextSteps : [];
        
        return {
          ...story,
          status: story.status === 'error' ? 'error' : 'done',
          conclusion: {
            summary: event.summary || story.conclusion?.summary || '',
            // If the incoming highlights are empty, preserve the previous ones
            highlights: incomingHighlights.length > 0 
              ? incomingHighlights 
              : (story.conclusion?.highlights || []),
            // If the incoming next steps are empty, preserve the previous ones
            nextSteps: incomingNextSteps.length > 0
              ? incomingNextSteps
              : (story.conclusion?.nextSteps || []),
          },
          nextMoves: story.nextMoves.length > 0 ? story.nextMoves : defaultNextMoves(story.question),
          updatedAt: nowIso(),
        };
      });
    case 'plan.tool_call':
      return updateStory(stories, event.storyId, (story) =>
        attachToolCall(story, event.toolName, event.toolInput)
      );
    case 'plan.tool_result':
      return updateStory(stories, event.storyId, (story) =>
        fillResultOnLastPending(story, event.resultSummary, event.evidenceId, event.isError)
      );
    case 'conclusion.appended':
      return updateStory(stories, event.storyId, (story) => ({
        ...story,
        status: story.status === 'done' || story.status === 'error' ? story.status : 'running',
        conclusionText: `${story.conclusionText || ''}${event.text}`,
        updatedAt: nowIso(),
      }));
    case 'thinking.appended':
      return updateStory(stories, event.storyId, (story) => {
        const lastTrace = story.trace[story.trace.length - 1];
        if (lastTrace && lastTrace.label === 'Thinking...' && lastTrace.status === 'running') {
          // Update the last thinking step
          const updatedTrace = [...story.trace];
          updatedTrace[updatedTrace.length - 1] = {
            ...lastTrace,
            content: (lastTrace as any).content ? (lastTrace as any).content + event.text : event.text,
            updatedAt: nowIso(),
          } as any;
          return { ...story, trace: updatedTrace, updatedAt: nowIso() };
        }
        // Create a new thinking step
        return appendTrace(story, {
          id: makeId('thinking'),
          label: 'Thinking...',
          status: 'running',
          content: event.text,
          createdAt: nowIso(),
        } as any);
      });
    case 'trace.appended':
      return updateStory(stories, event.storyId, (story) => appendTrace(story, event.step));
    case 'evidence.appended':
      return updateStory(stories, event.storyId, (story) => appendEvidence(story, event.block));
    case 'next_moves.updated':
      return updateStory(stories, event.storyId, (story) => ({
        ...story,
        nextMoves: event.moves,
        updatedAt: nowIso(),
      }));
    case 'story.completed':
      return updateStory(stories, event.storyId, (story) => ({
        ...story,
        status: story.status === 'error' ? 'error' : 'done',
        nextMoves: story.nextMoves.length > 0 ? story.nextMoves : defaultNextMoves(story.question),
        updatedAt: nowIso(),
      }));
    case 'story.failed':
      return updateStory(stories, event.storyId, (story) => appendEvidence({
        ...story,
        status: 'error',
        conclusionText: story.conclusionText || event.error,
      }, {
        id: makeId('evidence-error'),
        type: 'error',
        title: 'Error',
        content: event.error,
        isError: true,
        createdAt: nowIso(),
      }));
    default:
      return stories;
  }
}

export function storyEventsFromStreamEvent(
  storyId: string,
  event: StreamStoryEvent
): AnalysisEvent[] {
  const type = String(event.type || '');

  // Plan / synthesis events from the runtime — these are the structured signals
  // produced by update_plan / submit_conclusion. Render them as plan transitions
  // and as native fields on the story; never as activity rows.
  if (type === 'plan.created') {
    const rawSteps = event.steps;
    let steps: any[] = [];
    if (Array.isArray(rawSteps)) {
      steps = rawSteps;
    } else if (typeof rawSteps === 'string') {
      steps = tryParseJson(rawSteps) as any[] || [];
    }
    
    const formattedSteps = steps.map((s, i) => ({
      id: String(s.id || `step-${i + 1}`),
      title: String(s.title || s.description || `Step ${i + 1}`),
    }));
    return [{ type: 'plan.created', storyId, objective: String(event.objective || ''), steps: formattedSteps }];
  }
  if (type === 'plan.step_started') {
    return [{
      type: 'plan.step_started',
      storyId,
      stepId: String(event.step_id || ''),
      narrative: String(event.narrative || ''),
    }];
  }
  if (type === 'plan.step_finished') {
    const status = String(event.status || 'done') === 'failed' ? 'failed' : 'done';
    return [{
      type: 'plan.step_finished',
      storyId,
      stepId: String(event.step_id || ''),
      finding: String(event.finding || ''),
      status,
    }];
  }
  if (type === 'plan.revised') {
    const steps = Array.isArray(event.steps)
      ? (event.steps as Array<Record<string, unknown>>).map((s, i) => ({
        id: String(s.id || `step-${i + 1}`),
        title: String(s.title || s.description || `Step ${i + 1}`),
      }))
      : [];
    return [{ type: 'plan.revised', storyId, steps, reason: String(event.reason || '') }];
  }
  if (type === 'synthesis.appended') {
    const highlights = Array.isArray(event.highlights)
      ? (event.highlights as Array<Record<string, unknown>>).map((h) => ({
        label: String(h.label || ''),
        value: String(h.value || ''),
      })).filter((h) => h.label || h.value)
      : [];
    const nextSteps = Array.isArray(event.next_steps)
      ? (event.next_steps as unknown[]).map((s) => String(s)).filter(Boolean)
      : [];
    return [{
      type: 'synthesis.appended',
      storyId,
      summary: String(event.summary || ''),
      highlights,
      nextSteps,
    }];
  }

  if (type === 'conversation.created' && typeof event.conversation_id === 'string') {
    return [{ type: 'story.attach_conversation', storyId, conversationId: event.conversation_id }];
  }
  if (type === 'thinking' || type === 'thinking_delta') {
    const text = String(event.thinking || event.delta || event.text || '');
    if (text) {
      return [{ type: 'thinking.appended', storyId, text }];
    }
  }
  if ((type === 'text_delta' || type === 'text') && event.text) {
    return [{ type: 'conclusion.appended', storyId, text: String(event.text) }];
  }
  if (type === 'thinking' && event.thinking) {
    const text = String(event.thinking);
    return [{
      type: 'trace.appended',
      storyId,
      step: {
        id: makeId('trace-thinking'),
        label: 'Thinking',
        status: 'running',
        detail: text,
        createdAt: nowIso(),
      },
    }];
  }
  if (type === 'tool_use') {
    const toolName = String(event.tool_name || 'tool');
    const toolInput = asText(event.tool_input);
    const friendlyName = toolName.replace(/^mcp__databricks__/, '').replace(/_/g, ' ');
    const inputPreview = summarizeToolInput(toolName.replace(/^mcp__databricks__/, ''), toolInput);
    return [
      {
        type: 'trace.appended',
        storyId,
        step: {
          id: String(event.tool_id || makeId('trace-tool')),
          label: friendlyName,
          status: 'running',
          detail: toolInput,
          createdAt: nowIso(),
        },
      },
      {
        type: 'plan.tool_call',
        storyId,
        toolName: toolName.replace(/^mcp__databricks__/, ''),
        toolInput: inputPreview,
        toolCallId: typeof event.tool_id === 'string' ? event.tool_id : undefined,
      },
    ];
  }
  if (type === 'tool_result') {
    const isError = Boolean(event.is_error);
    const summary = summarizeToolResult(event.content, isError);
    const rawContent = asText(event.content);
    const toolName = typeof event.tool_name === 'string' ? event.tool_name : undefined;
    const toolInput = event.tool_input != null ? asText(event.tool_input) : undefined;
    const friendlyName = toolName?.replace(/^mcp__databricks__/, '');
    const evidenceId = makeId('evidence-tool');
    return [
      {
        type: 'evidence.appended',
        storyId,
        block: {
          id: evidenceId,
          type: isError ? 'error' : 'tool_result',
          title: isError
            ? `${friendlyName || 'Tool'} (error)`
            : friendlyName || 'Tool result',
          content: summary,
          rawContent,
          isError,
          createdAt: nowIso(),
          toolName,
          toolInput,
        },
      },
      {
        type: 'plan.tool_result',
        storyId,
        toolCallId: typeof event.tool_use_id === 'string' ? event.tool_use_id : undefined,
        resultSummary: summary,
        evidenceId,
        isError,
      },
    ];
  }
  if (type === 'todos' && Array.isArray(event.todos)) return [];
  if (type === 'next_moves.updated' && Array.isArray(event.moves)) {
    const moves = (event.moves as Array<Record<string, unknown>>)
      .filter((move) => move.label || move.prompt)
      .slice(0, 3)
      .map((move, index) => ({
        id: String(move.id || makeId(`move-${index}`)),
        label: String(move.label || move.prompt || 'Next move'),
        prompt: String(move.prompt || move.label || ''),
        actionType: nextMoveType(move.actionType),
        intent: typeof move.intent === 'string' ? move.intent : undefined,
        confidence: nextMoveConfidence(move.confidence),
        requiresConfirmation: Boolean(move.requiresConfirmation),
        source: nextMoveSource(move.source),
      }));
    return moves.length > 0 ? [{ type: 'next_moves.updated', storyId, moves }] : [];
  }
  if (type === 'result') {
    return [{ type: 'story.completed', storyId }];
  }
  if (type === 'error') {
    return [{ type: 'story.failed', storyId, error: String(event.error || 'Unknown error') }];
  }
  return [];
}

/**
 * Translate stored stream events back into analysis events when reloading
 * a conversation. Skips text/thinking/conversation events because the
 * assistant text is already persisted as the message body — replaying it
 * would double-append.
 */
export function replayStoredEventsForStory(
  storyId: string,
  storedEvents: unknown[]
): AnalysisEvent[] {
  const skipped = new Set([
    'text_delta',
    'text',
    'thinking',
    'thinking_delta',
    'conversation.created',
    'story.created',
    'cancelled',
    'keepalive',
  ]);
  const out: AnalysisEvent[] = [];
  for (const raw of storedEvents) {
    if (!raw || typeof raw !== 'object') continue;
    const event = raw as StreamStoryEvent;
    const type = String((event as { type?: unknown }).type || '');
    if (skipped.has(type)) continue;
    out.push(...storyEventsFromStreamEvent(storyId, event));
  }
  return out;
}
