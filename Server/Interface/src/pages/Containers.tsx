import { useState, useEffect, useCallback } from "react";
import { useAuth } from "../contexts/AuthContext";

const API = "/api/containers";

type ContainerMode = "server_hosted" | "self_hosted";

interface ContainerOut {
  id: string;
  mode: ContainerMode;
  status: "running" | "stopped" | "pending";
  internal_url: string | null;
  api_key: string;
}

function modeLabel(m: ContainerMode) {
  return m === "server_hosted" ? "Hosted on server" : "Running locally";
}

export default function Containers() {
  const { token } = useAuth();
  const [container, setContainer] = useState<ContainerOut | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ── deploy form state ────────────────────────────────────────────────────
  const [mode, setMode] = useState<ContainerMode>("server_hosted");
  const [containerName, setContainerName] = useState("");
  const [selfHostedUrl, setSelfHostedUrl] = useState("");
  const [selfHostedStep, setSelfHostedStep] = useState<1 | 2 | 3>(1);
  const [deploying, setDeploying] = useState(false);

  const authHeader = { Authorization: `Bearer ${token}` };

  // ── fetch status ─────────────────────────────────────────────────────────
  const fetchStatus = useCallback(async () => {
    try {
      const r = await fetch(`${API}/status`, { headers: authHeader });
      if (r.status === 404) { setContainer(null); return; }
      if (!r.ok) throw new Error(await r.text());
      const data: ContainerOut = await r.json();
      setContainer(data.status === "stopped" ? null : data);
    } catch (e: any) {
      setContainer(null);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { fetchStatus(); }, [fetchStatus]);

  // ── poll while pending ────────────────────────────────────────────────────
  useEffect(() => {
    if (!container || container.status !== "pending") return;
    const id = setInterval(fetchStatus, 2000);
    return () => clearInterval(id);
  }, [container, fetchStatus]);

  // ── stop ─────────────────────────────────────────────────────────────────
  async function handleStop() {
    if (!confirm("Stop the container?")) return;
    await fetch(`${API}/stop`, { method: "DELETE", headers: authHeader });
    setContainer(null);
  }

  // ── deploy: server-hosted ─────────────────────────────────────────────────
  async function deployServer() {
    setDeploying(true);
    setError(null);
    try {
      const r = await fetch(`${API}/deploy`, {
        method: "POST",
        headers: { ...authHeader, "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "server_hosted", name: containerName || undefined }),
      });
      if (!r.ok) throw new Error(await r.text());
      const data: ContainerOut = await r.json();
      setContainer(data);
    } catch (e: any) {
      setError(String(e.message ?? e));
    } finally {
      setDeploying(false);
    }
  }

  // ── deploy: self-hosted (register URL) ───────────────────────────────────
  async function registerUrl() {
    if (!selfHostedUrl) return;
    setDeploying(true);
    setError(null);
    try {
      const r = await fetch(`${API}/deploy`, {
        method: "POST",
        headers: { ...authHeader, "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "self_hosted", self_hosted_url: selfHostedUrl }),
      });
      if (!r.ok) throw new Error(await r.text());
      const data: ContainerOut = await r.json();
      setContainer(data);
    } catch (e: any) {
      setError(String(e.message ?? e));
    } finally {
      setDeploying(false);
    }
  }

  // ── UI ────────────────────────────────────────────────────────────────────
  if (loading) return <div className="p-8 text-gray-400">Loading…</div>;

  // ── Active container view ─────────────────────────────────────────────────
  if (container) {
    const isProxy = container.mode === "server_hosted";
    const baseUrl = isProxy ? "/api/containers/proxy" : container.internal_url;

    return (
      <div className="p-8 max-w-3xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">Container</h1>
            <div className="flex gap-3 mt-1">
              <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                container.status === "running" ? "bg-green-700 text-green-100" : "bg-yellow-700 text-yellow-100"
              }`}>{container.status}</span>
              <span className="px-2 py-0.5 rounded text-xs font-medium bg-gray-700 text-gray-300">
                {modeLabel(container.mode)}
              </span>
            </div>
          </div>
          <button
            onClick={handleStop}
            className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm"
          >
            Stop
          </button>
        </div>

        <div className="bg-gray-800 rounded-lg p-4 space-y-2">
          <p className="text-sm text-gray-400 font-medium uppercase tracking-wide">API Key</p>
          <code className="block text-green-400 text-sm break-all">{container.api_key}</code>
        </div>

        {container.status === "pending" && (
          <div className="bg-yellow-900/40 border border-yellow-700 rounded-lg p-4 text-yellow-300 text-sm">
            Container is starting up…
          </div>
        )}

        {container.status === "running" && (
          <div className="bg-gray-800 rounded-lg p-4 space-y-3">
            <p className="text-sm text-gray-400 font-medium uppercase tracking-wide">
              {isProxy ? "Proxy usage (requests go through server)" : "Direct connection (connect straight to your container)"}
            </p>
            <pre className="text-green-400 text-xs overflow-x-auto whitespace-pre-wrap break-all">{
              isProxy
                ? `# Chat\ncurl -X POST ${window.location.origin}${baseUrl}/chat/completions \\\n  -H "Authorization: Bearer <your-jwt>" \\\n  -H "Content-Type: application/json" \\\n  -d '{"messages": [{"role": "user", "content": "Hello"}]}'`
                : `# Health check\ncurl ${baseUrl}/health\n\n# Chat\ncurl -X POST ${baseUrl}/chat/completions \\\n  -H "X-API-Key: ${container.api_key}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"messages": [{"role": "user", "content": "Hello"}]}'`
            }</pre>
          </div>
        )}
      </div>
    );
  }

  // ── Setup view ────────────────────────────────────────────────────────────
  return (
    <div className="p-8 max-w-2xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold text-white">Set up a Container</h1>

      {/* Mode tabs */}
      <div className="flex border border-gray-700 rounded-lg overflow-hidden">
        {(["server_hosted", "self_hosted"] as ContainerMode[]).map((m) => (
          <button
            key={m}
            onClick={() => { setMode(m); setError(null); setSelfHostedStep(1); }}
            className={`flex-1 py-2 text-sm font-medium transition-colors ${
              mode === m
                ? "bg-blue-600 text-white"
                : "bg-gray-800 text-gray-400 hover:text-white"
            }`}
          >
            {m === "server_hosted" ? "Host on server" : "Run locally"}
          </button>
        ))}
      </div>

      {error && (
        <div className="bg-red-900/40 border border-red-700 rounded-lg p-3 text-red-300 text-sm">{error}</div>
      )}

      {/* Server-hosted panel */}
      {mode === "server_hosted" && (
        <div className="bg-gray-800 rounded-lg p-6 space-y-4">
          <p className="text-gray-300 text-sm">
            The server will spawn a Docker container for your account. All requests are proxied — you never expose the container directly.
          </p>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Container name <span className="text-gray-600">(optional)</span></label>
            <input
              type="text"
              value={containerName}
              onChange={(e) => setContainerName(e.target.value)}
              placeholder="my-agent"
              className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500"
            />
          </div>
          <button
            onClick={deployServer}
            disabled={deploying}
            className="w-full py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg text-sm font-medium"
          >
            {deploying ? "Deploying…" : "Deploy container"}
          </button>
        </div>
      )}

      {/* Self-hosted panel */}
      {mode === "self_hosted" && (
        <div className="space-y-4">
          {/* Step 1 — Download */}
          <div className={`bg-gray-800 rounded-lg p-5 border ${selfHostedStep >= 1 ? "border-blue-600" : "border-gray-700"}`}>
            <div className="flex items-center gap-3 mb-3">
              <span className="w-6 h-6 rounded-full bg-blue-600 text-white text-xs flex items-center justify-center font-bold">1</span>
              <h3 className="text-white font-medium">Download bundle</h3>
            </div>
            <p className="text-gray-400 text-sm mb-3">
              Download the ZIP archive containing the Docker image and run scripts.
            </p>
            <a
              href={`${API}/download`}
              download
              onClick={() => setSelfHostedStep(2)}
              className="inline-block px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm"
            >
              Download ZIP
            </a>
          </div>

          {/* Step 2 — Run */}
          <div className={`bg-gray-800 rounded-lg p-5 border ${selfHostedStep >= 2 ? "border-blue-600" : "border-gray-700 opacity-60"}`}>
            <div className="flex items-center gap-3 mb-3">
              <span className={`w-6 h-6 rounded-full text-white text-xs flex items-center justify-center font-bold ${selfHostedStep >= 2 ? "bg-blue-600" : "bg-gray-700"}`}>2</span>
              <h3 className="text-white font-medium">Run the container</h3>
            </div>
            <p className="text-gray-400 text-sm mb-2">Extract the ZIP and run the appropriate script:</p>
            <pre className="bg-gray-900 rounded p-3 text-xs text-green-400 mb-3">{
              `# Linux / macOS\nbash run.sh\n\n# Windows\nrun.bat`
            }</pre>
            <p className="text-gray-500 text-xs mb-3">Edit the PORT variable at the top of the script if needed (default 8001).</p>
            {selfHostedStep >= 2 && (
              <button
                onClick={() => setSelfHostedStep(3)}
                className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded text-sm"
              >
                Container is running →
              </button>
            )}
          </div>

          {/* Step 3 — Register */}
          <div className={`bg-gray-800 rounded-lg p-5 border ${selfHostedStep >= 3 ? "border-blue-600" : "border-gray-700 opacity-60"}`}>
            <div className="flex items-center gap-3 mb-3">
              <span className={`w-6 h-6 rounded-full text-white text-xs flex items-center justify-center font-bold ${selfHostedStep >= 3 ? "bg-blue-600" : "bg-gray-700"}`}>3</span>
              <h3 className="text-white font-medium">Register your container URL</h3>
            </div>
            <p className="text-gray-400 text-sm mb-3">Enter the URL where your container is reachable (must include host and port):</p>
            <input
              type="text"
              value={selfHostedUrl}
              onChange={(e) => setSelfHostedUrl(e.target.value)}
              placeholder="http://192.168.1.50:8001"
              disabled={selfHostedStep < 3}
              className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500 disabled:opacity-50 mb-3"
            />
            <button
              onClick={registerUrl}
              disabled={deploying || selfHostedStep < 3 || !selfHostedUrl}
              className="w-full py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg text-sm font-medium"
            >
              {deploying ? "Registering…" : "Register & connect"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}