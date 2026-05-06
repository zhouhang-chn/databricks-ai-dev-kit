import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  Plus,
  MessageSquare,
  Trash2,
  ChevronLeft,
  ChevronRight,
  Loader2,
  BookOpen,
  FolderCog,
  Folder,
  FileText,
} from 'lucide-react';
import type { Conversation } from '@/lib/types';
import { useUser } from '@/contexts/UserContext';

interface SidebarProps {
  conversations: Conversation[];
  currentConversationId?: string;
  onConversationSelect: (conversationId: string) => void;
  onNewConversation: () => void;
  onDeleteConversation: (conversationId: string) => void;
  onViewSkills?: () => void;
  onOpenProjectSettings?: () => void;
  projectName?: string;
  isLoading?: boolean;
}

export function Sidebar({
  conversations,
  currentConversationId,
  onConversationSelect,
  onNewConversation,
  onDeleteConversation,
  onViewSkills,
  onOpenProjectSettings,
  projectName,
  isLoading = false,
}: SidebarProps) {
  const [hoveredConversation, setHoveredConversation] = useState<string | null>(null);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const location = useLocation();
  const { user } = useUser();
  const displayName = user?.split('@')[0] || '';

  const handleDelete = (e: React.MouseEvent, conversationId: string) => {
    e.stopPropagation();
    if (confirm('Delete this conversation?')) {
      onDeleteConversation(conversationId);
    }
  };

  return (
    <aside
      className={`
        flex flex-col bg-[var(--color-bg-secondary)] border-r border-[var(--color-border)] h-full relative transition-all duration-300 flex-shrink-0
        ${isCollapsed ? 'w-16' : 'w-[var(--sidebar-width)]'}
      `}
    >
      {/* Header — Logo + Project Name */}
      <div
        className={`flex items-center gap-2.5 border-b border-[var(--color-border)]/30 transition-all duration-300 ${isCollapsed ? 'p-2 justify-center' : 'px-4 py-3'}`}
      >
        <Link to="/" className="flex items-center gap-2.5 min-w-0">
          <div className="w-7 h-7 flex-shrink-0 flex items-center justify-center">
            <svg
              className="w-6 h-6"
              viewBox="33 0 28 31"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M59.7279 12.5153L47.2039 19.6185L33.8814 12.0502L33.251 12.3884V17.885L47.2039 25.8339L59.7279 18.7306V21.648L47.2039 28.7513L33.8814 21.1829L33.251 21.5212V22.4514L47.2039 30.4002L61.1989 22.4514V16.9548L60.5685 16.6165L47.2039 24.1849L34.7219 17.0816V14.2065L47.2039 21.2675L61.1989 13.3186V7.9066L60.4844 7.52607L47.2039 15.0521L35.3943 8.32941L47.2039 1.64897L56.9541 7.14554L57.8367 6.68044V6.00394L47.2039 0L33.251 7.9066V8.75223L47.2039 16.7011L59.7279 9.59785V12.5153Z"
                fill="#FF3621"
              />
            </svg>
          </div>
          {!isCollapsed && (
            <div className="min-w-0">
              {projectName ? (
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="text-xs text-[var(--color-text-muted)] truncate">AI Dev Kit</span>
                  <span className="text-[var(--color-text-muted)] text-xs">/</span>
                  <span className="text-sm font-semibold text-[var(--color-text-heading)] truncate">{projectName}</span>
                </div>
              ) : (
                <span className="text-sm font-semibold text-[var(--color-text-heading)]">AI Dev Kit</span>
              )}
            </div>
          )}
        </Link>
      </div>

      {/* New Chat Button */}
      <div
        className={`${isCollapsed ? 'p-2' : 'px-3 py-3'} transition-all duration-300`}
      >
        <button
          onClick={onNewConversation}
          className={`flex items-center w-full hover:bg-[var(--color-accent-primary)]/[0.08] rounded-xl transition-all duration-300 group ${isCollapsed ? 'p-2 justify-center' : 'px-3 py-2.5 gap-3'}`}
        >
          <div className="flex items-center justify-center rounded-lg bg-[var(--color-accent-primary)] text-white transition-all duration-300 shadow-sm group-hover:shadow-md group-hover:scale-105 h-8 w-8 flex-shrink-0">
            <Plus className="h-4 w-4" strokeWidth={2.5} />
          </div>
          {!isCollapsed && (
            <span className="text-[var(--color-text-heading)] font-medium text-sm transition-opacity duration-300">
              New Chat
            </span>
          )}
        </button>
      </div>

      {/* Conversations List */}
      {!isCollapsed && (
        <div className="flex-1 overflow-y-auto overflow-x-hidden px-3 pb-2">
          {isLoading ? (
            <div className="text-center py-12 text-[var(--color-text-muted)]">
              <Loader2 className="h-8 w-8 mx-auto mb-3 opacity-60 animate-spin" />
              <p className="text-sm font-medium">Loading...</p>
            </div>
          ) : conversations.length === 0 ? (
            <div className="text-center py-12 text-[var(--color-text-muted)]">
              <MessageSquare className="h-10 w-10 mx-auto mb-3 opacity-30" />
              <p className="text-xs font-medium">No conversations yet</p>
              <p className="text-[11px] mt-1 opacity-70">
                Start a new conversation!
              </p>
            </div>
          ) : (
            <div className="space-y-1">
              {conversations.map((conv) => (
                <div
                  key={conv.id}
                  onClick={() => onConversationSelect(conv.id)}
                  onMouseEnter={() => setHoveredConversation(conv.id)}
                  onMouseLeave={() => setHoveredConversation(null)}
                  className={`
                    group relative px-2.5 py-2 rounded-lg cursor-pointer transition-all duration-200
                    ${
                      currentConversationId === conv.id
                        ? 'bg-[var(--color-accent-primary)] text-white shadow-sm'
                        : 'hover:bg-[var(--color-background)]/80 text-[var(--color-foreground)]'
                    }
                  `}
                >
                  <h3
                    className={`font-medium text-xs truncate pr-6 ${
                      currentConversationId === conv.id
                        ? 'text-white'
                        : 'text-[var(--color-text-heading)]'
                    }`}
                  >
                    {conv.title}
                  </h3>

                  {/* Delete button - show on hover */}
                  {hoveredConversation === conv.id && (
                    <div className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={(e) => handleDelete(e, conv.id)}
                        className="p-1 rounded hover:bg-black/10 transition-colors"
                        title="Delete"
                      >
                        <Trash2
                          className={`h-3 w-3 ${
                            currentConversationId === conv.id
                              ? 'text-white/70 hover:text-white'
                              : 'text-[var(--color-text-muted)] hover:text-[var(--color-error)]'
                          }`}
                        />
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Collapsed spacer */}
      {isCollapsed && <div className="flex-1" />}

      {/* ── Bottom Navigation ── */}
      {!isCollapsed && (
        <div className="border-t border-[var(--color-border)]/30 px-3 py-2 space-y-0.5">
          {/* View Skills */}
          {onViewSkills && (
            <button
              onClick={onViewSkills}
              className="flex items-center gap-2.5 w-full px-2.5 py-2 rounded-lg text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-background)] transition-colors"
            >
              <BookOpen className="h-3.5 w-3.5 flex-shrink-0" />
              System prompt & skills
            </button>
          )}

          {/* Project Settings */}
          {onOpenProjectSettings && (
            <button
              onClick={onOpenProjectSettings}
              className="flex items-center gap-2.5 w-full px-2.5 py-2 rounded-lg text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-background)] transition-colors"
            >
              <FolderCog className="h-3.5 w-3.5 flex-shrink-0" />
              Project Settings
            </button>
          )}

          {/* Projects Link */}
          <Link
            to="/"
            className={`flex items-center gap-2.5 w-full px-2.5 py-2 rounded-lg text-xs transition-colors ${
              location.pathname === '/'
                ? 'text-[var(--color-accent-primary)] bg-[var(--color-accent-primary)]/[0.06]'
                : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-background)]'
            }`}
          >
            <Folder className="h-3.5 w-3.5 flex-shrink-0" />
            Projects
          </Link>

          {/* Docs Link */}
          <Link
            to="/doc"
            className={`flex items-center gap-2.5 w-full px-2.5 py-2 rounded-lg text-xs transition-colors ${
              location.pathname === '/doc'
                ? 'text-[var(--color-accent-primary)] bg-[var(--color-accent-primary)]/[0.06]'
                : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-background)]'
            }`}
          >
            <FileText className="h-3.5 w-3.5 flex-shrink-0" />
            Docs
          </Link>

          {/* User */}
          {displayName && (
            <div
              className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg"
              title={user || undefined}
            >
              <div className="w-5 h-5 rounded-full bg-[var(--color-accent-primary)] flex items-center justify-center text-white text-[10px] font-semibold flex-shrink-0">
                {displayName.charAt(0).toUpperCase()}
              </div>
              <span className="text-xs text-[var(--color-text-muted)] truncate">
                {displayName}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Collapsed bottom icons */}
      {isCollapsed && (
        <div className="border-t border-[var(--color-border)]/30 py-2 flex flex-col items-center gap-1">
          {onOpenProjectSettings && (
            <button
              onClick={onOpenProjectSettings}
              className="p-2 rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-background)] transition-colors"
              title="Project Settings"
            >
              <FolderCog className="h-4 w-4" />
            </button>
          )}
          <Link
            to="/"
            className="p-2 rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-background)] transition-colors"
            title="Projects"
          >
            <Folder className="h-4 w-4" />
          </Link>
          <Link
            to="/doc"
            className="p-2 rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-background)] transition-colors"
            title="Docs"
          >
            <FileText className="h-4 w-4" />
          </Link>
          {displayName && (
            <div
              className="p-2"
              title={user || undefined}
            >
              <div className="w-5 h-5 rounded-full bg-[var(--color-accent-primary)] flex items-center justify-center text-white text-[10px] font-semibold">
                {displayName.charAt(0).toUpperCase()}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Collapse/Expand Button */}
      <div className="absolute -right-3 top-16 z-10">
        <button
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="p-1.5 rounded-full bg-[var(--color-background)] border border-[var(--color-border)] shadow-sm hover:shadow-md transition-all duration-200 group"
          title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {isCollapsed ? (
            <ChevronRight className="h-3 w-3 text-[var(--color-muted-foreground)] group-hover:text-[var(--color-foreground)]" />
          ) : (
            <ChevronLeft className="h-3 w-3 text-[var(--color-muted-foreground)] group-hover:text-[var(--color-foreground)]" />
          )}
        </button>
      </div>
    </aside>
  );
}
