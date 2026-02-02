import React from 'react';
import { Cloud, Shield } from 'lucide-react';

export const Tools: React.FC = () => {
    const tools: any[] = [];

    return (
        <div className="space-y-10">
            {/* Hero Section */}
            <div className="relative rounded-2xl overflow-hidden bg-slate-900 text-white p-10 min-h-[200px] flex items-center">
                 {/* Abstract Background pattern */}
                 <div className="absolute inset-0 opacity-20">
                    <div className="absolute top-0 right-0 w-64 h-64 bg-blue-500 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2"></div>
                    <div className="absolute bottom-0 left-0 w-64 h-64 bg-cyan-500 rounded-full blur-3xl translate-y-1/2 -translate-x-1/2"></div>
                 </div>
                 
                 <div className="relative z-10 max-w-2xl">
                     <h1 className="text-3xl font-bold mb-3">Utility Tools</h1>
                     <p className="text-slate-300 text-lg leading-relaxed">
                         Everything you need to manage, optimize, and organize your digital workspace efficiently.
                     </p>
                 </div>
            </div>

            {/* Manage & Optimize Section */}
            <section>
                <div className="flex justify-between items-center mb-6">
                    <h2 className="text-xl font-bold">Manage & Optimize Files</h2>
                    <button className="text-sm text-slate-500 hover:text-blue-600 transition-colors">View all history</button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
                    {tools.map((tool, idx) => (
                        <div key={idx} className={`bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 transition-all duration-300 group cursor-pointer ${tool.bg} border-t-4 border-t-transparent hover:border-t-current shadow-sm hover:shadow-md`}>
                            <div className="h-32 bg-slate-100 dark:bg-slate-800 rounded-lg mb-6 flex items-center justify-center relative overflow-hidden group-hover:bg-slate-200 dark:group-hover:bg-slate-700 transition-colors">
                                {/* Simulated Tool UI Preview */}
                                <tool.icon className={`w-12 h-12 ${idx === 0 ? 'text-blue-500' : idx === 1 ? 'text-red-500' : idx === 2 ? 'text-green-500' : 'text-yellow-500'}`} />
                            </div>
                            
                            <h3 className="font-bold text-lg mb-2">{tool.title}</h3>
                            <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
                                {tool.desc}
                            </p>
                        </div>
                    ))}
                </div>
            </section>

            {/* Quick Extensions */}
            <section>
                <h2 className="text-xl font-bold mb-6">Quick Extensions</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="bg-slate-800 dark:bg-slate-900 border border-slate-700 rounded-xl p-4 flex items-center justify-between text-white">
                        <div className="flex items-center gap-4">
                            <div className="w-10 h-10 rounded-lg bg-blue-600 flex items-center justify-center">
                                <Cloud className="w-6 h-6 text-white" />
                            </div>
                            <div>
                                <h4 className="font-bold">Cloud Sync</h4>
                                <p className="text-xs text-slate-400">Last synced 2m ago</p>
                            </div>
                        </div>
                        <button className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 rounded-lg text-xs font-medium transition-colors">
                            Configure
                        </button>
                    </div>

                    <div className="bg-slate-800 dark:bg-slate-900 border border-slate-700 rounded-xl p-4 flex items-center justify-between text-white">
                        <div className="flex items-center gap-4">
                            <div className="w-10 h-10 rounded-lg bg-blue-900/50 flex items-center justify-center border border-blue-500/30">
                                <Shield className="w-6 h-6 text-blue-400" />
                            </div>
                            <div>
                                <h4 className="font-bold">File Encryption</h4>
                                <p className="text-xs text-slate-400">Vault is locked</p>
                            </div>
                        </div>
                        <button className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 rounded-lg text-xs font-medium transition-colors">
                            Open Vault
                        </button>
                    </div>
                </div>
            </section>
        </div>
    );
};
