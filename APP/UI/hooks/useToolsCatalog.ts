import { useState, useEffect } from 'react';
import type { ToolDefinition, CategoryMeta, ToolCatalog } from '../data/tools';
import { STATIC_CATALOG } from '../data/tools';

const CATALOG_URL = 'http://127.0.0.1:5000/api/tools/catalog';

interface UseCatalogResult {
    tools: ToolDefinition[];
    categories: CategoryMeta[];
    loading: boolean;
    error: string | null;
    /** Whether the catalog is coming from the static fallback (server unreachable) */
    isOffline: boolean;
    /** Re-fetch the catalog (e.g. after adding a new tool at runtime) */
    reload: () => void;
}

export function useToolsCatalog(): UseCatalogResult {
    const [catalog, setCatalog] = useState<ToolCatalog>({ tools: [], categories: [] });
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [isOffline, setIsOffline] = useState(false);
    const [tick, setTick] = useState(0);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setError(null);
        setIsOffline(false);

        fetch(CATALOG_URL)
            .then(r => {
                if (!r.ok) throw new Error(`Server returned ${r.status}`);
                return r.json() as Promise<ToolCatalog>;
            })
            .then(data => {
                if (!cancelled) {
                    setCatalog(data);
                }
            })
            .catch(() => {
                // Server unreachable — fall back to the static catalog so tools remain usable
                if (!cancelled) {
                    setCatalog(STATIC_CATALOG);
                    setIsOffline(true);
                }
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
        isOffline,
        reload: () => setTick(t => t + 1),
    };
}
