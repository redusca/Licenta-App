import React from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { ThemeToggle } from './ThemeToggle';
import { Chat } from '../pages/Chat';
import {
  MessageSquare,
  Wrench,
  Settings,
  HardDrive,
} from 'lucide-react';

export const Layout: React.FC = () => {
  const location = useLocation();

  const navItems = [
    { path: '/files', icon: HardDrive, label: 'My Drive' },
    { path: '/chat', icon: MessageSquare, label: 'AI Agent' },
    { path: '/tools', icon: Wrench, label: 'Tools' },
  ];

  const isChat = location.pathname === '/chat' || location.pathname === '/';

  const currentLabel =
    navItems.find(i => i.path === location.pathname)?.label ||
    (location.pathname === '/settings' ? 'Settings' : '');

  return (
    <div className="flex h-screen bg-gray-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 overflow-hidden font-sans">
      {/* Sidebar */}
      <aside className="w-64 shrink-0 bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 flex flex-col transition-colors duration-300">

        <div className="p-6 flex items-center gap-3">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center text-white font-bold text-xl">
            L
          </div>
          <div>
            <h1 className="font-bold text-lg leading-tight">Licenta App</h1>
            <p className="text-xs text-slate-500 dark:text-slate-400">Pro Workspace</p>
          </div>
        </div>

        <nav className="flex-1 px-4 space-y-1 overflow-y-auto py-4">
          {navItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-blue-50 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-200'
                }`
              }
            >
              <item.icon className="w-5 h-5" />
              {item.label}
            </NavLink>
          ))}

          <div className="pt-4 mt-4 border-t border-slate-200 dark:border-slate-800">
            <NavLink
              to="/settings"
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-blue-50 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-200'
                }`
              }
            >
              <Settings className="w-5 h-5" />
              Settings
            </NavLink>
          </div>
        </nav>

        <div className="p-4 border-t border-slate-200 dark:border-slate-800 flex justify-end">
          <ThemeToggle />
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 flex flex-col h-full overflow-hidden relative">
        <header className="h-16 shrink-0 px-6 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-white dark:bg-slate-900/50 backdrop-blur-sm z-10">
          <h2 className="text-xl font-semibold capitalize">{currentLabel}</h2>
        </header>

        {/*
          Chat is ALWAYS mounted so the SSE stream and tool-approval polling
          survive navigation. Hidden via CSS — never unmounted.
        */}
        <div className={isChat ? 'flex-1 overflow-hidden p-6' : 'hidden'}>
          <Chat />
        </div>

        {/*
          Outlet is ALWAYS in the DOM so <Navigate> can fire its effect on
          initial load. Hidden via CSS when at /chat.
        */}
        <div className={!isChat ? 'flex-1 overflow-y-auto p-6 scroll-smooth' : 'hidden'}>
          <Outlet />
        </div>
      </main>
    </div>
  );
};
