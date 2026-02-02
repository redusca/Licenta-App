import React, { useState } from 'react';
import { Download, Star } from 'lucide-react';

export const Extensions: React.FC = () => {
    const filters = ['All', 'Productivity', 'Developer Tools', 'Design', 'Utilities'];
    const [activeFilter, setActiveFilter] = useState('All');

    const extensions: any[] = [];

    return (
        <div className="space-y-6">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                   <h1 className="text-2xl font-bold tracking-tight">Extensions Marketplace</h1>
                   <p className="text-slate-500 dark:text-slate-400 mt-1">Supercharge your file manager with powerful tools.</p>
                </div>
                <button className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2">
                    <Download className="w-4 h-4" />
                    Publish Extension
                </button>
            </div>

            <div className="flex gap-2 overflow-x-auto pb-2">
                {filters.map(filter => (
                    <button
                        key={filter}
                        onClick={() => setActiveFilter(filter)}
                        className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors whitespace-nowrap ${
                            activeFilter === filter
                            ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900'
                            : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-700'
                        }`}
                    >
                        {filter}
                    </button>
                ))}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {extensions.map((ext, idx) => (
                    <div key={idx} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 hover:shadow-lg transition-all duration-300 group">
                        <div className="flex justify-between items-start mb-4">
                            <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${ext.color}`}>
                                <ext.icon className="w-6 h-6" />
                            </div>
                            {ext.rating ? (
                                <div className="flex items-center gap-1 text-orange-500 text-xs font-bold bg-orange-50 dark:bg-orange-900/20 px-2 py-1 rounded-md">
                                    <Star className="w-3 h-3 fill-current" />
                                    {ext.tag}
                                </div>
                            ) : ext.tag ? (
                                <span className={`text-xs font-bold px-2 py-1 rounded-md ${
                                    ext.tag === 'Pro' 
                                    ? 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300' 
                                    : 'bg-green-100 text-green-700 dark:bg-green-900/20 dark:text-green-400'
                                }`}>
                                    {ext.tag}
                                </span>
                            ) : null}
                        </div>
                        
                        <h3 className="font-bold text-lg mb-2">{ext.title}</h3>
                        <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed mb-6 min-h-[60px]">
                            {ext.desc}
                        </p>

                        <button className="w-full py-2 bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 font-semibold rounded-lg hover:bg-blue-100 dark:hover:bg-blue-900/40 transition-colors">
                            Install
                        </button>
                    </div>
                ))}
            </div>
        </div>
    );
};
