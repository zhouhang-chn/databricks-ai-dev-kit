import { ReactNode } from 'react';
import { TopBar } from './TopBar';

interface MainLayoutProps {
  children: ReactNode;
  projectName?: string;
  sidebar?: ReactNode;
  /** When true, hide the global TopBar (used when the sidebar provides its own navigation). */
  hideTopBar?: boolean;
}

export function MainLayout({ children, projectName, sidebar, hideTopBar = false }: MainLayoutProps) {
  return (
    <div className="h-screen bg-[var(--color-background)] flex flex-col overflow-hidden">
      {/* Top Bar - only shown when not hidden (e.g. on HomePage) */}
      {!hideTopBar && (
        <>
          <TopBar projectName={projectName} />
          <div className="flex-shrink-0 h-[var(--header-height)]" />
        </>
      )}

      {/* Main Layout */}
      <div className="flex-1 flex relative overflow-hidden">
        {/* Sidebar */}
        {sidebar && (
          <div className="hidden lg:block flex-shrink-0">
            {sidebar}
          </div>
        )}

        {/* Main Content Area */}
        <main className="flex-1 flex flex-col h-full relative bg-[var(--color-background)] overflow-hidden">
          <div className="relative flex-1 flex flex-col min-h-0">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
