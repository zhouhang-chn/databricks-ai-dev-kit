import type { Message } from '@/lib/types';

export type StoryStatus = 'planning' | 'running' | 'done' | 'error';
export type EvidenceType = 'text' | 'table' | 'chart' | 'tool_result' | 'error';
export type AnalysisStepStatus = 'running' | 'done' | 'error';
export type NextMoveType = 'drill' | 'compare' | 'validate' | 'explain' | 'pivot';

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
  conclusion?: string;
  evidence: EvidenceBlock[];
  trace: AnalysisStep[];
  nextMoves: NextMove[];
  context: AnalysisContext;
  createdAt: string;
  updatedAt: string;
}

export type AnalysisEvent =
  | { type: 'story.created'; story: AnalysisStory }
  | { type: 'story.attach_conversation'; storyId: string; conversationId: string }
  | { type: 'conclusion.appended'; storyId: string; text: string }
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
  error?: unknown;
  todos?: unknown;
  moves?: unknown;
}
