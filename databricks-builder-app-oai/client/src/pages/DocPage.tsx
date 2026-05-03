import React, { useState } from 'react';
import {
  Home,
  Database,
  Server,
  BookOpen,
  Layers,
  Code,
  Cpu,
  ArrowRight,
  ChevronRight,
  Terminal,
  Sparkles
} from 'lucide-react';
import { MainLayout } from '@/components/layout/MainLayout';

type DocSection = 'overview' | 'app';

interface NavItem {
  id: DocSection;
  label: string;
  icon: React.ReactNode;
}

const navItems: NavItem[] = [
  { id: 'overview', label: 'Overview', icon: <Home className="h-4 w-4" /> },
  { id: 'app', label: 'Builder App', icon: <Sparkles className="h-4 w-4" /> },
];

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-xs px-2 py-1 rounded bg-[var(--color-accent-primary)]/10 text-[var(--color-text-secondary)]">
      {children}
    </span>
  );
}

function OverviewSection() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-[var(--color-text-heading)]">
          Databricks AI Dev Kit
        </h1>
        <p className="mt-2 text-lg text-[var(--color-text-muted)]">
          Build Databricks projects with AI agents, reusable skills, and governed Databricks tools.
        </p>
      </div>

      <div className="rounded-lg border border-[var(--color-accent-primary)]/20 bg-[var(--color-accent-primary)]/5 p-6">
        <h2 className="text-xl font-semibold text-[var(--color-text-heading)] mb-4">
          What It Provides
        </h2>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="flex items-start gap-3">
            <BookOpen className="h-5 w-5 text-[var(--color-accent-primary)] mt-0.5 flex-shrink-0" />
            <div>
              <p className="font-medium text-[var(--color-text-heading)]">Skills</p>
              <p className="text-sm text-[var(--color-text-muted)]">
                Curated Databricks guidance that teaches agents product-specific workflows and safety rules.
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <Database className="h-5 w-5 text-[var(--color-accent-primary)] mt-0.5 flex-shrink-0" />
            <div>
              <p className="font-medium text-[var(--color-text-heading)]">Tools Core</p>
              <p className="text-sm text-[var(--color-text-muted)]">
                Python APIs for SQL, Unity Catalog, compute, Databricks Apps, pipelines, and Agent Bricks.
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <Server className="h-5 w-5 text-[var(--color-accent-primary)] mt-0.5 flex-shrink-0" />
            <div>
              <p className="font-medium text-[var(--color-text-heading)]">MCP Server</p>
              <p className="text-sm text-[var(--color-text-muted)]">
                Optional protocol server for external clients that need Databricks tools over MCP.
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <Sparkles className="h-5 w-5 text-[var(--color-accent-primary)] mt-0.5 flex-shrink-0" />
            <div>
              <p className="font-medium text-[var(--color-text-heading)]">Builder App</p>
              <p className="text-sm text-[var(--color-text-muted)]">
                A web UI backed by OpenAI Agents SDK and AI Gateway OpenAI-compatible models.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div>
        <h2 className="text-xl font-semibold text-[var(--color-text-heading)] mb-4">
          Architecture
        </h2>
        <div className="rounded-lg border border-[var(--color-border)] p-5 space-y-4">
          <div className="grid gap-4 md:grid-cols-3">
            <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-4">
              <div className="flex items-center gap-2 mb-2">
                <Layers className="h-5 w-5 text-[var(--color-accent-primary)]" />
                <h3 className="font-semibold text-[var(--color-text-heading)]">Knowledge</h3>
              </div>
              <p className="text-sm text-[var(--color-text-muted)]">
                Skills are copied into each project under <code className="font-mono">.agents/skills</code>.
              </p>
            </div>
            <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-4">
              <div className="flex items-center gap-2 mb-2">
                <Cpu className="h-5 w-5 text-green-400" />
                <h3 className="font-semibold text-[var(--color-text-heading)]">Runtime</h3>
              </div>
              <p className="text-sm text-[var(--color-text-muted)]">
                OpenAI Agents SDK streams events and calls typed function tools built from app-owned wrappers.
              </p>
            </div>
            <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-4">
              <div className="flex items-center gap-2 mb-2">
                <Database className="h-5 w-5 text-orange-400" />
                <h3 className="font-semibold text-[var(--color-text-heading)]">Databricks</h3>
              </div>
              <p className="text-sm text-[var(--color-text-muted)]">
                Tool auth is isolated from model auth and uses per-user Databricks credentials.
              </p>
            </div>
          </div>
          <div className="flex justify-center">
            <ArrowRight className="h-6 w-6 text-[var(--color-text-muted)] rotate-90" />
          </div>
          <div className="rounded-lg border border-[var(--color-accent-primary)]/30 bg-[var(--color-accent-primary)]/5 p-4">
            <div className="flex flex-wrap gap-2">
              <Pill>deepseek-v4-pro</Pill>
              <Pill>deepseek-v4-flash for title generation</Pill>
              <Pill>AI Gateway OpenAI-compatible endpoint</Pill>
              <Pill>Lakebase conversation storage</Pill>
              <Pill>SSE streaming and reconnect buffer</Pill>
            </div>
          </div>
        </div>
      </div>

      <div>
        <h2 className="text-xl font-semibold text-[var(--color-text-heading)] mb-4">
          Example Workflow
        </h2>
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-6 space-y-4">
          {[
            ['Ask', 'Generate synthetic support data with realistic customer patterns.'],
            ['Guide', 'The selected synthetic-data skill adds Databricks-specific constraints and best practices.'],
            ['Build', 'The agent writes project files through scoped file tools and avoids path escapes.'],
            ['Run', 'Databricks tools execute SQL or Python with the current user credentials.'],
            ['Verify', 'The agent reads real tool results, fixes errors, and summarizes the completed work.'],
          ].map(([title, body], index) => (
            <div key={title} className="flex items-start gap-3">
              <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-[var(--color-accent-primary)]/20 flex items-center justify-center text-[var(--color-accent-primary)] font-semibold text-sm">
                {index + 1}
              </div>
              <div>
                <p className="font-medium text-[var(--color-text-heading)]">{title}</p>
                <p className="text-sm text-[var(--color-text-muted)] mt-1">{body}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function AppSection() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-[var(--color-text-heading)]">
          databricks-builder-app-oai
        </h1>
        <p className="mt-2 text-lg text-[var(--color-text-muted)]">
          OpenAI Agents SDK web app for building and deploying Databricks resources.
        </p>
      </div>

      <div className="rounded-lg border border-[var(--color-accent-primary)]/20 bg-[var(--color-accent-primary)]/5 p-6">
        <p className="text-[var(--color-text-secondary)]">
          The app runs model calls through AI Gateway/OpenAI-compatible settings while keeping Databricks tool calls on the user's Databricks credentials.
        </p>
      </div>

      <div>
        <h2 className="text-xl font-semibold text-[var(--color-text-heading)] mb-4">
          Request Path
        </h2>
        <div className="space-y-4">
          {[
            ['React frontend', 'Chat UI, project selection, resource settings, file browser, and reconnectable stream polling.', Code],
            ['FastAPI backend', 'Conversation storage, stream lifecycle, project files, and runtime construction.', Server],
            ['OpenAI Agents SDK', 'Streaming run loop, SQLite-backed SDK sessions, cancellation, and typed function tools.', Terminal],
            ['Databricks tools', 'SQL warehouses, compute, and project-safe file operations called with per-user auth context.', Database],
          ].map(([title, body, Icon]) => (
            <div key={String(title)} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-4">
              <div className="flex items-center gap-2 mb-2">
                {React.createElement(Icon as typeof Code, { className: 'h-5 w-5 text-[var(--color-accent-primary)]' })}
                <h3 className="font-semibold text-[var(--color-text-heading)]">{title as string}</h3>
              </div>
              <p className="text-sm text-[var(--color-text-muted)]">{body as string}</p>
            </div>
          ))}
        </div>
      </div>

      <div>
        <h2 className="text-xl font-semibold text-[var(--color-text-heading)] mb-4">
          Runtime Settings
        </h2>
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-5">
          <ul className="space-y-2 text-sm text-[var(--color-text-muted)]">
            {[
              'OPENAI_BASE_URL points at the AI Gateway OpenAI-compatible endpoint.',
              'OPENAI_API_KEY contains the AI Gateway API key or token.',
              'OPENAI_AGENT_MODEL defaults to deepseek-v4-pro.',
              'OPENAI_TITLE_MODEL defaults to deepseek-v4-flash for cheaper metadata generation.',
              'OPENAI_AGENTS_DISABLE_TRACING is enabled for OpenAI-compatible AI Gateway routes.',
            ].map((item) => (
              <li key={item} className="flex items-start gap-2">
                <ChevronRight className="h-3 w-3 text-[var(--color-accent-primary)] mt-1" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div>
        <h2 className="text-xl font-semibold text-[var(--color-text-heading)] mb-4">
          Security Model
        </h2>
        <div className="rounded-lg border border-orange-500/30 bg-orange-500/5 p-5">
          <p className="text-sm text-[var(--color-text-muted)]">
            Model credentials are never reused as Databricks credentials. File tools resolve paths under the project root, reject parent traversal and symlink escapes, and enforce size caps. Databricks tools receive auth through context variables copied into worker threads.
          </p>
        </div>
      </div>

      <div>
        <h2 className="text-xl font-semibold text-[var(--color-text-heading)] mb-4">
          Tech Stack
        </h2>
        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-4">
            <h3 className="font-semibold text-[var(--color-text-heading)] mb-2">Frontend</h3>
            <div className="flex flex-wrap gap-2">
              {['React', 'TypeScript', 'TailwindCSS', 'Vite'].map((tech) => <Pill key={tech}>{tech}</Pill>)}
            </div>
          </div>
          <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-4">
            <h3 className="font-semibold text-[var(--color-text-heading)] mb-2">Backend</h3>
            <div className="flex flex-wrap gap-2">
              {['FastAPI', 'OpenAI Agents SDK', 'Lakebase'].map((tech) => <Pill key={tech}>{tech}</Pill>)}
            </div>
          </div>
          <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-4">
            <h3 className="font-semibold text-[var(--color-text-heading)] mb-2">Databricks</h3>
            <div className="flex flex-wrap gap-2">
              {['SQL', 'Unity Catalog', 'Compute', 'OAuth'].map((tech) => <Pill key={tech}>{tech}</Pill>)}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function DocPage() {
  const [activeSection, setActiveSection] = useState<DocSection>('overview');

  const renderSection = () => {
    switch (activeSection) {
      case 'overview':
        return <OverviewSection />;
      case 'app':
        return <AppSection />;
      default:
        return <OverviewSection />;
    }
  };

  const docSidebar = (
    <nav className="w-64 h-full border-r border-[var(--color-border)] bg-[var(--color-bg-secondary)] overflow-y-auto">
      <div className="p-4 space-y-1">
        {navItems.map((item) => (
          <button
            key={item.id}
            onClick={() => setActiveSection(item.id)}
            className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
              activeSection === item.id
                ? 'bg-[var(--color-accent-primary)]/10 text-[var(--color-accent-primary)]'
                : 'text-[var(--color-text-muted)] hover:bg-[var(--color-background)] hover:text-[var(--color-text-heading)]'
            }`}
          >
            {item.icon}
            {item.label}
          </button>
        ))}
      </div>
    </nav>
  );

  return (
    <MainLayout sidebar={docSidebar}>
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-7xl mx-auto px-8 py-8">
          {renderSection()}
        </div>
      </div>
    </MainLayout>
  );
}
