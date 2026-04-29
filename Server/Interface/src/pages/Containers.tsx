import { useState, useEffect, useCallback } from "react";
import { useAuth } from "../contexts/AuthContext";

const API = "/api/agent";

export default function AgentPage() {
  const { token } = useAuth();
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [working, setWorking] = useState(false);

  const authHeader = { Authorization: `Bearer ${token}` };

  const fetchKey = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`${API}/key`, { headers: authHeader });
      if (r.status === 404) { setApiKey(null); return; }
      if (!r.ok) throw new Error(await r.text());
      const data = await r.json();
      setApiKey(data.api_key);
    } catch (e: any) {
      setError(String(e.message ?? e));
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { fetchKey(); }, [fetchKey]);

  async function register() {
    setWorking(true);
    setError(null);
    try {
      const r = await fetch(`${API}/register`, {
        method: "POST",
        headers: authHeader,
      });
      if (!r.ok) throw new Error(await r.text());
      const data = await r.json();
      setApiKey(data.api_key);
    } catch (e: any) {
      setError(String(e.message ?? e));
    } finally {
      setWorking(false);
    }
  }

  async function deleteKey() {
    if (!confirm("Delete your agent API key? The Electron app will need to be reconfigured.")) return;
    setWorking(true);
    setError(null);
    try {
      const r = await fetch(`${API}/key`, { method: "DELETE", headers: authHeader });
      if (!r.ok) throw new Error(await r.text());
      setApiKey(null);
    } catch (e: any) {
      setError(String(e.message ?? e));
    } finally {
      setWorking(false);
    }
  }

  async function resetSession() {
    if (!apiKey) return;
    setWorking(true);
    setError(null);
    try {
      const r = await fetch(`${API}/session`, {
        method: "DELETE",
        headers: { "X-API-Key": apiKey },
      });
      if (!r.ok && r.status !== 204) throw new Error(await r.text());
    } catch (e: any) {
      setError(String(e.message ?? e));
    } finally {
      setWorking(false);
    }
  }

  function copy() {
    if (!apiKey) return;
    navigator.clipboard.writeText(apiKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (loading) return <div className="p-8 text-gray-400">Loading...</div>;

  return (
    <div className="p-8 max-w-2xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold text-white">Agent API Key</h1>
      <p className="text-gray-400 text-sm">
        Your API key connects the Electron app to the shared agent pool running on this
        server. Generate one key per account and paste it into the Electron app settings.
      </p>

      {error && (
        <div className="bg-red-900/40 border border-red-700 rounded-lg p-3 text-red-300 text-sm">
          {error}
        </div>
      )}

      {apiKey ? (
        <div className="space-y-4">
          {/* Key display */}
          <div className="bg-gray-800 rounded-lg p-4 space-y-2">
            <p className="text-xs text-gray-400 uppercase tracking-wide font-medium">Your API Key</p>
            <div className="flex items-center gap-3">
              <code className="flex-1 text-green-400 text-sm break-all">{apiKey}</code>
              <button
                onClick={copy}
                className="shrink-0 px-3 py-1 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded text-xs"
              >
                {copied ? "Copied!" : "Copy"}
              </button>
            </div>
          </div>

          {/* Usage */}
          <div className="bg-gray-800 rounded-lg p-4 space-y-2">
            <p className="text-xs text-gray-400 uppercase tracking-wide font-medium">Usage (Electron app)</p>
            <pre className="text-green-400 text-xs overflow-x-auto whitespace-pre-wrap break-all">{
`# Agent chat endpoint
POST ${window.location.origin}/api/agent/chat
X-API-Key: ${apiKey}

{"message": "Hello!", "tools": []}`
            }</pre>
          </div>

          {/* Info */}
          <div className="bg-blue-900/30 border border-blue-700 rounded-lg p-4 text-sm text-blue-300 space-y-1">
            <p>The server runs <strong>5 parallel agent workers</strong>. If all 5 are busy, your request queues and runs as soon as one finishes.</p>
            <p>Each worker resumes your conversation history automatically. Use "Reset session" to start a fresh chat.</p>
          </div>

          {/* Actions */}
          <div className="flex gap-3 flex-wrap">
            <button
              onClick={resetSession}
              disabled={working}
              className="px-4 py-2 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-white rounded-lg text-sm"
            >
              Reset session
            </button>
            <button
              onClick={deleteKey}
              disabled={working}
              className="px-4 py-2 bg-red-700 hover:bg-red-600 disabled:opacity-50 text-white rounded-lg text-sm"
            >
              Delete API key
            </button>
          </div>
        </div>
      ) : (
        <div className="bg-gray-800 rounded-lg p-6 space-y-4">
          <p className="text-gray-300 text-sm">
            You don''t have an agent API key yet. Generate one to connect the Electron app to
            the server''s agent pool.
          </p>
          <button
            onClick={register}
            disabled={working || !token}
            className="w-full py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg text-sm font-medium"
          >
            {working ? "Generating..." : "Generate API key"}
          </button>
          {!token && (
            <p className="text-yellow-400 text-xs text-center">Log in first to generate a key.</p>
          )}
        </div>
      )}

      {/* ZIP download section - still available for self-hosting */}
      <div className="border-t border-gray-800 pt-6">
        <h2 className="text-lg font-semibold text-white mb-2">Self-hosting (optional)</h2>
        <p className="text-gray-400 text-sm mb-3">
          Prefer to run the agent locally? Download the container bundle and run it yourself.
          Point the Electron app''s "container URL" to your local instance.
        </p>
        <a
          href="/api/containers/download"
          download
          className="inline-block px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded text-sm"
        >
          Download container bundle (ZIP)
        </a>
      </div>
    </div>
  );
}
