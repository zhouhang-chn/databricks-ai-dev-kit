import type {
  AnalysisEvent,
  ChartSpec,
  AnalysisStep,
  AnalysisStory,
  EvidenceBlock,
  NarrativeConfidence,
  NextMove,
  PlanStep,
  StoryVisualization,
  StoryFromMessagesOptions,
  StreamStoryEvent,
  ToolCallSummary,
} from '@/features/analysis/types';
import { detectChartSpec, validateChartSpec } from '@/features/analysis/chartDetection';
import { asRowTable, coerceNumber, tryParseJson as parseJson } from '@/features/analysis/evidenceData';

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

function isEmptyStructuredResult(content: unknown): boolean {
  const parsed = typeof content === 'string' ? tryParseJson(content) : content;
  if (Array.isArray(parsed)) return parsed.length === 0;

  const record = objectRecord(parsed);
  if (!record) return false;
  for (const key of ['items', 'rows', 'data', 'results', 'records']) {
    if (Array.isArray(record[key])) return record[key].length === 0;
  }
  return false;
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

function cleanFailureMessage(message: string): string {
  return message.replace(/^error:\s*/i, '').trim();
}

function isRetryableFailureMessage(message: string): boolean {
  const normalized = message.toLowerCase();
  const retryableStatus = /<\s*(429|502|503|504)\s*>/.test(normalized)
    || /\berror code:\s*(429|502|503|504)\b/.test(normalized)
    || /\b(?:status[_\s-]*code|http)\s*[:=]?\s*(429|502|503|504)\b/.test(normalized);
  if (retryableStatus) return true;

  return (
    normalized.includes('serviceunavailable')
    || normalized.includes('too many requests')
    || normalized.includes('throttl')
    || normalized.includes('capacity limit')
    || normalized.includes('temporarily unavailable')
    || normalized.includes('timed out')
    || normalized.includes('timeout')
    || normalized.includes('stream closed')
    || normalized.includes('connection lost')
    || normalized.includes('network error')
    || normalized.includes('connection reset')
  );
}

function storyFailure(message: string): NonNullable<AnalysisStory['failure']> {
  const cleaned = cleanFailureMessage(message);
  return {
    message: cleaned || message,
    retryable: isRetryableFailureMessage(cleaned || message),
  };
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

function narrativeConfidence(value: unknown): NarrativeConfidence | undefined {
  return value === 'high' || value === 'medium' || value === 'low'
    ? value
    : undefined;
}

function parseVisualizationsPayload(raw: unknown): StoryVisualization[] {
  const parsed = typeof raw === 'string' ? tryParseJson(raw) : raw;
  if (!parsed) return [];

  const entries = Array.isArray(parsed)
    ? parsed
    : (parsed && typeof parsed === 'object' && Array.isArray((parsed as Record<string, unknown>).visualizations))
      ? (parsed as Record<string, unknown>).visualizations as unknown[]
      : [parsed];

  const out: StoryVisualization[] = [];
  for (const entry of entries) {
    const normalized = normalizeVisualizationEntry(entry);
    if (normalized) out.push(normalized);
  }
  return out;
}

function normalizeVisualizationEntry(value: unknown): StoryVisualization | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const evidenceRaw = record.evidenceId ?? record.evidence_id ?? record.primary_evidence_id;
  const sourceTitle = asNonEmptyString(
    record.sourceTitle
    ?? record.source_title
    ?? record.evidenceTitle
    ?? record.evidence_title
    ?? record.queryPurpose
    ?? record.query_purpose
    ?? record.purpose
  );
  const displayInStory = typeof (record.displayInStory ?? record.display_in_story) === 'boolean'
    ? Boolean(record.displayInStory ?? record.display_in_story)
    : undefined;
  const displayOrder = asOptionalNumber(record.displayOrder ?? record.display_order ?? record.order);
  const specInput = record.chartSpec && typeof record.chartSpec === 'object'
    ? record.chartSpec as Record<string, unknown>
    : record;

  const chartType = normalizeChartType(specInput.chartType ?? specInput.chart_type);
  const xField = asNonEmptyString(specInput.xField ?? specInput.x_field);
  const yFields = asStringList(specInput.yFields ?? specInput.y_fields);

  if (!chartType || !xField || yFields.length === 0) return null;

  const chartSpec: ChartSpec = {
    chartType,
    xField,
    yFields,
  };

  const colorField = asNonEmptyString(specInput.colorField ?? specInput.color_field);
  const sizeField = asNonEmptyString(specInput.sizeField ?? specInput.size_field);
  const xLabel = asNonEmptyString(specInput.xLabel ?? specInput.x_label);
  const yLabel = asNonEmptyString(specInput.yLabel ?? specInput.y_label);
  const title = asNonEmptyString(specInput.title);
  const insight = asNonEmptyString(specInput.insight);
  const sort = normalizeSort(specInput.sort);
  const stacked = typeof specInput.stacked === 'boolean' ? specInput.stacked : undefined;
  const showLabels = typeof specInput.showLabels === 'boolean'
    ? specInput.showLabels
    : typeof specInput.show_labels === 'boolean'
      ? specInput.show_labels
      : undefined;

  if (colorField) chartSpec.colorField = colorField;
  if (sizeField) chartSpec.sizeField = sizeField;
  if (xLabel) chartSpec.xLabel = xLabel;
  if (yLabel) chartSpec.yLabel = yLabel;
  if (title) chartSpec.title = title;
  if (insight) chartSpec.insight = insight;
  if (sort) chartSpec.sort = sort;
  if (stacked !== undefined) chartSpec.stacked = stacked;
  if (showLabels !== undefined) chartSpec.showLabels = showLabels;

  return {
    evidenceId: typeof evidenceRaw === 'string' ? evidenceRaw : undefined,
    sourceTitle,
    displayInStory,
    displayOrder,
    chartSpec,
  };
}

function normalizeChartType(value: unknown): ChartSpec['chartType'] | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'area') return 'line';
  if (normalized === 'bar' || normalized === 'line' || normalized === 'pie' || normalized === 'scatter') {
    return normalized;
  }
  return undefined;
}

