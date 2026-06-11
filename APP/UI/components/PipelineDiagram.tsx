import React, { useState } from 'react';
import {
  ChevronDown, ChevronRight,
  Search, FolderPlus, FolderOpen, ArrowRight, List,
  Pencil, Trash2, Image, Video, Music, FileText,
  Zap, GitBranch, HardDrive, ScanLine, MoveRight,
  CheckCircle2, XCircle,
} from 'lucide-react';

export interface PipelineStep {
  tool: string;
  desc: string;
  result: string;
  status: 'done' | 'error';
}

// ── helpers ──────────────────────────────────────────────────────────────────

function getToolLabel(tool: string): string {
  const map: Record<string, string> = {
    smart_drive_scan:   'Scan Drive',
    smart_drive_build:  'Build Drive',
    drive_file_mover:   'Move Files',
    drive_creator:      'Create Drive',
    drive_list:         'List Drives',
    drive_inspector:    'Inspect Drive',
    drive_rename:       'Rename Drive',
    drive_delete:       'Delete Drive',
    image_converter:    'Convert Images',
    remove_background:  'Remove BG',
    image_to_svg:       'Vectorize',
    video_converter:    'Convert Video',
    video_compressor:   'Compress Video',
    audio_converter:    'Convert Audio',
    pdf_merger:         'Merge PDFs',
    model_converter:    'Convert 3D',
    document_converter: 'Convert Docs',
    document_analytics: 'Analyze Docs',
    subtitle_generator: 'Generate Subs',
    space_analyzer:     'Analyze Space',
    file_content_reader:'Read Content',
    ask_user:           'Ask User',
    hello:              'Hello',
  };
  return map[tool] ?? tool.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function getToolIcon(tool: string): React.ReactNode {
  const sz = 13;
  if (tool.startsWith('smart_drive_scan'))   return <Search size={sz} />;
  if (tool.startsWith('smart_drive_build'))  return <FolderPlus size={sz} />;
  if (tool === 'drive_file_mover')           return <MoveRight size={sz} />;
  if (tool === 'drive_creator')              return <FolderPlus size={sz} />;
  if (tool === 'drive_list')                 return <List size={sz} />;
  if (tool === 'drive_inspector')            return <FolderOpen size={sz} />;
  if (tool === 'drive_rename')               return <Pencil size={sz} />;
  if (tool === 'drive_delete')               return <Trash2 size={sz} />;
  if (tool.includes('image'))                return <Image size={sz} />;
  if (tool.includes('video'))                return <Video size={sz} />;
  if (tool.includes('audio'))                return <Music size={sz} />;
  if (tool.includes('pdf') || tool.includes('document') || tool.includes('subtitle')) return <FileText size={sz} />;
  if (tool === 'file_content_reader')        return <Eye size={sz} />;
  if (tool.includes('space'))                return <ScanLine size={sz} />;
  if (tool.includes('drive'))                return <HardDrive size={sz} />;
  return <Zap size={sz} />;
}

// Returns a CSS variable name (without var()) for each tool family
function getToolAccent(tool: string): { bg: string; fg: string; border: string } {
  if (tool.startsWith('smart_drive'))
    return { bg: 'var(--c-violet-bg, #f0ebff)', fg: 'var(--c-violet, #7c3aed)', border: 'var(--c-violet-border, #ddd6fe)' };
  if (tool.includes('drive'))
    return { bg: 'var(--c-sky-bg)', fg: 'var(--c-sky)', border: 'var(--c-sky-border, #bae6fd)' };
  if (tool.includes('image') || tool.includes('video') || tool.includes('audio'))
    return { bg: 'var(--c-amber-bg, #fffbeb)', fg: 'var(--c-amber, #d97706)', border: 'var(--c-amber-border, #fde68a)' };
  if (tool.includes('document') || tool.includes('pdf') || tool.includes('subtitle'))
    return { bg: 'var(--c-sage-bg)', fg: 'var(--c-sage)', border: 'var(--c-sage-border, #bbf7d0)' };
  return { bg: 'var(--surface-2)', fg: 'var(--ink-2)', border: 'var(--border)' };
}

function getMetric(tool: string, resultStr: string): string {
  try {
    const r = JSON.parse(resultStr);
    if (r.error) return '✗ ' + String(r.error).slice(0, 36);

    switch (tool) {
      case 'smart_drive_scan':
        return r.files?.length != null ? `${r.files.length} files found` : 'scanned';
      case 'smart_drive_build': {
        const parts = (r.drivePath ?? '').replace(/\\/g, '/').split('/');
        const name = parts[parts.length - 1] || null;
        return name ? `"${name}" built` : r.succeeded != null ? `${r.succeeded} files` : 'built';
      }
      case 'drive_file_mover':
        return r.moved != null ? `${r.moved} ${r.action === 'copy' ? 'copied' : 'moved'}` : 'moved';
      case 'drive_creator':
        return r.succeeded != null ? `${r.succeeded}/${r.total} files` : 'created';
      case 'drive_list':
        return r.drives?.length != null ? `${r.drives.length} drives` : 'listed';
      case 'drive_inspector':
        return r.total != null ? `${r.total} files` : 'inspected';
      case 'drive_rename':
        return r.newName ? `→ "${r.newName}"` : 'renamed';
      case 'drive_delete':
        return r.filesDeleted != null ? `${r.filesDeleted} files` : 'deleted';
      case 'file_content_reader': {
        const n = r.results?.length ?? 0;
        return n > 0 ? `${n} file${n > 1 ? 's' : ''} read` : 'analyzed';
      }
      default:
        if (r.succeeded != null && r.total != null) return `${r.succeeded}/${r.total}`;
        if (r.total != null)                        return `${r.total} items`;
        if (r.outputPath) {
          const p = String(r.outputPath).replace(/\\/g, '/').split('/').pop() ?? '';
          return p.length > 22 ? p.slice(0, 22) + '…' : p;
        }
        return r.success ? 'done' : 'failed';
    }
  } catch {
    return '';
  }
}

// ── sub-components ────────────────────────────────────────────────────────────

const PipeConnector: React.FC = () => (
  <div style={{
    display: 'flex', alignItems: 'center',
    flexShrink: 0, padding: '0 2px',
  }}>
    <div style={{ width: 18, height: 1.5, background: 'var(--border-2)', borderRadius: 1 }} />
    <div style={{
      width: 0, height: 0,
      borderTop: '4px solid transparent',
      borderBottom: '4px solid transparent',
      borderLeft: '6px solid var(--border-2)',
    }} />
  </div>
);

const PipeNode: React.FC<{ step: PipelineStep; index: number }> = ({ step, index }) => {
  const accent = getToolAccent(step.tool);
  const metric = getMetric(step.tool, step.result);
  const isError = step.status === 'error';

  return (
    <div
      title={step.desc}
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5,
        padding: '9px 13px',
        background: isError ? 'var(--c-clay-bg)' : accent.bg,
        border: `1px solid ${isError ? 'var(--c-clay-border, #fecaca)' : accent.border}`,
        borderRadius: 10,
        minWidth: 100, maxWidth: 130,
        flexShrink: 0,
        position: 'relative',
      }}
    >
      {/* Step index bubble */}
      <span style={{
        position: 'absolute', top: -7, left: '50%', transform: 'translateX(-50%)',
        background: isError ? 'var(--c-clay)' : accent.fg,
        color: '#fff',
        fontSize: 9, fontWeight: 700,
        width: 16, height: 16, borderRadius: '50%',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        lineHeight: 1,
      }}>
        {index + 1}
      </span>

      {/* Icon */}
      <span style={{ color: isError ? 'var(--c-clay)' : accent.fg }}>
        {getToolIcon(step.tool)}
      </span>

      {/* Tool label */}
      <span style={{
        fontSize: 11, fontWeight: 600,
        color: isError ? 'var(--c-clay)' : accent.fg,
        textAlign: 'center', lineHeight: 1.2,
        whiteSpace: 'nowrap',
      }}>
        {getToolLabel(step.tool)}
      </span>

      {/* Metric */}
      {metric && (
        <span style={{
          fontSize: 10, color: isError ? 'var(--c-clay)' : 'var(--ink-2)',
          textAlign: 'center', lineHeight: 1.3,
          maxWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {metric}
        </span>
      )}

      {/* Status icon */}
      <span style={{ color: isError ? 'var(--c-clay)' : 'var(--c-sage)', marginTop: 2 }}>
        {isError
          ? <XCircle size={11} />
          : <CheckCircle2 size={11} />
        }
      </span>
    </div>
  );
};

// ── main export ───────────────────────────────────────────────────────────────

export const PipelineDiagram: React.FC<{
  steps: PipelineStep[];
  /** show heading row — set false when embedding inside RunCard which has its own chrome */
  showHeader?: boolean;
}> = ({ steps, showHeader = true }) => {
  const [open, setOpen] = useState(true);

  // Filter to meaningful tool steps only
  const nodes = steps.filter(
    s => s.tool && s.tool !== 'ask_user' && s.tool !== 'hello',
  );

  if (nodes.length < 2) return null;

  return (
    <div style={{
      marginTop: 12,
      paddingTop: 12,
      borderTop: '1px dashed var(--border)',
    }}>
      {showHeader && (
        <button
          onClick={() => setOpen(v => !v)}
          style={{
            display: 'flex', alignItems: 'center', gap: 5,
            fontSize: 11, fontWeight: 600, color: 'var(--muted)',
            marginBottom: open ? 10 : 0,
            textTransform: 'uppercase', letterSpacing: '.07em',
          }}
        >
          {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
          <GitBranch size={11} />
          Pipeline Flow · {nodes.length} steps
        </button>
      )}

      {open && (
        <div style={{ overflowX: 'auto', paddingBottom: 6, paddingTop: showHeader ? 0 : 2 }}>
          <div style={{
            display: 'flex', alignItems: 'center',
            gap: 0,
            minWidth: 'max-content',
            padding: '8px 2px 4px',
          }}>
            {nodes.map((step, idx) => (
              <React.Fragment key={idx}>
                <PipeNode step={step} index={idx} />
                {idx < nodes.length - 1 && <PipeConnector />}
              </React.Fragment>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
