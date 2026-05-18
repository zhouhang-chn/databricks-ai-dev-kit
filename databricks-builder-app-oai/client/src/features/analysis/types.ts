import type { Message } from '@/lib/types';

export type StoryStatus = 'discovery' | 'planning' | 'running' | 'done' | 'error';
export type EvidenceType = 'text' | 'table' | 'chart' | 'tool_result' | 'error';
export type AnalysisStepStatus = 'running' | 'done' | 'error';
export type NextMoveType = 'drill' | 'compare' | 'validate' | 'explain' | 'pivot';
export type PlanStepStatus = 'pending' | 'running' | 'done' | 'failed';
export type NarrativeConfidence = 'high' | 'medium' | 'low';
export type ChartType = 'bar' | 'line' | 'area' | 'pie' | 'scatter' | 'heatmap';

export interface ChartSpec {
  chartType: ChartType;
  xField: string;
  yFields: string[];
  colorField?: string;
  sizeField?: string;
  xLabel?: string;
  yLabel?: string;
  sort?: 'asc' | 'desc' | 'natural';
  stacked?: boolean;
  showLabels?: boolean;
  title?: string;
  insight?: string;
}

export interface StoryVisualization {
  evidenceId?: string;
  chartSpec: ChartSpec;
}

export interface ToolCallSummary {
  toolName: string;
  count: number;
  inputPreview?: string;
  resultSummary: string;
  evidenceId?: string;
  isError?: boolean;
}

export interface PlanStep {
  id: string;
  title: string;
  narrative?: string;
  finding?: string;
  status: PlanStepStatus;
  toolCalls: ToolCallSummary[];
  startedAt?: string;
  finishedAt?: string;
}

export interface PlanRevision {
  steps: PlanStep[];
  reason: string;
  revisedAt: string;
}

export interface AnalysisPlan {
  objective: string;
  steps: PlanStep[];
  currentStepId?: string;
  revisions: PlanRevision[];
}

export interface ConclusionHighlight {
  label: string;
  value: string;
}

export interface Conclusion {
  summary: string;
  highlights: ConclusionHighlight[];
  nextSteps: string[];
}

export interface StoryNarrative {
  claim?: string;
  primaryEvidenceId?: string;
  insight?: string;
  caveat?: string;
  confidence?: NarrativeConfidence;
  recommendedNextStep?: string;
  hasContradiction?: boolean;
}

export interface StoryFailure {
  message: string;
  retryable: boolean;
}

export interface AnalysisContext {
  conversationId?: string;
  messageIds?: string[];
  metrics: string[];
  dimensions: string[];
  filters: string[];
  selection?: string;
}

export interface EvidenceBlock {
  id: string;
  type: EvidenceType;
  title: string;
  content: string;
  rawContent?: string;
  isError?: boolean;
  createdAt: string;
  toolName?: string;
  toolInput?: string;
  chartSpec?: ChartSpec;
}

export interface AnalysisStep {
  id: string;
  label: string;
  status: AnalysisStepStatus;
  detail?: string;
  createdAt: string;
  completedAt?: string;
}

export interface NextMove {
  id: string;
  label: string;
  prompt: string;
  actionType: NextMoveType;
  intent?: string;
  confidence?: number;
  requiresConfirmation?: boolean;
  source?: 'model' | 'heuristic';
}

export interface AnalysisStory {
  id: string;
  conversationId?: string;
  question: string;
  status: StoryStatus;
  plan?: AnalysisPlan;
  contextLoads: ToolCallSummary[];
  conclusion?: Conclusion;
  conclusionText?: string;       // raw assistant text fallback when no submit_conclusion
  evidence: EvidenceBlock[];
  trace: AnalysisStep[];
  nextMoves: NextMove[];
  narrative?: StoryNarrative;
  failure?: StoryFailure;
  context: AnalysisContext;
  createdAt: string;
  updatedAt: string;
}

export type AnalysisEvent =
  | { type: 'story.created'; story: AnalysisStory }
  | { type: 'story.attach_conversation'; storyId: string; conversationId: string }
  | { type: 'plan.created'; storyId: string; objective: string; steps: Array<{ id: string; title: string }> }
  | { type: 'plan.step_started'; storyId: string; stepId: string; narrative: string }
  | { type: 'plan.step_finished'; storyId: string; stepId: string; finding: string; status: 'done' | 'failed' }
  | { type: 'plan.revised'; storyId: string; steps: Array<{ id: string; title: string }>; reason: string }
  | { type: 'plan.tool_call'; storyId: string; toolName: string; toolInput?: string; toolCallId?: string }
  | { type: 'plan.tool_result'; storyId: string; toolCallId?: string; resultSummary: string; evidenceId?: string; isError: boolean }
  | {
    type: 'synthesis.appended';
    storyId: string;
    summary: string;
    highlights: ConclusionHighlight[];
    nextSteps: string[];
    claim?: string;
    primaryEvidenceId?: string;
    insight?: string;
    caveat?: string;
    confidence?: NarrativeConfidence;
    recommendedNextStep?: string;
    hasContradiction?: boolean;
    visualizations?: StoryVisualization[];
  }
  | { type: 'conclusion.appended'; storyId: string; text: string }
  | { type: 'thinking.appended'; storyId: string; text: string }
  | { type: 'trace.appended'; storyId: string; step: AnalysisStep }
  | { type: 'evidence.appended'; storyId: string; block: EvidenceBlock }
  | { type: 'story.completed'; storyId: string }
  | { type: 'story.failed'; storyId: string; error: string }
  | { type: 'next_moves.updated'; storyId: string; moves: NextMove[] };

export interface StoryFromMessagesOptions {
  messages: Message[];
  messageTools?: Record<string, string[]>;
}

export interface StreamStoryEvent {
  type?: unknown;
  conversation_id?: unknown;
  text?: unknown;
  tool_id?: unknown;
  tool_name?: unknown;
  tool_input?: unknown;
  tool_use_id?: unknown;
  content?: unknown;
  is_error?: unknown;
  thinking?: unknown;
  delta?: unknown;
  error?: unknown;
  todos?: unknown;
  moves?: unknown;
  // Plan / synthesis fields produced by the runtime's normalize_openai_event
  call_id?: unknown;
  step_id?: unknown;
  narrative?: unknown;
  finding?: unknown;
  status?: unknown;
  objective?: unknown;
  steps?: unknown;
  reason?: unknown;
  summary?: unknown;
  highlights?: unknown;
  next_steps?: unknown;
  claim?: unknown;
  primary_evidence_id?: unknown;
  primaryEvidenceId?: unknown;
  insight?: unknown;
  caveat?: unknown;
  confidence?: unknown;
  recommended_next_step?: unknown;
  recommendedNextStep?: unknown;
  has_contradiction?: unknown;
  hasContradiction?: unknown;
  visualizations?: unknown;
  visualization_specs?: unknown;
}
