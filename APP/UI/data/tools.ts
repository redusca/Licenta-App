// ────────────────────────────────────────────────────────────────────────────
// Type definitions for the tool catalog.
//
// Data lives in the Python backend (APP/src/tools/catalog.py) and is fetched
// at runtime via GET /api/tools/catalog.  These types mirror the Python dicts
// so TypeScript can check the response shape.
// ────────────────────────────────────────────────────────────────────────────

export type CategoryKey =
    | 'image'
    | 'audio'
    | 'video'
    | 'documents'
    | '3d'
    | 'database'
    | 'programming'
    | 'test';

export interface ToolField {
    /** Machine-readable key sent to the agent */
    key: string;
    /** Human-readable label shown in the UI */
    label: string;
    /** Data type expected by the tool */
    type: 'file' | 'string' | 'number' | 'boolean' | 'select' | 'multifile';
    /** What this field represents; used by the agent to map user intent */
    description: string;
    /** Whether the field must be provided */
    required: boolean;
    /** Allowed file extensions when type === 'file' | 'multifile' */
    acceptedExtensions?: string[];
    /** Predefined options when type === 'select' */
    options?: string[];
    /** Default value */
    default?: string | number | boolean;
}

export interface ToolDefinition {
    /** Unique slug — used in URLs and agent calls */
    id: string;
    /** Display name */
    name: string;
    /** Semver string */
    version: string;
    /** One-line summary shown on cards */
    description: string;
    /** Full description shown on the detail page */
    longDescription: string;
    /** Which category sections the tool appears in (can be multiple) */
    categories: CategoryKey[];
    /** File extensions this tool operates on */
    fileExtensions: string[];
    /** Whether this tool invokes an AI/LLM model */
    usesAI: boolean;
    /** Lucide icon name (string, resolved in components) */
    icon: string;
    /** Tailwind accent colour used for badges and icon backgrounds */
    accentColor: string;
    /** Who built/maintains the tool */
    author: string;
    /** Ordered input fields the tool expects */
    fields: ToolField[];
    /** Human-readable usage steps shown on the detail page */
    usageSteps: string[];
    /** Free-form tags for search / filtering */
    tags: string[];
}

export interface CategoryMeta {
    key: CategoryKey;
    label: string;
    /** Tailwind colour stem (e.g. "blue") */
    color: string;
    icon: string;
    description: string;
}

export interface ToolCatalog {
    tools: ToolDefinition[];
    categories: CategoryMeta[];
}
