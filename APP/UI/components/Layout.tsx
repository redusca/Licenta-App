import React from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { ThemeToggle } from './ThemeToggle';
import { 
  LayoutDashboard, 
  MessageSquare, 
  FolderOpen, 
  Blocks, 
  Wrench, 
  Settings, 
  HardDrive,
  User
} from 'lucide-react';

export const Layout: React.FC = () => {
  const location = useLocation();

  const navItems = [
    { path: '/', icon: LayoutDashboard, label: 'Home' },
    { path: '/files', icon: FolderOpen, label: 'My Files' },
    { path: '/chat', icon: MessageSquare, label: 'AI Agent' },
    { path: '/extensions', icon: Blocks, label: 'Extensions' },
    { path: '/tools', icon: Wrench, label: 'Tools' },
  ];

  return (
    <div className="flex h-screen bg-gray-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 overflow-hidden font-sans">
      {/* Sidebar */}
      <aside className="w-64 bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 flex flex-col transition-colors duration-300">
        
        {/* App Logo/Header */}
        <div className="p-6 flex items-center gap-3">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center text-white font-bold text-xl">
            L
          </div>
          <div>
            <h1 className="font-bold text-lg leading-tight">Licenta App</h1>
            <p className="text-xs text-slate-500 dark:text-slate-400">Pro Workspace</p>
          </div>
        </div>

        {/* Navigation */}
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

        {/* Storage Widget & Footer */}
        <div className="p-4 border-t border-slate-200 dark:border-slate-800">
          <div className="bg-slate-100 dark:bg-slate-800/50 rounded-xl p-4 mb-4">
            <div className="flex items-center gap-2 mb-2">
              <HardDrive className="w-4 h-4 text-slate-500" />
              <span className="text-xs font-semibold">Storage</span>
              <span className="text-xs text-slate-500 ml-auto">75%</span>
            </div>
            <div className="w-full bg-slate-200 dark:bg-slate-700 h-1.5 rounded-full overflow-hidden">
                <div className="bg-blue-500 h-full rounded-full" style={{ width: '75%' }}></div>
            </div>
            <p className="text-[10px] text-slate-500 mt-2">15 GB of 20 GB used</p>
          </div>

          <div className="flex items-center justify-between">
             <div className="flex items-center gap-2">
               <div className="w-8 h-8 rounded-full bg-slate-200 dark:bg-slate-700 flex items-center justify-center">
                 <User className="w-4 h-4" />
               </div>
               <div className="text-sm">
                 <p className="font-medium">Admin User</p>
               </div>
             </div>
             <ThemeToggle />
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col h-full overflow-hidden relative">
        {/* Header with Search (Optional, based on designs primarily having sidebar) */}
         <header className="h-16 px-6 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-white dark:bg-slate-900/50 backdrop-blur-sm z-10">
            <h2 className="text-xl font-semibold capitalize">
                {navItems.find(i => i.path === location.pathname)?.label || 'Dashboard'}
            </h2>
            <div className="flex items-center gap-4">
               {/* Placeholders for search or notifications if needed */}
            </div>
         </header>

         <div className="flex-1 overflow-y-auto p-6 scroll-smooth">
           <Outlet />
         </div>
      </main>
    </div>
  );
};
