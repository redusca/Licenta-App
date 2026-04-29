import { useState, useEffect } from 'react';
import type { ToolDefinition, CategoryMeta, ToolCatalog } from '../data/tools';

const CATALOG_URL = 'http://127.0.0.1:5000/api/tools/catalog';

interface UseCatalogResult {
    tools: ToolDefinition[];
    categories: CategoryMeta[];
    loading: boolean;
    error: string | null;
    /** Re-fetch the catalog (e.g. after adding a new tool at runtime) */
    reload: () => void;
}

export function useToolsCatalog(): UseCatalogResult {
    const [catalog, setCatalog] = useState<ToolCatalog>({ tools: [], categories: [] });
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [tick, setTick] = useState(0);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setError(null);

        fetch(CATALOG_URL)
            .then(r => {
                if (!r.ok) throw new Error(`Server returned ${r.status}`);
                return r.json() as Promise<ToolCatalog>;
            })
            .then(data => {
                if (!cancelled) setCatalog(data);
            })
            .catch((e: unknown) => {
                if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load catalog');
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });

        return () => { cancelled = true; };
    }, [tick]);

    return {
        tools: catalog.tools,
        categories: catalog.categories,
        loading,
        error,
        reload: () => setTick(t => t + 1),
    };
}