function normalizeSort(value: unknown): ChartSpec['sort'] | undefined {
  return value === 'asc' || value === 'desc' || value === 'natural' ? value : undefined;
}

function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function asOptionalNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function asStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === 'string' ? item.trim() : String(item).trim()))
      .filter(Boolean);
  }
  const single = asNonEmptyString(value);
  return single ? [single] : [];
}

function parseLegacyChartSpecFromSummary(summary: string): StoryVisualization[] {
  const marker = '__chart_spec__';
  const markerIndex = summary.indexOf(marker);
  if (markerIndex < 0) return [];
  const tail = summary.slice(markerIndex + marker.length);
  const chunk = extractFirstJsonChunk(tail);
  if (!chunk) return [];
  return parseVisualizationsPayload(chunk);
}

function stripLegacyChartSpecFromSummary(summary: string): string {
  const markerIndex = summary.indexOf('__chart_spec__');
  if (markerIndex < 0) return summary;
  return summary.slice(0, markerIndex).trim();
}

function extractFirstJsonChunk(text: string): string | null {
  const start = text.search(/[[{]/);
  if (start < 0) return null;

  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }

    if (ch === '{' || ch === '[') {
      stack.push(ch);
      continue;
    }

    if (ch === '}' || ch === ']') {
      const open = stack.pop();
      if (!open) return null;
      if ((open === '{' && ch !== '}') || (open === '[' && ch !== ']')) return null;
      if (stack.length === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

function applyVisualizationsToEvidence(
  story: AnalysisStory,
  visualizations: StoryVisualization[]
): AnalysisStory {
  if (visualizations.length === 0 || story.evidence.length === 0) return story;

  const nextEvidence = [...story.evidence];
  let changed = false;

  for (const visualization of visualizations) {
    const sourceTitle = visualization.sourceTitle;
    const candidateIndexes = visualization.evidenceId
      ? nextEvidence.map((block, index) => ({ block, index }))
          .filter(({ block }) => block.id === visualization.evidenceId)
          .map(({ index }) => index)
      : sourceTitle
        ? nextEvidence.map((block, index) => ({ block, index }))
            .filter(({ block }) => titleMatches(block.title, sourceTitle))
            .map(({ index }) => index)
        : nextEvidence.map((_, index) => index);

    for (const index of candidateIndexes) {
      const block = nextEvidence[index];
      if (!block || block.isError) continue;
      const parsed = block.rawContent ? parseJson(block.rawContent) : null;
      const tabular = parsed ? asRowTable(parsed) : null;
      if (!tabular) continue;
      if (!validateChartSpec(visualization.chartSpec, tabular)) continue;

      nextEvidence[index] = {
        ...block,
        type: 'chart',
        chartSpec: visualization.chartSpec,
        displayInStory: visualization.displayInStory ?? true,
        displayOrder: visualization.displayOrder,
      };
      changed = true;
      break;
    }
  }

  if (!changed) return story;
  return {
    ...story,
    evidence: nextEvidence,
    updatedAt: nowIso(),
  };
}

function titleMatches(blockTitle: string, sourceTitle: string): boolean {
  const normalizedBlock = normalizeComparableTitle(blockTitle);
  const normalizedSource = normalizeComparableTitle(sourceTitle);
  if (!normalizedBlock || !normalizedSource) return false;
  return normalizedBlock.includes(normalizedSource) || normalizedSource.includes(normalizedBlock);
}

function normalizeComparableTitle(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

function detectNarrativeContradiction(story: AnalysisStory, insight?: string): boolean {
  if (!insight) return false;
  const primaryEvidenceId = story.narrative?.primaryEvidenceId;
  const primary = primaryEvidenceId
    ? story.evidence.find((block) => block.id === primaryEvidenceId)
    : story.evidence.find((block) => Boolean(block.chartSpec) && !block.isError);
  if (!primary || !primary.chartSpec || !primary.rawContent) return false;
  if (primary.chartSpec.chartType !== 'line' && primary.chartSpec.chartType !== 'bar') return false;

  const parsed = parseJson(primary.rawContent);
  const tabular = parsed ? asRowTable(parsed) : null;
  if (!tabular || !validateChartSpec(primary.chartSpec, tabular)) return false;

  const yField = primary.chartSpec.yFields[0];
  const series = tabular.rows
    .map((row) => coerceNumber(row[yField]))
    .filter((value): value is number => value !== undefined);
  if (series.length < 2) return false;

  const first = series[0];
  const last = series[series.length - 1];
  const delta = last - first;
  if (Math.abs(delta) < 1e-9) return false;

  const normalizedInsight = insight.toLowerCase();
  const indicatesPositive = /(increase|increased|up|higher|rise|rose|grew|growth|improv|上升|增加|增长|提升)/.test(normalizedInsight);
  const indicatesNegative = /(decrease|decreased|down|lower|drop|decline|fell|falling|worse|下降|减少|降低|下滑)/.test(normalizedInsight);
  const indicatesFlat = /(flat|stable|unchanged|no change|持平|稳定|不变)/.test(normalizedInsight);

  if (delta > 0 && indicatesNegative) return true;
  if (delta < 0 && indicatesPositive) return true;
  if (indicatesFlat) {
    const relative = Math.abs(delta) / Math.max(Math.abs(first), 1);
    if (relative > 0.05) return true;
  }
  return false;
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
    nextMoves: [],
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
    const failure = assistant?.is_error ? storyFailure(assistant.content) : undefined;
    const story = createAnalysisStory({
      id: `story-${message.id}`,
      conversationId: message.conversation_id,
      question: message.content,
      status: assistant?.is_error ? 'error' : assistant ? 'done' : 'discovery',
      conclusionText: assistant?.is_error ? undefined : assistant?.content,
      messageIds: assistant ? [message.id, assistant.id] : [message.id],
    });
    story.failure = failure;
    if (failure) {
      story.evidence.push({
        id: makeId('evidence-error'),
        type: 'error',
        title: 'Error',
        content: failure.message,
        isError: true,
        createdAt: assistant?.timestamp || story.createdAt,
      });
    }

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
        const currentSteps = story.plan?.steps || [];
        const incomingSteps = Array.isArray(event.steps) ? event.steps : [];

        // Story-scoped dedup: once a plan exists for this story, plan.created
        // is treated as redundant — only plan.revised may change the plan.
        // This shields the stepper from a model that re-emits plan.created
        // with REGRESSED content (e.g. a single "Run all analysis" step
        // after the original 3-step plan) in response to repeated
        // `plan_already_exists` redirects. The runtime also suppresses
        // duplicate plan.created at the SSE layer; this is a frontend
        // safety net so an in-flight reduce never produces a worse plan
        // than the original.
        // Each user message creates a fresh story (story-${execution_id}),
        // so this never suppresses repeated manual tests with the same
        // question/instruction — they land on a different story id.
        if (currentSteps.length > 0) {
          return {
            ...story,
            plan: {
              ...story.plan!,
              // Only refresh the objective if the new one is non-empty;
              // never replace steps via plan.created.
              objective: event.objective || story.plan!.objective,
            },
            updatedAt: nowIso(),
          };
        }
        if (incomingSteps.length === 0) {
          // First plan.created with no steps yet — nothing to render.
          return story;
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
        const incomingVisualizations = Array.isArray(event.visualizations) ? event.visualizations : [];

        const narrative = {
          ...story.narrative,
          claim: event.claim || story.narrative?.claim,
          primaryEvidenceId: event.primaryEvidenceId || story.narrative?.primaryEvidenceId,
          insight: event.insight || story.narrative?.insight,
          caveat: event.caveat || story.narrative?.caveat,
          confidence: event.confidence || story.narrative?.confidence,
          recommendedNextStep: event.recommendedNextStep || story.narrative?.recommendedNextStep,
          hasContradiction: typeof event.hasContradiction === 'boolean'
            ? event.hasContradiction
            : story.narrative?.hasContradiction,
        };

        const nextStoryBase: AnalysisStory = {
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
          narrative,
          nextMoves: story.nextMoves,
          updatedAt: nowIso(),
        };

        const withVisualizations = incomingVisualizations.length > 0
          ? applyVisualizationsToEvidence(nextStoryBase, incomingVisualizations)
          : nextStoryBase;

        const detectedContradiction = detectNarrativeContradiction(
          withVisualizations,
          withVisualizations.narrative?.insight
        );
        if (!detectedContradiction) return withVisualizations;

        return {
          ...withVisualizations,
          narrative: {
            ...withVisualizations.narrative,
            hasContradiction: true,
            confidence: withVisualizations.narrative?.confidence === 'high'
              ? 'medium'
              : withVisualizations.narrative?.confidence,
          },
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
        updatedAt: nowIso(),
      }));
    case 'story.failed':
      return updateStory(stories, event.storyId, (story) => {
        const failure = storyFailure(event.error);
        return appendEvidence({
          ...story,
          status: 'error',
          failure,
        }, {
          id: makeId('evidence-error'),
          type: 'error',
          title: 'Error',
          content: failure.message,
          isError: true,
          createdAt: nowIso(),
        });
      });
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
    const summaryRaw = String(event.summary || '');
    const rawHighlights = event.highlights;
    const parsedHighlights = typeof rawHighlights === 'string' ? tryParseJson(rawHighlights) : rawHighlights;
    const highlights = Array.isArray(parsedHighlights)
      ? (parsedHighlights as Array<Record<string, unknown>>).map((h) => ({
        label: String(h.label || ''),
        value: String(h.value || ''),
      })).filter((h) => h.label || h.value)
      : [];

    const rawNextSteps = event.next_steps;
    const parsedNextSteps = typeof rawNextSteps === 'string' ? tryParseJson(rawNextSteps) : rawNextSteps;
    const nextSteps = Array.isArray(parsedNextSteps)
      ? (parsedNextSteps as unknown[]).map((s) => String(s)).filter(Boolean)
      : [];

    const recommendedRaw = event.recommendedNextStep ?? event.recommended_next_step;
    const primaryEvidenceRaw = event.primaryEvidenceId ?? event.primary_evidence_id;
    const contradictionRaw = event.hasContradiction ?? event.has_contradiction;
    const visualizationRaw = event.visualizations ?? event.visualization_specs;

    let visualizations = parseVisualizationsPayload(visualizationRaw);
    let summary = summaryRaw;
    if (visualizations.length === 0) {
      visualizations = parseLegacyChartSpecFromSummary(summaryRaw);
      if (visualizations.length > 0) {
        summary = stripLegacyChartSpecFromSummary(summaryRaw);
      }
    }

    return [{
      type: 'synthesis.appended',
      storyId,
      summary,
      highlights,
      nextSteps,
      claim: typeof event.claim === 'string' ? event.claim : undefined,
      primaryEvidenceId: typeof primaryEvidenceRaw === 'string' ? primaryEvidenceRaw : undefined,
      insight: typeof event.insight === 'string' ? event.insight : undefined,
      caveat: typeof event.caveat === 'string' ? event.caveat : undefined,
      confidence: narrativeConfidence(event.confidence),
      recommendedNextStep: typeof recommendedRaw === 'string' ? recommendedRaw : undefined,
      hasContradiction: typeof contradictionRaw === 'boolean' ? contradictionRaw : undefined,
      visualizations: visualizations.length > 0 ? visualizations : undefined,
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
    const isEmptyResult = !isError && isEmptyStructuredResult(event.content);
    const rawContent = asText(event.content);
    const toolName = typeof event.tool_name === 'string' ? event.tool_name : undefined;
    const toolInput = event.tool_input != null ? asText(event.tool_input) : undefined;
    const friendlyName = toolName?.replace(/^mcp__databricks__/, '');
    const evidenceId = makeId('evidence-tool');

    // Extract purpose from SQL comment if available
    let purpose: string | undefined = undefined;
    const parsedInput = typeof event.tool_input === 'object' 
      ? (event.tool_input as Record<string, unknown>) 
      : (toolInput ? (tryParseJson(toolInput) as Record<string, unknown> | null) : null);
      
    if (parsedInput && typeof parsedInput === 'object') {
      const sql = parsedInput.sql_query ?? parsedInput.query ?? parsedInput.sql ?? parsedInput.sql_content;
      if (typeof sql === 'string') {
        const firstLine = sql.split('\n').map((line) => line.trim()).find((line) => line.length > 0);
        if (firstLine && firstLine.startsWith('--')) {
          purpose = firstLine.slice(2).trim();
        }
      }
    }

    const resultEvent: AnalysisEvent = {
      type: 'plan.tool_result',
      storyId,
      toolCallId: typeof event.tool_use_id === 'string' ? event.tool_use_id : undefined,
      resultSummary: summary,
      evidenceId: isEmptyResult ? undefined : evidenceId,
      isError,
    };
    if (isEmptyResult) return [resultEvent];

    const parsed = typeof event.content === 'string' ? parseJson(event.content) : event.content;
    const tabular = asRowTable(parsed);
    const chartSpec = !isError && tabular
      ? detectChartSpec(tabular, { toolName })
      : undefined;

    return [{
      type: 'evidence.appended',
      storyId,
      block: {
        id: evidenceId,
        type: isError ? 'error' : chartSpec ? 'chart' : 'tool_result',
        title: purpose || (isError
          ? `${friendlyName || 'Tool'} (error)`
          : friendlyName || 'Tool result'),
        content: summary,
        rawContent,
        isError,
        createdAt: nowIso(),
        toolName,
        toolInput,
        chartSpec,
      },
    }, resultEvent];
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
