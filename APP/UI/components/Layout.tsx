import React, { useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useTheme } from '../contexts/ThemeContext';
import { Chat } from '../pages/Chat';

// ─── Icon primitives ─────────────────────────────────────────────────────────
const Svg = ({
  size = 18, children, style,
}: { size?: number; children: React.ReactNode; style?: React.CSSProperties }) => (
  <svg width={size} height={size} viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth={1.6}
    strokeLinecap="round" strokeLinejoin="round" style={style}>
    {children}
  </svg>
);

const DriveIcon   = (p: { size?: number }) => <Svg size={p.size}><rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="8" cy="12" r="1.2" fill="currentColor"/><path d="M12 12h6"/></Svg>;
const SparkleIcon = (p: { size?: number }) => <Svg size={p.size}><path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8"/></Svg>;
const ToolsIcon   = (p: { size?: number }) => <Svg size={p.size}><path d="M14.7 6.3a4.5 4.5 0 0 1-5.9 5.9L3 18l3 3 5.8-5.8a4.5 4.5 0 0 1 5.9-5.9l-2.5 2.5-2.5-.5-.5-2.5Z"/></Svg>;
const SettingsIcon = (p: { size?: number }) => <Svg size={p.size}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h0a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5h0a1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8h0a1.7 1.7 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/></Svg>;
const SunIcon     = (p: { size?: number }) => <Svg size={p.size}><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></Svg>;
const MoonIcon    = (p: { size?: number }) => <Svg size={p.size}><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"/></Svg>;
const ChevRight   = (p: { size?: number }) => <Svg size={p.size}><path d="m9 6 6 6-6 6"/></Svg>;

// ─── Nav items ───────────────────────────────────────────────────────────────
const NAV = [
  { path: '/files',    label: 'My Drives', Icon: DriveIcon,    hint: '⌘1' },
  { path: '/chat',     label: 'Agent',     Icon: SparkleIcon,  hint: '⌘2' },
  { path: '/tools',    label: 'Tools',     Icon: ToolsIcon,    hint: '⌘3' },
];

// ─── Brand mark ──────────────────────────────────────────────────────────────
function BrandMark() {
  return (
    <div style={{
      width: 36, height: 36, borderRadius: 'var(--r-control)',
      background: 'var(--accent)', color: 'var(--on-accent)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      flexShrink: 0, overflow: 'hidden',
      boxShadow: '0 1px 0 rgba(255,255,255,.08) inset, 0 6px 14px -8px var(--accent)',
    }}>
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
        <path d="M5 6c0-1 1-2 2-2h6l6 6v8c0 1-1 2-2 2H7c-1 0-2-1-2-2V6z" fill="currentColor" opacity=".9"/>
        <path d="M13 4v4c0 1 1 2 2 2h4" stroke="var(--accent)" strokeWidth="1.4" strokeLinejoin="round"/>
      </svg>
    </div>
  );
}

