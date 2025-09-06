import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useLocation, useNavigate } from "react-router-dom";
import { showError, showSuccess } from "@/utils/toast";
import { Loader2, Copy, Check } from "lucide-react";
import { authenticate } from "@/lib/jellyfin";
import { useMusicPlayer } from "@/contexts/MusicContext";

const LoginPage = () => {
  const location = useLocation();
  const serverAddress =
    location.state?.serverAddress ||
    localStorage.getItem("jellyfinServer") ||
    "";
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [quickConnectCode, setQuickConnectCode] = useState("");
  const [isPolling, setIsPolling] = useState(false);
  const [quickConnectError, setQuickConnectError] = useState("");
  const [copied, setCopied] = useState(false);
  const stopPollingRef = useRef<() => void>(() => {});
  const navigate = useNavigate();
  const { clearQueue } = useMusicPlayer();

  const maybeClearNowPlaying = (newServer: string) => {
    try {
      const prevAuth = JSON.parse(localStorage.getItem("authData") || "{}");
      const prevServer = prevAuth?.serverAddress as string | undefined;
      if (prevServer && prevServer !== newServer) {
        // Clear persisted and in-memory now playing state when switching servers
        localStorage.removeItem("savedQueue");
        try {
          clearQueue();
        } catch {}

        // Also clear cached sidebar/profile/sync state to avoid cross-server leakage
        try {
          localStorage.removeItem("userProfile.cache");
          localStorage.removeItem("serverInfo.cache");
          localStorage.removeItem("syncStatus.cache");
          localStorage.removeItem("syncStatus.last");
        } catch {}
      }
    } catch {}
  };

  // Automatically start Quick Connect on component mount
  useEffect(() => {
    if (serverAddress) {
      startQuickConnect();
    }

    return () => {
      stopPollingRef.current();
    };
  }, [serverAddress]);

  const startQuickConnect = async () => {
    setIsPolling(true);
    setQuickConnectError("");

    try {
      stopPollingRef.current = await authenticate.startQuickConnect(
        serverAddress,
        {
          onCode: (code) => {
            setQuickConnectCode(code);
            showSuccess("Quick Connect code generated!");
          },
          onSuccess: (authData) => {
            showSuccess("Quick Connect successful!");
            // If signing into a different server, clear saved now playing state
            maybeClearNowPlaying(authData.serverAddress);
            localStorage.setItem("authData", JSON.stringify(authData));
            navigate("/home");
          },
          onError: (error) => {
            setQuickConnectError(error);
            setIsPolling(false);
            showError(error);
          },
        }
      );
    } catch (error) {
      setQuickConnectError("Failed to start Quick Connect");
      setIsPolling(false);
      showError("Failed to start Quick Connect");
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      const authData = await authenticate.withCredentials(
        serverAddress,
        username,
        password
      );
      showSuccess("Login successful");
      // If signing into a different server, clear saved now playing state
      maybeClearNowPlaying(authData.serverAddress);
      localStorage.setItem("authData", JSON.stringify(authData));
      navigate("/home");
    } catch (error) {
      showError("Invalid username or password");
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopyCode = async () => {
    if (!quickConnectCode) return;
    try {
      await navigator.clipboard.writeText(quickConnectCode);
      setCopied(true);
      showSuccess("Code copied");
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      showError("Failed to copy code");
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-pink-100 via-rose-100 to-pink-200 p-4">
      <div className="fixed inset-0 bg-[radial-gradient(ellipse_at_center,rgba(236,72,153,0.15)_0%,rgba(255,255,255,0)_70%)] -z-20" />
      <div className="fixed inset-0 bg-gradient-to-br from-pink-200/25 via-rose-200/25 to-pink-300/25 backdrop-blur-3xl -z-10" />

      <div className="w-full max-w-md">
        <div className="text-center mb-10">
          <div className="bg-gradient-to-br from-pink-200/80 to-rose-300/80 w-20 h-20 rounded-2xl mx-auto flex items-center justify-center shadow-lg backdrop-blur-sm border border-white/50 mb-6">
            <img src="./Foxy.svg" alt="Foxy" className="w-14 h-14" />
          </div>
          <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-pink-600 to-rose-600 mb-2">
            Foxy
          </h1>
          <p className="text-pink-700/80">Sign in to your account</p>
        </div>

        <div className="bg-white/30 backdrop-blur-xl rounded-3xl shadow-lg p-8 border border-white/50">
          <form onSubmit={handleLogin} className="space-y-6">
            <div>
              <Label className="text-pink-800 font-medium mb-2 block">
                Username
              </Label>
              <Input
                type="text"
                placeholder="Enter your username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="text-base h-12 rounded-xl bg-white/60 border-pink-200 focus:ring-2 focus:ring-pink-300"
                required
              />
            </div>

            <div>
              <Label className="text-pink-800 font-medium mb-2 block">
                Password
              </Label>
              <Input
                type="password"
                placeholder="Enter your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="text-base h-12 rounded-xl bg-white/60 border-pink-200 focus:ring-2 focus:ring-pink-300"
              />
            </div>

            <Button
              type="submit"
              className="w-full h-14 bg-gradient-to-r from-pink-500 to-rose-500 hover:from-pink-600 hover:to-rose-600 text-white text-lg font-medium rounded-xl shadow-lg transition-all"
              disabled={isLoading}
            >
              {isLoading ? (
                <Loader2 className="animate-spin mx-auto" />
              ) : (
                "Sign In"
              )}
            </Button>
          </form>

          {/* Quick Connect section */}
          <div className="mt-8">
            <div className="relative flex items-center">
              <div className="flex-grow border-t border-pink-200/70"></div>
              <span className="flex-shrink mx-4 text-pink-700/80 text-sm">
                Quick Connect
              </span>
              <div className="flex-grow border-t border-pink-200/70"></div>
            </div>

            <div className="mt-6 text-center">
              {quickConnectCode ? (
                <div className="mt-4 bg-pink-50/50 rounded-lg p-4 border border-pink-200/50 text-center relative">
                  <p className="text-pink-700 font-medium">
                    Quick Connect Code
                  </p>
                  <div className="mt-1 flex items-center justify-center gap-3">
                    <p className="text-2xl font-bold tracking-wider text-pink-800">
                      {quickConnectCode}
                    </p>
                    <button
                      type="button"
                      onClick={handleCopyCode}
                      className="inline-flex items-center justify-center h-12 w-12 rounded-xl text-pink-600 hover:text-pink-700 transition outline-none"
                      aria-label="Copy code"
                    >
                      {copied ? (
                        <Check className="h-8 w-8" />
                      ) : (
                        <Copy className="h-8 w-8" />
                      )}
                    </button>
                  </div>
                  <p className="text-pink-600/80 text-sm mt-2">
                    Enter this code in your Jellyfin app
                  </p>

                  {isPolling && (
                    <div className="mt-4 flex items-center justify-center">
                      <Loader2 className="animate-spin mr-2 text-pink-500" />
                      <span className="text-pink-600">
                        Waiting for authentication...
                      </span>
                    </div>
                  )}
                </div>
              ) : (
                <div className="mt-4 flex items-center justify-center">
                  {isPolling ? (
                    <>
                      <Loader2 className="animate-spin mr-2 text-pink-500" />
                      <span className="text-pink-600">
                        Setting up Quick Connect...
                      </span>
                    </>
                  ) : (
                    <p className="text-pink-600/80">
                      Preparing Quick Connect...
                    </p>
                  )}
                </div>
              )}

              {quickConnectError && (
                <div className="mt-4 text-red-500 bg-red-50/50 rounded-lg p-3">
                  {quickConnectError}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="mt-6 text-center">
          <button
            className="text-pink-700 hover:text-pink-800 text-sm font-medium flex items-center justify-center mx-auto"
            onClick={() => navigate("/server")}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-4 w-4 mr-1.5"
              viewBox="0 0 20 20"
              fill="currentColor"
            >
              <path
                fillRule="evenodd"
                d="M9.707 14.707a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 1.414L7.414 9H15a1 1 0 110 2H7.414l2.293 2.293a1 1 0 010 1.414z"
                clipRule="evenodd"
              />
            </svg>
            Change server
          </button>
        </div>

        <div className="mt-8 text-center text-pink-600/70 text-sm">
          <p>Foxy Desktop v1.0.0</p>
        </div>
      </div>
    </div>
  );
};

export default LoginPage;
