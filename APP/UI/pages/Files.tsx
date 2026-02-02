import React, { useState } from 'react';
import { 
    Upload, 
    LayoutGrid, 
    List as ListIcon, 
    MoreHorizontal, 
    Folder, 
    Search
} from 'lucide-react';

export const Files: React.FC = () => {
    const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');

    const recentFiles: any[] = [];

    const folders: any[] = [];

    const allFiles: any[] = [];

    return (
        <div className="space-y-8">
            {/* Header Actions */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                   <div className="flex items-center gap-2 text-sm text-slate-500 mb-1">
                      <span>Home</span>
                      <span>/</span>
                      <span>Documents</span>
                      <span>/</span>
                      <span className="text-slate-900 dark:text-slate-200 font-medium bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded">Projects</span>
                   </div>
                   <h1 className="text-2xl font-bold tracking-tight">Project Files</h1>
                </div>

                <div className="flex items-center gap-3 w-full sm:w-auto">
                    <div className="relative group flex-1 sm:flex-none">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 group-focus-within:text-blue-500 transition-colors" />
                        <input 
                            type="text" 
                            placeholder="Search files..." 
                            className="pl-9 pr-4 py-2 bg-slate-100 dark:bg-slate-800 border-none rounded-lg text-sm w-full sm:w-64 focus:ring-2 focus:ring-blue-500 focus:outline-none transition-all"
                        />
                    </div>
                    <button className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors">
                        <Upload className="w-4 h-4" />
                        Upload
                    </button>
                    <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-lg">
                        <button 
                            onClick={() => setViewMode('grid')}
                            className={`p-1.5 rounded-md transition-all ${viewMode === 'grid' ? 'bg-white dark:bg-slate-600 shadow-sm text-blue-600 dark:text-blue-400' : 'text-slate-500'}`}
                        >
                            <LayoutGrid className="w-4 h-4" />
                        </button>
                        <button 
                             onClick={() => setViewMode('list')}
                            className={`p-1.5 rounded-md transition-all ${viewMode === 'list' ? 'bg-white dark:bg-slate-600 shadow-sm text-blue-600 dark:text-blue-400' : 'text-slate-500'}`}
                        >
                            <ListIcon className="w-4 h-4" />
                        </button>
                    </div>
                </div>
            </div>

            {/* Recent Files Grid */}
            <section>
                <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-4">Recent</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    {recentFiles.map((file, idx) => (
                        <div key={idx} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 hover:border-blue-500 dark:hover:border-blue-500 transition-colors group cursor-pointer relative overflow-hidden">
                            <div className={`w-12 h-12 rounded-lg flex items-center justify-center mb-4 ${file.color}`}>
                                <file.icon className="w-6 h-6" />
                            </div>
                            <h4 className="font-semibold truncate pr-2">{file.name}</h4>
                            <div className="flex items-center gap-2 text-xs text-slate-500 mt-1">
                                <span>{file.size}</span>
                                <span className="w-1 h-1 rounded-full bg-slate-300"></span>
                                <span>{file.date}</span>
                            </div>
                        </div>
                    ))}
                </div>
            </section>

            {/* Folders */}
             <section>
                <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-4">Folders</h3>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    {folders.map((folder, idx) => (
                        <div key={idx} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 flex items-center gap-4 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer transition-colors">
                            <div className="w-10 h-10 bg-yellow-100 dark:bg-yellow-900/20 text-yellow-600 dark:text-yellow-500 rounded-lg flex items-center justify-center">
                                <Folder className="w-5 h-5 fill-current" />
                            </div>
                            <div>
                                <h4 className="font-medium text-sm">{folder.name}</h4>
                                <p className="text-xs text-slate-500">{folder.items}</p>
                            </div>
                        </div>
                    ))}
                </div>
            </section>

            {/* All Files List */}
            <section>
                <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-4">All Files</h3>
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
                    <table className="w-full text-sm text-left">
                        <thead className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 border-b border-slate-200 dark:border-slate-800">
                            <tr>
                                <th className="px-6 py-3 font-medium">Name</th>
                                <th className="px-6 py-3 font-medium">Date Modified</th>
                                <th className="px-6 py-3 font-medium">Type</th>
                                <th className="px-6 py-3 font-medium text-right">Size</th>
                                <th className="px-6 py-3 font-medium w-10"></th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                             {allFiles.map((file, idx) => (
                                <tr key={idx} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors group">
                                    <td className="px-6 py-3">
                                        <div className="flex items-center gap-3">
                                            <div className={`w-8 h-8 rounded flex items-center justify-center ${
                                                file.name.endsWith('zip') ? 'bg-orange-100 text-orange-600' :
                                                file.name.endsWith('docx') ? 'bg-blue-100 text-blue-600' :
                                                'bg-red-100 text-red-600'
                                            }`}>
                                                <file.icon className="w-4 h-4" />
                                            </div>
                                            <span className="font-medium">{file.name}</span>
                                        </div>
                                    </td>
                                    <td className="px-6 py-3 text-slate-500">{file.date}</td>
                                    <td className="px-6 py-3 text-slate-500">{file.type}</td>
                                    <td className="px-6 py-3 text-slate-500 text-right">{file.size}</td>
                                    <td className="px-6 py-3 text-right">
                                        <button className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
                                            <MoreHorizontal className="w-4 h-4" />
                                        </button>
                                    </td>
                                </tr>
                             ))}
                        </tbody>
                    </table>
                </div>
            </section>
        </div>
    );
};