// ─── Sidebar ─────────────────────────────────────────────────────────────────
function Sidebar({ active }: { active: string }) {
  const [hover, setHover] = useState(false);
  const { theme, toggleTheme } = useTheme();
  const w = hover ? 220 : 68;

  return (
    <aside
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        width: w, flexShrink: 0,
        background: 'var(--surface)',
        borderRight: '1px solid var(--border)',
        display: 'flex', flexDirection: 'column',
        transition: 'width .25s var(--ease)',
        overflow: 'hidden',
        zIndex: 5,
      }}
    >
      {/* Brand */}
      <div className="drag-region" style={{ padding: '16px 14px 12px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <BrandMark />
        <div style={{
          opacity: hover ? 1 : 0, transition: 'opacity .15s', whiteSpace: 'nowrap',
          fontFamily: 'var(--font-display)', fontSize: 17, fontWeight: 600,
          letterSpacing: 'var(--display-tracking)', color: 'var(--ink)',
        }}>
          Licenta
        </div>
      </div>

      {/* Nav */}
      <nav style={{ padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 2, flex: 1 }}>
        {NAV.map(({ path, label, Icon, hint }) => {
          const isActive = active.startsWith(path);
          return (
            <NavLink key={path} to={path} title={label} style={{ textDecoration: 'none' }}>
              <div
                style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '10px 12px', borderRadius: 'var(--r-control)',
                  background: isActive ? 'var(--accent-soft)' : 'transparent',
                  color: isActive ? 'var(--accent-ink)' : 'var(--ink-2)',
                  transition: 'all .15s var(--ease)',
                  fontWeight: isActive ? 600 : 500,
                  fontSize: 13.5,
                  cursor: 'pointer',
                }}
                onMouseEnter={(e) => {
                  if (!isActive) {
                    (e.currentTarget as HTMLElement).style.background = 'var(--surface-2)';
                    (e.currentTarget as HTMLElement).style.color = 'var(--ink)';
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isActive) {
                    (e.currentTarget as HTMLElement).style.background = 'transparent';
                    (e.currentTarget as HTMLElement).style.color = 'var(--ink-2)';
                  }
                }}
              >
                <span style={{ flexShrink: 0, display: 'inline-flex' }}><Icon size={19} /></span>
                <span style={{ flex: 1, opacity: hover ? 1 : 0, transition: 'opacity .15s', whiteSpace: 'nowrap' }}>
                  {label}
                </span>
                <span style={{ opacity: hover ? 1 : 0, transition: 'opacity .15s' }}>
                  <span className="kbd">{hint}</span>
                </span>
              </div>
            </NavLink>
          );
        })}
      </nav>

      {/* Bottom: settings + theme */}
      <div style={{ padding: 10, borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 2 }}>
        <NavLink to="/settings" title="Settings" style={{ textDecoration: 'none' }}>
          <div
            style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '10px 12px', borderRadius: 'var(--r-control)',
              color: active.startsWith('/settings') ? 'var(--accent-ink)' : 'var(--muted)',
              background: active.startsWith('/settings') ? 'var(--accent-soft)' : 'transparent',
              width: '100%', fontSize: 13.5, cursor: 'pointer',
              transition: 'all .15s var(--ease)',
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--surface-2)'; (e.currentTarget as HTMLElement).style.color = 'var(--ink)'; }}
            onMouseLeave={(e) => {
              const s = active.startsWith('/settings');
              (e.currentTarget as HTMLElement).style.background = s ? 'var(--accent-soft)' : 'transparent';
              (e.currentTarget as HTMLElement).style.color = s ? 'var(--accent-ink)' : 'var(--muted)';
            }}
          >
            <SettingsIcon size={19} />
            <span style={{ opacity: hover ? 1 : 0, transition: 'opacity .15s', whiteSpace: 'nowrap' }}>Settings</span>
          </div>
        </NavLink>

        <button
          onClick={toggleTheme}
          title={theme === 'light' ? 'Switch to dark' : 'Switch to light'}
          style={{
            display: 'flex', alignItems: 'center', gap: 12,
            padding: '10px 12px', borderRadius: 'var(--r-control)',
            color: 'var(--muted)', width: '100%', fontSize: 13.5,
            transition: 'all .15s var(--ease)',
          }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--surface-2)'; (e.currentTarget as HTMLElement).style.color = 'var(--ink)'; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = 'var(--muted)'; }}
        >
          {theme === 'light' ? <MoonIcon size={19} /> : <SunIcon size={19} />}
          <span style={{ opacity: hover ? 1 : 0, transition: 'opacity .15s', whiteSpace: 'nowrap' }}>
            {theme === 'light' ? 'Dark mode' : 'Light mode'}
          </span>
        </button>
      </div>
    </aside>
  );
}

// ─── Window controls (frameless Electron) ─────────────────────────────────────
const isElectron = typeof navigator !== 'undefined' && navigator.userAgent.includes('Electron');
const eAPI = isElectron ? (window as any).electronAPI : null;

function WinControls() {
  if (!isElectron) return null;
  const btn = (label: string, onClick: () => void, danger?: boolean): React.ReactNode => (
    <button
      className="no-drag"
      onClick={onClick}
      style={{
        width: 40, height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: 'var(--muted)', fontSize: 13, transition: 'all .12s',
        borderRadius: 0,
      }}
      onMouseEnter={e => {
        (e.currentTarget as HTMLElement).style.background = danger ? 'var(--c-clay)' : 'var(--surface-2)';
        if (danger) (e.currentTarget as HTMLElement).style.color = 'var(--page)';
        else (e.currentTarget as HTMLElement).style.color = 'var(--ink)';
      }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLElement).style.background = 'transparent';
        (e.currentTarget as HTMLElement).style.color = 'var(--muted)';
      }}
    >
      {label}
    </button>
  );
  return (
    <div style={{ display: 'flex', marginLeft: 4 }}>
      {btn('─', () => eAPI?.minimize())}
      {btn('□', () => eAPI?.maximize())}
      {btn('✕', () => eAPI?.close(), true)}
    </div>
  );
}

