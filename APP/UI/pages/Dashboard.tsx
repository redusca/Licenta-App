import React, { useEffect, useState } from 'react';
import { 
    MoreVertical, 
    Plus
} from 'lucide-react';

export const Dashboard: React.FC = () => {
    const [status, setStatus] = useState<string>('Checking backend...');

    useEffect(() => {
        fetch('http://127.0.0.1:5000/api/health')
            .then(res => res.json())
            .then(data => setStatus(`Backend: ${data.status}`))
            .catch(() => setStatus('Backend: Error'));
    }, []);

    const locations: any[] = [];

    const quickAccess: any[] = [];

    return (
        <div className="space-y-8">
            {/* Header */}
            <div className="flex justify-between items-center">
                <div>
                   <h1 className="text-2xl font-bold tracking-tight">My Drive</h1>
                   <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Pro Plan • {status}</p>
                </div>
                <button className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2">
                    <Plus className="w-4 h-4" />
                    New Folder
                </button>
            </div>

            <div className="flex gap-8">
                {/* Left Column - Locations */}
                <div className="w-64 flex-shrink-0 space-y-6">
                    <div className="space-y-1">
                        <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3 px-2">Locations</h3>
                        {locations.map((loc, idx) => (
                            <div key={idx} className="flex items-center gap-3 p-2 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer transition-colors group">
                                <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${loc.color}`}>
                                    <loc.icon className="w-5 h-5" />
                                </div>
                                <div>
                                    <h4 className="font-medium text-sm text-slate-700 dark:text-slate-200 group-hover:text-blue-600 dark:group-hover:text-blue-400">{loc.name}</h4>
                                    <p className="text-xs text-slate-400">{loc.sub}</p>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Right Column - Grid */}
                <div className="flex-1">
                     <div className="flex justify-between items-center mb-4">
                        <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider">Quick Access</h3>
                        <div className="flex gap-2">
                            {/* Filter icons would go here */}
                        </div>
                     </div>

                     <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                        {quickAccess.map((item, idx) => (
                            <div key={idx} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 hover:shadow-md transition-shadow group relative">
                                <button className="absolute top-3 right-3 text-slate-300 hover:text-slate-600 dark:hover:text-slate-200">
                                    <MoreVertical className="w-4 h-4" />
                                </button>
                                
                                <div className="h-24 flex items-center justify-center mb-4 bg-slate-50 dark:bg-slate-800/50 rounded-lg group-hover:bg-slate-100 dark:group-hover:bg-slate-800 transition-colors">
                                    <item.icon className={`w-12 h-12 ${item.color}`} />
                                </div>
                                
                                <h4 className="font-semibold text-sm truncate">{item.name}</h4>
                                <p className="text-xs text-slate-500 mt-1">{item.type === 'folder' ? item.items : item.size}</p>
                            </div>
                        ))}
                     </div>
                </div>
            </div>
        </div>
    );
};
