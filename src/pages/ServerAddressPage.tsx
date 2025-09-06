import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { validateServer } from "@/lib/jellyfin";
import { syncService } from "@/lib/sync";
import { showError, showSuccess } from "@/utils/toast";

// Removed DEFAULT_PORTS; we now only try protocol variants without explicit ports

const guessAddressVariants = (raw: string) => {
  const trimmed = raw.trim();
  if (!trimmed) return [] as string[];

  const ensureStableForDemo = (urlStr: string) => {
    try {
      const u = new URL(urlStr);
      // Append /stable for demo.jellyfin.org only when no explicit port and no path provided
      if (u.hostname === "demo.jellyfin.org" && !u.port) {
        if (!u.pathname || u.pathname === "/") {
          u.pathname = "/stable";
        }
      }
      // Normalize: drop trailing slash
      return u.toString().replace(/\/$/, "");
    } catch {
      return urlStr.replace(/\/$/, "");
    }
  };

  // If user already typed protocol (optionally with port/path) handle directly
  if (/^https?:\/\//i.test(trimmed)) {
    return [ensureStableForDemo(trimmed)];
  }

  // No protocol: split potential path from host
  const noSlash = trimmed.replace(/\/$/, "");
  const [hostPart, ...pathParts] = noSlash.split("/");
  const hasPath = pathParts.length > 0 && pathParts.join("/").length > 0;

  const candidates = [`https://${noSlash}`, `http://${noSlash}`];

  // If host is demo.jellyfin.org with no explicit port and no path, append /stable
  if (hostPart === "demo.jellyfin.org" && !hostPart.includes(":") && !hasPath) {
    return Array.from(
      new Set([
        ensureStableForDemo(`https://${hostPart}`),
        ensureStableForDemo(`http://${hostPart}`),
      ])
    );
  }

  return Array.from(new Set(candidates.map(ensureStableForDemo)));
};

const ServerAddressPage = () => {
  const navigate = useNavigate();
  const [rawInput, setRawInput] = useState(
    localStorage.getItem("jellyfinServerRaw") || ""
  );
  const [status, setStatus] = useState<
    | { state: "idle" }
    | { state: "validating" }
    | { state: "error"; message: string }
    | { state: "success"; address: string; name?: string; version?: string }
  >({ state: "idle" });

  // Auto-focus UX improvement (could add ref)
  useEffect(() => {
    if (rawInput) {
      // Pre-validate previously stored server silently
      handleValidate(undefined, true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleValidate = async (
    e?: React.FormEvent,
    silent = false
  ): Promise<string | undefined> => {
    if (e) e.preventDefault();
    setStatus({ state: "validating" });

    const candidates = guessAddressVariants(rawInput);
    for (const candidate of candidates) {
      try {
        const res = await validateServer(candidate);
        if (res.valid) {
          // If the server changed (and this isn't a silent pre-validate), clear local DB
          const prev = localStorage.getItem("jellyfinServer");
          const serverChanged = prev && prev !== candidate;
          if (!silent && serverChanged) {
            try {
              await syncService.abortSync();
            } catch (_) {
              // ignore
            }
            await syncService.clearDatabase();
          }

          localStorage.setItem("jellyfinServer", candidate);
          localStorage.setItem("jellyfinServerRaw", rawInput);
          if (!silent) showSuccess(`Connected to ${res.name || "server"}`);
          setStatus({
            state: "success",
            address: candidate,
            name: res.name,
            version: res.version,
          });
          return candidate;
        }
      } catch (err) {
        // continue trying others
      }
    }
    const message =
      "Could not validate server. Check host or that Jellyfin is running.";
    if (!silent) showError(message);
    setStatus({ state: "error", message });
    return undefined;
  };

  const handleContinue = async () => {
    if (status.state === "success") {
      navigate("/login", { state: { serverAddress: status.address } });
      return;
    }
    const valid = await handleValidate();
    if (valid) {
      navigate("/login", { state: { serverAddress: valid } });
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-pink-100 via-rose-100 to-pink-200 p-4">
      <div className="fixed inset-0 bg-[radial-gradient(ellipse_at_center,rgba(236,72,153,0.15)_0%,rgba(255,255,255,0)_70%)] -z-20" />
      <div className="fixed inset-0 bg-gradient-to-br from-pink-200/40 via-rose-200/40 to-pink-300/40 backdrop-blur-3xl -z-10" />
      <div className="w-full max-w-lg space-y-8">
        <div className="text-center space-y-3">
          <div className="mx-auto w-20 h-20 rounded-2xl bg-gradient-to-br from-pink-200/80 to-rose-300/80 flex items-center justify-center shadow-lg backdrop-blur-sm border border-white/50 overflow-hidden">
            <img src="./Foxy.svg" alt="Foxy" className="w-14 h-14" />
          </div>
          <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-pink-600 to-rose-600">
            Connect to Jellyfin
          </h1>
          <p className="text-pink-700/80">
            Enter your server host or URL to continue
          </p>
        </div>

        <form
          onSubmit={handleValidate}
          className="bg-white/40 backdrop-blur-xl rounded-3xl shadow-lg p-8 border border-white/50 space-y-6"
        >
          <div className="space-y-2">
            <Label className="text-pink-800 font-medium" htmlFor="server">
              Server Address or Hostname
            </Label>
            <Input
              id="server"
              placeholder="demo.jellyfin.org/stable"
              value={rawInput}
              onChange={(e) => setRawInput(e.target.value)}
              className="h-12 rounded-xl bg-white/70 border-pink-200 focus:ring-2 focus:ring-pink-300"
              autoFocus
            />
          </div>

          {status.state === "error" && (
            <div className="text-sm text-red-600 bg-red-50/60 border border-red-200 rounded-lg p-3">
              {status.message}
            </div>
          )}
          {status.state === "success" && (
            <div className="text-sm text-green-700 bg-green-50/70 border border-green-200 rounded-lg p-3">
              Connected to {status.name || status.address} (v{status.version})
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <Button
              type="submit"
              disabled={status.state === "validating"}
              className="flex-1 h-12 bg-gradient-to-r from-pink-500 to-rose-500 hover:from-pink-600 hover:to-rose-600 text-white font-medium rounded-xl shadow-lg"
            >
              {status.state === "validating" ? "Validating..." : "Validate"}
            </Button>
            <Button
              type="button"
              onClick={handleContinue}
              disabled={status.state === "validating"}
              className="flex-1 h-12 bg-pink-200 hover:bg-pink-300 text-pink-800 font-medium rounded-xl"
              variant="secondary"
            >
              Continue
            </Button>
          </div>
        </form>

        <div className="text-center text-pink-700/70 text-sm">
          <p>Foxy Desktop v1.0.0</p>
        </div>
      </div>
    </div>
  );
};

export default ServerAddressPage;
