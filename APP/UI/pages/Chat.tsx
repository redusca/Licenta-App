import React, { useState } from 'react';
import { Send, Bot, User, Paperclip, FileText, FileImage, FileCode, Check } from 'lucide-react';

export const Chat: React.FC = () => {
  const [messages] = useState<any[]>([]);

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)]">
      <div className="flex-1 overflow-y-auto space-y-6 pr-4">
        <div className="flex justify-center mb-6">
           <span className="px-3 py-1 bg-slate-100 dark:bg-slate-800 rounded-full text-xs text-slate-500">Today, 10:23 AM</span>
        </div>

        {messages.map((msg) => (
          <div key={msg.id} className={`flex gap-4 ${msg.sender === 'user' ? 'flex-row-reverse' : ''}`}>
            {/* Avatar */}
            <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${
              msg.sender === 'user' ? 'bg-orange-100' : 'bg-blue-600'
            }`}>
              {msg.sender === 'user' ? (
                <User className="w-6 h-6 text-orange-600" />
              ) : (
                <Bot className="w-6 h-6 text-white" />
              )}
            </div>

            {/* Message Bubble */}
            <div className={`flex flex-col max-w-[80%] ${msg.sender === 'user' ? 'items-end' : 'items-start'}`}>
              <div className="flex items-baseline gap-2 mb-1">
                <span className="text-sm font-semibold">{msg.sender === 'user' ? 'Alex' : 'Agent'}</span>
                <span className="text-xs text-slate-400">{msg.time}</span>
              </div>
              
              <div className={`p-4 rounded-2xl ${
                msg.sender === 'user' 
                  ? 'bg-blue-500 text-white rounded-tr-none' 
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 rounded-tl-none'
              }`}>
                <p className="leading-relaxed">{msg.text}</p>
                
                {msg.hasAction && (
                  <div className="mt-4 bg-white dark:bg-slate-900 rounded-xl p-4 border border-slate-200 dark:border-slate-700">
                    <div className="flex items-center gap-2 mb-3 text-sm font-medium text-slate-500">
                      Preview of proposed changes:
                    </div>
                    
                    <div className="space-y-2 mb-4">
                       <div className="flex items-center justify-between p-2 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-lg text-sm">
                          <div className="flex items-center gap-3">
                             <FileText className="w-4 h-4 text-red-500" />
                             <span>invoice_2023.pdf</span>
                          </div>
                          <span className="px-2 py-0.5 bg-slate-200 dark:bg-slate-700 rounded text-xs">Document</span>
                          <span className="text-slate-400 text-xs">/Downloads/Documents/</span>
                       </div>
                       <div className="flex items-center justify-between p-2 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-lg text-sm">
                          <div className="flex items-center gap-3">
                             <FileImage className="w-4 h-4 text-blue-500" />
                             <span>screenshot_001.png</span>
                          </div>
                          <span className="px-2 py-0.5 bg-slate-200 dark:bg-slate-700 rounded text-xs">Image</span>
                          <span className="text-slate-400 text-xs">/Downloads/Images/</span>
                       </div>
                       <div className="flex items-center justify-between p-2 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-lg text-sm">
                          <div className="flex items-center gap-3">
                             <FileCode className="w-4 h-4 text-purple-500" />
                             <span>setup_v2.dmg</span>
                          </div>
                          <span className="px-2 py-0.5 bg-slate-200 dark:bg-slate-700 rounded text-xs">Installer</span>
                          <span className="text-slate-400 text-xs">/Downloads/Apps/</span>
                       </div>
                    </div>

                    <div className="flex gap-3">
                      <button className="flex-1 bg-blue-600 hover:bg-blue-700 text-white py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-2">
                        <Check className="w-4 h-4" />
                        Confirm & Organize
                      </button>
                      <button className="flex-1 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 py-2 rounded-lg text-sm font-medium">
                        Modify Rules
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 relative">
        <input 
          type="text" 
          placeholder="Ask Agent to organize, find, or summarize files..."
          className="w-full bg-slate-100 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl py-4 pl-4 pr-12 focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all font-medium"
        />
        <button className="absolute right-3 top-3 p-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors">
          <Send className="w-4 h-4" />
        </button>
        <button className="absolute right-14 top-3 p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors">
          <Paperclip className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
