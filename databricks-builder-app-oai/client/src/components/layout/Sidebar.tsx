import { useState, useEffect, useCallback } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  Plus,
  MessageSquare,
  Trash2,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Loader2,
  BookOpen,
  FolderCog,
  FileText,
  Settings2,
} from 'lucide-react';
import type { Conversation, Project } from '@/lib/types';
import { useUser } from '@/contexts/UserContext';
import { useProjects } from '@/contexts/ProjectsContext';
import { fetchConversations, createConversation } from '@/lib/api';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

interface SidebarProps {
  // Keeping these for backward compatibility if needed, but we'll use context mostly
  onConversationSelect?: (conversationId: string) => void;
  onNewConversation?: () => void;
  onDeleteConversation?: (conversationId: string) => void;
  onViewSkills?: () => void;
  onOpenProjectSettings?: () => void;
  isLoading?: boolean;
}

export function Sidebar({
  onViewSkills,
  onOpenProjectSettings,
  isLoading: initialLoading = false,
}: SidebarProps) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const { projectId: currentProjectId } = useParams();
  const { user } = useUser();
  const { projects, loading: projectsLoading } = useProjects();
  
  const [projectConversations, setProjectConversations] = useState<Record<string, Conversation[]>>({});
  const [loadingProjects, setLoadingProjects] = useState<Record<string, boolean>>({});
  const [expandedProjects, setExpandedProjects] = useState<Record<string, boolean>>({});
  const [hoveredProject, setHoveredProject] = useState<string | null>(null);
  const [hoveredConversation, setHoveredConversation] = useState<string | null>(null);

  const displayName = user?.split('@')[0] || '';

  // Load conversations for a project
  const loadConversations = useCallback(async (projectId: string) => {
    if (loadingProjects[projectId]) return;
    
    setLoadingProjects(prev => ({ ...prev, [projectId]: true }));
    try {
      const convs = await fetchConversations(projectId);
      setProjectConversations(prev => ({ ...prev, [projectId]: convs }));
    } catch (error) {
      console.error(`Failed to fetch conversations for project ${projectId}:`, error);
    } finally {
      setLoadingProjects(prev => ({ ...prev, [projectId]: false }));
    }
  }, [loadingProjects]);

  // Expand current project by default
  useEffect(() => {
    if (currentProjectId) {
      setExpandedProjects(prev => ({ ...prev, [currentProjectId]: true }));
      loadConversations(currentProjectId);
    }
  }, [currentProjectId, loadConversations]);

  // Load conversations for all visible projects on mount (or just use lazy load)
  useEffect(() => {
    if (projects.length > 0) {
      // By default, just load the current one. Others can be lazy loaded or we can load all.
      // To match the screenshot, let's load all projects that are expanded.
      projects.forEach(p => {
        if (expandedProjects[p.id] && !projectConversations[p.id]) {
          loadConversations(p.id);
        }
      });
    }
  }, [projects, expandedProjects, projectConversations, loadConversations]);

  const toggleProject = (projectId: string) => {
    setExpandedProjects(prev => {
      const isExpanding = !prev[projectId];
      if (isExpanding && !projectConversations[projectId]) {
        loadConversations(projectId);
      }
      return { ...prev, [projectId]: isExpanding };
    });
  };

  const handleNewChat = async (e: React.MouseEvent, projectId: string) => {
    e.stopPropagation();
    try {
      const conv = await createConversation(projectId, 'New Chat');
      // Update local list
      setProjectConversations(prev => ({
        ...prev,
        [projectId]: [conv, ...(prev[projectId] || [])]
      }));
      // Navigate to it
      navigate(`/projects/${projectId}?conversationId=${conv.id}`);
    } catch (error) {
      toast.error('Failed to create new chat');
    }
  };

  const handleOpenSettings = (e: React.MouseEvent, projectId: string) => {
    e.stopPropagation();
    if (projectId === currentProjectId && onOpenProjectSettings) {
      onOpenProjectSettings();
    } else {
      // If it's a different project, navigate there first or just show toast
      navigate(`/projects/${projectId}`);
      // We'd need a way to auto-open settings after navigation, e.g. via URL param
      // For now, let's assume it only works for current project or navigates.
    }
  };

  return (
    <aside
      className={`
        flex flex-col bg-[var(--color-bg-secondary)] border-r border-[var(--color-border)] h-full relative transition-all duration-300 flex-shrink-0
        ${isCollapsed ? 'w-16' : 'w-[var(--sidebar-width)]'}
      `}
    >
      {/* Header — Logo */}
      <div
        className={`flex items-center gap-2.5 border-b border-[var(--color-border)]/30 transition-all duration-300 ${isCollapsed ? 'p-2 justify-center' : 'px-4 py-3'}`}
      >
        <Link to="/" className="flex items-center gap-2.5 min-w-0">
          <div className="w-7 h-7 flex-shrink-0 flex items-center justify-center text-[var(--color-accent-primary)]">
            <svg
              className="w-6 h-6"
              viewBox="33 0 28 31"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M59.7279 12.5153L47.2039 19.6185L33.8814 12.0502L33.251 12.3884V17.885L47.2039 25.8339L59.7279 18.7306V21.648L47.2039 28.7513L33.8814 21.1829L33.251 21.5212V22.4514L47.2039 30.4002L61.1989 22.4514V16.9548L60.5685 16.6165L47.2039 24.1849L34.7219 17.0816V14.2065L47.2039 21.2675L61.1989 13.3186V7.9066L60.4844 7.52607L47.2039 15.0521L35.3943 8.32941L47.2039 1.64897L56.9541 7.14554L57.8367 6.68044V6.00394L47.2039 0L33.251 7.9066V8.75223L47.2039 16.7011L59.7279 9.59785V12.5153Z"
                fill="currentColor"
              />
            </svg>
          </div>
          {!isCollapsed && (
            <span className="text-sm font-semibold text-[var(--color-text-heading)]">AI Dev Kit</span>
          )}
        </Link>
      </div>

      {/* Main Hierarchy Section */}
      {!isCollapsed && (
        <div className="flex-1 overflow-y-auto overflow-x-hidden p-2 pt-4 space-y-4">
          {projectsLoading ? (
            <div className="flex flex-col items-center justify-center py-10 opacity-50">
              <Loader2 className="h-5 w-5 animate-spin mb-2" />
              <span className="text-xs">Loading projects...</span>
            </div>
          ) : (
            projects.map((project) => (
              <div 
                key={project.id} 
                className="space-y-1"
                onMouseEnter={() => setHoveredProject(project.id)}
                onMouseLeave={() => setHoveredProject(null)}
              >
                {/* Project Header Row */}
                <div 
                  className={cn(
                    "group flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer transition-colors",
                    currentProjectId === project.id ? "bg-[var(--color-background)]" : "hover:bg-[var(--color-background)]/50"
                  )}
                  onClick={() => toggleProject(project.id)}
                >
                  <div className="flex-shrink-0 text-[var(--color-text-muted)]">
                    {expandedProjects[project.id] ? (
                      <ChevronDown className="h-3.5 w-3.5" />
                    ) : (
                      <ChevronRight className="h-3.5 w-3.5" />
                    )}
                  </div>
                  <span className={cn(
                    "text-xs font-semibold truncate flex-1",
                    currentProjectId === project.id ? "text-[var(--color-text-heading)]" : "text-[var(--color-text-muted)]"
                  )}>
                    {project.name}
                  </span>

                  {/* Hover Actions */}
                  {hoveredProject === project.id && (
                    <div className="flex items-center gap-1 animate-in fade-in slide-in-from-right-1 duration-200">
                      <button
                        onClick={(e) => handleOpenSettings(e, project.id)}
                        className="p-1 rounded-md hover:bg-[var(--color-border)]/50 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-all"
                        title="Settings"
                      >
                        <Settings2 className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={(e) => handleNewChat(e, project.id)}
                        className="p-1 rounded-md hover:bg-[var(--color-border)]/50 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-all"
                        title="New Chat"
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
                </div>

                {/* Nested Chats */}
                {expandedProjects[project.id] && (
                  <div className="ml-5 space-y-0.5 border-l border-[var(--color-border)]/20 pl-2">
                    {loadingProjects[project.id] ? (
                      <div className="py-2 pl-2">
                        <Loader2 className="h-3 w-3 animate-spin text-[var(--color-text-muted)]" />
                      </div>
                    ) : (
                      <>
                        {(projectConversations[project.id] || []).slice(0, 5).map((conv) => {
                          const isSelected = new URLSearchParams(location.search).get('conversationId') === conv.id && currentProjectId === project.id;
                          return (
                            <div
                              key={conv.id}
                              onClick={() => navigate(`/projects/${project.id}?conversationId=${conv.id}`)}
                              className={cn(
                                "group relative px-2 py-1.5 rounded-md cursor-pointer text-xs truncate transition-all duration-200",
                                isSelected 
                                  ? "bg-[var(--color-accent-primary)] text-white shadow-sm" 
                                  : "text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-background)]"
                              )}
                            >
                              {conv.title || 'New Chat'}
                            </div>
                          );
                        })}
                        
                        {/* Show More */}
                        {(projectConversations[project.id]?.length || 0) > 5 && (
                          <button 
                            className="w-full text-left px-2 py-1.5 text-[10px] font-medium text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors"
                            onClick={() => navigate(`/projects/${project.id}`)}
                          >
                            See all ({projectConversations[project.id].length})
                          </button>
                        )}

                        {(!projectConversations[project.id] || projectConversations[project.id].length === 0) && !loadingProjects[project.id] && (
                          <div className="px-2 py-1.5 text-[10px] text-[var(--color-text-muted)] italic opacity-60">
                            No chats yet
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {/* Collapsed view */}
      {isCollapsed && (
        <div className="flex-1 overflow-y-auto py-4 flex flex-col items-center gap-4">
          {projects.map(p => (
            <button 
              key={p.id}
              onClick={() => {
                setIsCollapsed(false);
                setExpandedProjects(prev => ({ ...prev, [p.id]: true }));
              }}
              className={cn(
                "w-8 h-8 rounded-lg flex items-center justify-center text-[10px] font-bold border transition-all",
                currentProjectId === p.id 
                  ? "bg-[var(--color-accent-primary)] text-white border-[var(--color-accent-primary)] shadow-sm"
                  : "bg-[var(--color-background)] text-[var(--color-text-muted)] border-[var(--color-border)] hover:border-[var(--color-text-muted)]"
              )}
              title={p.name}
            >
              {p.name.substring(0, 2).toUpperCase()}
            </button>
          ))}
        </div>
      )}

      {/* Bottom Nav */}
      <div className="border-t border-[var(--color-border)]/30 px-3 py-2 space-y-0.5">
        {!isCollapsed && onViewSkills && (
          <button
            onClick={onViewSkills}
            className="flex items-center gap-2.5 w-full px-2.5 py-2 rounded-lg text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-background)] transition-colors"
          >
            <BookOpen className="h-3.5 w-3.5 flex-shrink-0" />
            System Prompt
          </button>
        )}

        <Link
          to="/doc"
          className={cn(
            "flex items-center gap-2.5 w-full px-2.5 py-2 rounded-lg text-xs transition-colors",
            location.pathname === '/doc'
              ? 'text-[var(--color-accent-primary)] bg-[var(--color-accent-primary)]/[0.06]'
              : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-background)]'
          )}
        >
          <FileText className="h-3.5 w-3.5 flex-shrink-0" />
          {!isCollapsed && "Docs"}
        </Link>

        {/* User */}
        {displayName && (
          <div
            className={cn(
              "flex items-center gap-2.5 px-2 py-2 rounded-lg",
              isCollapsed ? "justify-center" : "px-2.5"
            )}
            title={user || undefined}
          >
            <div className="w-5 h-5 rounded-full bg-[var(--color-accent-primary)] flex items-center justify-center text-white text-[10px] font-semibold flex-shrink-0">
              {displayName.charAt(0).toUpperCase()}
            </div>
            {!isCollapsed && (
              <span className="text-xs text-[var(--color-text-muted)] truncate">
                {displayName}
              </span>
            )}
          </div>
        )}
      </div>

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