// ─── Top bar ─────────────────────────────────────────────────────────────────
function TopBar({ breadcrumbs, right }: {
  breadcrumbs: { label: string; path?: string }[];
  right?: React.ReactNode;
}) {
  const navigate = useNavigate();
  return (
    <header
      className="drag-region"
      style={{
        height: 48, padding: '0 0 0 18px',
        borderBottom: '1px solid var(--border)',
        background: 'var(--page)',
        display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0,
      }}
    >
      <div className="no-drag" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {breadcrumbs.map((crumb, i) => (
          <React.Fragment key={i}>
            <button
              onClick={() => crumb.path && navigate(crumb.path)}
              style={{
                padding: '4px 8px', borderRadius: 6, fontSize: 13.5,
                color: i === breadcrumbs.length - 1 ? 'var(--ink)' : 'var(--muted)',
                fontWeight: i === breadcrumbs.length - 1 ? 600 : 500,
                whiteSpace: 'nowrap', cursor: crumb.path ? 'pointer' : 'default',
              }}
              onMouseEnter={(e) => { if (crumb.path) (e.currentTarget as HTMLElement).style.background = 'var(--surface-2)'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
            >
              {crumb.label}
            </button>
            {i < breadcrumbs.length - 1 && (
              <span style={{ color: 'var(--faint)', display: 'inline-flex' }}>
                <ChevRight size={13} />
              </span>
            )}
          </React.Fragment>
        ))}
      </div>
      <div style={{ flex: 1 }} />
      <div className="no-drag" style={{ display: 'flex', alignItems: 'center' }}>
        {right}
      </div>
      <WinControls />
    </header>
  );
}

// ─── Build breadcrumbs from route ─────────────────────────────────────────────
function useBreadcrumbs(pathname: string) {
  const crumbs: { label: string; path?: string }[] = [];

  if (pathname.startsWith('/files')) {
    crumbs.push({ label: 'My Drives', path: '/files' });
  } else if (pathname === '/chat') {
    crumbs.push({ label: 'Agent' });
  } else if (pathname.startsWith('/tools')) {
    crumbs.push({ label: 'Tools', path: '/tools' });
    if (pathname !== '/tools') {
      const toolId = pathname.split('/')[2] ?? '';
      const label = toolId.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      const isRun = pathname.includes('/run');
      crumbs.push({ label, path: isRun ? `/tools/${toolId}` : undefined });
      if (isRun) crumbs.push({ label: 'Run' });
    }
  } else if (pathname.startsWith('/settings')) {
    crumbs.push({ label: 'Settings' });
  }

  return crumbs;
}

// ─── Main Layout ──────────────────────────────────────────────────────────────
export const Layout: React.FC = () => {
  const location = useLocation();
  const breadcrumbs = useBreadcrumbs(location.pathname);
  const { pathname } = location;
  const isChat = pathname === '/chat' || pathname === '/';

  // Files and exact /tools manage their own scroll & padding internally
  const isSelfLayout = pathname.startsWith('/files') || pathname === '/tools';

  return (
    <div style={{
      display: 'flex', height: '100vh',
      background: 'var(--page)', color: 'var(--ink)',
      overflow: 'hidden', fontFamily: 'var(--font-body)',
    }}>
      <Sidebar active={pathname} />

      {/* Main area */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>
        <TopBar breadcrumbs={breadcrumbs} />

        {/* Chat — always mounted, hidden via CSS when not at /chat */}
        <div style={{
          flex: isChat ? 1 : undefined,
          display: isChat ? 'flex' : 'none',
          flexDirection: 'column',
          overflow: 'hidden',
          minHeight: 0,
        }}>
          <Chat />
        </div>

        {/* Other pages */}
        <div style={{
          flex: !isChat ? 1 : undefined,
          display: !isChat ? 'flex' : 'none',
          flexDirection: 'column',
          overflow: 'hidden',
          minHeight: 0,
        }}>
          {isSelfLayout ? (
            <Outlet />
          ) : (
            /* Content pages: scrollable with consistent padding */
            <div style={{ flex: 1, overflowY: 'auto', padding: '24px 28px 40px' }}>
              <Outlet />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
