import type {
  AnalysisEvent,
  AnalysisStep,
  AnalysisStory,
  EvidenceBlock,
  NextMove,
  StoryFromMessagesOptions,
  StreamStoryEvent,
  TodoLike,
} from '@/features/analysis/types';

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
  if (typeof message === 'string' && message.trim()) return message.trim();

  const keys = Object.keys(record);
  if (keys.length > 0) {
    return keys.length === 1
      ? 'Tool completed and returned 1 field.'
      : `Tool completed and returned ${keys.length} fields.`;
  }

  return 'Tool completed.';
}

function cleanToolError(text: string): string {
  const xmlMatch = text.match(/<tool_use_error>(.*?)<\/tool_use_error>/s);
  const cleaned = (xmlMatch ? xmlMatch[1] : text).trim();
  if (!cleaned) return 'Tool failed.';
  return cleaned.length > 320 ? `${cleaned.slice(0, 317)}...` : cleaned;
}

function summarizeToolResult(content: unknown, isError: boolean): string {
  const text = asText(content).trim();
  if (isError) return cleanToolError(text);

  const parsed = typeof content === 'string' ? tryParseJson(content) : content;
  const summary = structuredSummary(parsed);
  if (summary) return summary;

  if (!text) return 'Tool completed without a visible result.';
  if (text[0] === '{' || text[0] === '[') return 'Tool completed and returned structured data.';
  return text.length > 320 ? `${text.slice(0, 317)}...` : text;
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
    },
    {
      id: makeId('move-drill'),
      label: 'Drill down',
      prompt: `Drill down into the most important segment or dimension for: ${question}`,
      actionType: 'drill',
    },
    {
      id: makeId('move-validate'),
      label: 'Validate',
      prompt: `Validate the data sources, caveats, and confidence for: ${question}`,
      actionType: 'validate',
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

export function createAnalysisStory(args: {
  id?: string;
  conversationId?: string;
  question: string;
  status?: AnalysisStory['status'];
  conclusion?: string;
  messageIds?: string[];
}): AnalysisStory {
  const timestamp = nowIso();
  const conclusion = cleanAssistantText(args.conclusion);
  return {
    id: args.id || makeId('story'),
    conversationId: args.conversationId,
    question: args.question,
    status: args.status || 'planning',
    conclusion,
    evidence: conclusion ? [{
      id: makeId('evidence-answer'),
      type: 'text',
      title: 'Answer',
      content: conclusion,
      createdAt: timestamp,
    }] : [],
    trace: [],
    nextMoves: args.status === 'done' ? defaultNextMoves(args.question) : [],
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
      status: assistant?.is_error ? 'error' : assistant ? 'done' : 'planning',
      conclusion: assistant?.content,
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
    status: story.status === 'planning' ? 'running' : story.status,
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
    case 'conclusion.appended':
      return updateStory(stories, event.storyId, (story) => ({
        ...story,
        status: 'running',
        conclusion: `${story.conclusion || ''}${event.text}`,
        updatedAt: nowIso(),
      }));
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
        conclusion: story.conclusion || event.error,
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
  if (type === 'conversation.created' && typeof event.conversation_id === 'string') {
    return [{ type: 'story.attach_conversation', storyId, conversationId: event.conversation_id }];
  }
  if ((type === 'text_delta' || type === 'text') && event.text) {
    return [{ type: 'conclusion.appended', storyId, text: String(event.text) }];
  }
  if (type === 'thinking' && event.thinking) {
    return [{
      type: 'trace.appended',
      storyId,
      step: {
        id: makeId('trace-thinking'),
        label: 'Thinking',
        status: 'running',
        detail: String(event.thinking),
        createdAt: nowIso(),
      },
    }];
  }
  if (type === 'tool_use') {
    const toolName = String(event.tool_name || 'tool');
    return [{
      type: 'trace.appended',
      storyId,
      step: {
        id: String(event.tool_id || makeId('trace-tool')),
        label: toolName.replace(/^mcp__databricks__/, '').replace(/_/g, ' '),
        status: 'running',
        detail: asText(event.tool_input),
        createdAt: nowIso(),
      },
    }];
  }
  if (type === 'tool_result') {
    const isError = Boolean(event.is_error);
    const content = summarizeToolResult(event.content, isError);
    return [{
      type: 'evidence.appended',
      storyId,
      block: {
        id: makeId('evidence-tool'),
        type: isError ? 'error' : 'tool_result',
        title: isError ? 'Tool error' : 'Tool result',
        content,
        isError,
        createdAt: nowIso(),
      },
    }];
  }
  if (type === 'todos' && Array.isArray(event.todos)) {
    const moves = (event.todos as TodoLike[])
      .filter((todo) => todo.content)
      .slice(0, 3)
      .map((todo, index) => ({
        id: makeId(`move-todo-${index}`),
        label: todo.content,
        prompt: todo.content,
        actionType: 'pivot' as const,
      }));
    return moves.length > 0 ? [{ type: 'next_moves.updated', storyId, moves }] : [];
  }
  if (type === 'next_moves.updated' && Array.isArray(event.moves)) {
    const moves = (event.moves as Array<Record<string, unknown>>)
      .filter((move) => move.label || move.prompt)
      .slice(0, 3)
      .map((move, index) => ({
        id: String(move.id || makeId(`move-${index}`)),
        label: String(move.label || move.prompt || 'Next move'),
        prompt: String(move.prompt || move.label || ''),
        actionType: nextMoveType(move.actionType),
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
