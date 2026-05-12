import React, { useState, useEffect } from 'react';
import { AlertTriangle, Check, X, Wrench, Info } from 'lucide-react';

export interface PendingTool {
  id: string;
  tool: string;
  input: Record<string, any>;
  definition: {
    name?: string;
    description?: string;
    requires_approval?: boolean;
    input_instructions?: string;
    output_description?: string;
    parameters?: {
      properties?: Record<string, { type: string; description?: string }>;
    };
  };
}

interface Props {
  tool: PendingTool;
  onApprove: (id: string, input: Record<string, any>) => void;
  onReject: (id: string) => void;
}

function displayValue(v: any): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function parseValue(raw: string, original: any): any {
  if (typeof original === 'number') return Number(raw) || 0;
  if (typeof original === 'boolean') return raw === 'true';
  if (typeof original === 'object' && original !== null) {
    try { return JSON.parse(raw); } catch { return raw; }
  }
  return raw;
}

export const ToolApprovalModal: React.FC<Props> = ({ tool, onApprove, onReject }) => {
  const [fields, setFields] = useState<Record<string, string>>({});

  useEffect(() => {
    const initial: Record<string, string> = {};
    for (const [k, v] of Object.entries(tool.input)) {
      initial[k] = displayValue(v);
    }
    setFields(initial);
  }, [tool.id]);

  const handleApprove = () => {
    const rebuilt: Record<string, any> = {};
    for (const [k, raw] of Object.entries(fields)) {
      rebuilt[k] = parseValue(raw, tool.input[k]);
    }
    onApprove(tool.id, rebuilt);
  };

  const paramProps = tool.definition.parameters?.properties ?? {};
  const inputKeys = Object.keys(fields);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden">

        {/* Header */}
        <div className="flex items-center gap-3 px-6 py-4 bg-orange-50 dark:bg-orange-900/20 border-b border-orange-200 dark:border-orange-800">
          <div className="p-2 bg-orange-100 dark:bg-orange-800 rounded-xl">
            <AlertTriangle className="w-5 h-5 text-orange-600 dark:text-orange-400" />
          </div>
          <div>
            <p className="text-xs text-orange-600 dark:text-orange-400 font-medium uppercase tracking-wide">
              Agent Tool Request
            </p>
            <h2 className="font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-2">
              <Wrench className="w-4 h-4 text-slate-500" />
              <span className="font-mono">{tool.tool}</span>
            </h2>
          </div>
        </div>

        <div className="px-6 py-4 space-y-4 max-h-[70vh] overflow-y-auto">

          {/* Description */}
          {tool.definition.description && (
            <p className="text-sm text-slate-600 dark:text-slate-400">
              {tool.definition.description}
            </p>
          )}

          {/* Input instructions */}
          {tool.definition.input_instructions && (
            <div className="flex gap-2 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-xl text-sm text-blue-700 dark:text-blue-300">
              <Info className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{tool.definition.input_instructions}</span>
            </div>
          )}

          {/* Output description */}
          {tool.definition.output_description && (
            <div className="text-xs text-slate-500 dark:text-slate-400 italic">
              Output: {tool.definition.output_description}
            </div>
          )}

          {/* Editable input parameters */}
          {inputKeys.length > 0 && (
            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Parameters
              </p>
              {inputKeys.map(key => {
                const schema = paramProps[key];
                return (
                  <div key={key}>
                    <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                      {key}
                      {schema?.description && (
                        <span className="ml-1 text-slate-400 font-normal">— {schema.description}</span>
                      )}
                    </label>
                    <input
                      type="text"
                      value={fields[key] ?? ''}
                      onChange={e => setFields(prev => ({ ...prev, [key]: e.target.value }))}
                      className="w-full text-sm font-mono bg-slate-100 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-colors"
                      spellCheck={false}
                    />
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-3 px-6 py-4 border-t border-slate-200 dark:border-slate-700">
          <button
            onClick={handleApprove}
            className="flex-1 flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-medium py-2.5 px-4 rounded-xl transition-colors"
          >
            <Check className="w-4 h-4" />
            Approve & Run
          </button>
          <button
            onClick={() => onReject(tool.id)}
            className="flex-1 flex items-center justify-center gap-2 bg-slate-200 hover:bg-slate-300 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 font-medium py-2.5 px-4 rounded-xl transition-colors"
          >
            <X className="w-4 h-4" />
            Reject
          </button>
        </div>
      </div>
    </div>
  );
};
