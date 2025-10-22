import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Database, Palette, Volume2, Server } from "lucide-react";
import Sidebar from "@/components/Sidebar";
import BackButton from "@/components/BackButton";
import MusicPlayer from "@/components/MusicPlayer";
import SyncManager from "@/components/SyncManager";
import { hybridData, syncService } from "@/lib/sync";
import { localDb } from "@/lib/database";
import { useAuthData } from "@/hooks/useAuthData";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue,
} from "@/components/ui/select";
import { useMusicPlayer } from "@/contexts/MusicContext";
import { useToast } from "@/hooks/use-toast";
import { clearAllDownloads } from "@/lib/downloads";
import { useTheme } from "next-themes";
import { useOfflineModeContext } from "@/contexts/OfflineModeContext";

export default function SettingsPage() {
  const navigate = useNavigate();
  const { authData, clearAuthData } = useAuthData();
  const { toast } = useToast();
  const { theme, setTheme, systemTheme } = useTheme();
  const {
    isOffline,
    isSimulated,
    simulateOffline,
    setSimulateOffline,
    refreshOfflineStatus,
  } = useOfflineModeContext();
  const [useLocalFirst, setUseLocalFirst] = useState<boolean>(() => {
    const stored = localStorage.getItem("useLocalFirst");
    return stored ? stored === "true" : true;
  });
  const [autoSync, setAutoSync] = useState<boolean>(() => {
    const stored = localStorage.getItem("autoSync");
    return stored ? stored === "true" : false;
  });
  const [showLyrics, setShowLyrics] = useState(false);
  const [refreshingOffline, setRefreshingOffline] = useState(false);

  useEffect(() => {
    localStorage.setItem("useLocalFirst", String(useLocalFirst));
    hybridData.setUseLocalFirst(useLocalFirst);
  }, [useLocalFirst]);

  useEffect(() => {
    localStorage.setItem("autoSync", String(autoSync));
  }, [autoSync]);

  useEffect(() => {
    // initial auto sync if enabled and no data yet
    const init = async () => {
      if (!autoSync) return;
      try {
        const status = await localDb.getSyncStatus();
        const empty =
          !status.albumsCount && !status.artistsCount && !status.tracksCount;
        if (empty) {
          await syncService.startFullSync();
        }
      } catch (e) {}
    };
    init();
  }, [autoSync]);

  const handleLogout = async () => {
    if (window.confirm("Are you sure you want to log out?")) {
      clearAuthData();
      navigate("/login");
    }
  };

  const handleRefreshOffline = async () => {
    setRefreshingOffline(true);
    try {
      await refreshOfflineStatus();
    } finally {
      setRefreshingOffline(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <Sidebar />
      <div className="ml-64 p-6 pb-28">
        {/* Header (non-sticky to match other pages) */}
        {!showLyrics && (
          <div className="mb-8">
            <div className="flex items-center justify-between">
              <h1 className="text-3xl font-bold text-foreground">Settings</h1>
              <BackButton label="Back" />
            </div>
            <p className="text-muted-foreground mt-2">
              Manage your Foxy Music Player preferences
            </p>
          </div>
        )}

        {/* Content hidden when lyrics are open */}
        {!showLyrics && (
          <Tabs defaultValue="sync" className="w-full max-w-6xl">
            <TabsList className="grid w-full grid-cols-4 bg-muted p-1 rounded-lg">
              <TabsTrigger
                value="sync"
                className="flex items-center space-x-2 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm font-medium rounded-md"
              >
                <Database className="w-4 h-4" />
                <span>Sync & Storage</span>
              </TabsTrigger>
              <TabsTrigger
                value="playback"
                className="flex items-center space-x-2 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm font-medium rounded-md"
              >
                <Volume2 className="w-4 h-4" />
                <span>Playback</span>
              </TabsTrigger>
              <TabsTrigger
                value="appearance"
                className="flex items-center space-x-2 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm font-medium rounded-md"
              >
                <Palette className="w-4 h-4" />
                <span>Appearance</span>
              </TabsTrigger>
              <TabsTrigger
                value="account"
                className="flex items-center space-x-2 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm font-medium rounded-md"
              >
                <Server className="w-4 h-4" />
                <span>Server</span>
              </TabsTrigger>
            </TabsList>

            <TabsContent value="sync" className="space-y-6">
              <div>
                <h3 className="text-lg font-medium mb-2">
                  Sync & Storage Settings
                </h3>
                <p className="text-sm text-muted-foreground mb-6">
                  Manage how your music library is synchronized and stored
                  locally for better performance.
                </p>
              </div>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">
                    Performance Settings
                  </CardTitle>
                  <CardDescription>
                    Configure how the app handles data loading and caching.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="flex items-center justify-between">
                    <div className="space-y-1">
                      <div className="text-sm font-medium">
                        Prefer Local Data
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Load music data from local storage first for faster
                        performance
                      </div>
                    </div>
                    <Switch
                      checked={useLocalFirst}
                      onCheckedChange={setUseLocalFirst}
                    />
                  </div>

                  <Separator />

                  <div className="flex items-center justify-between">
                    <div className="space-y-1">
                      <div className="text-sm font-medium">Auto-Sync</div>
                      <div className="text-xs text-muted-foreground">
                        Automatically sync library changes in the background
                      </div>
                    </div>
                    <Switch
                      checked={autoSync}
                      onCheckedChange={(v) => setAutoSync(!!v)}
                    />
                  </div>
                  <Separator />

                  <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 md:gap-4">
                    <div className="space-y-1">
                      <div className="text-sm font-medium">
                        Simulate Offline Mode
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Force Foxy into offline-only mode for testing when the
                        server is reachable.
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        Status: {isOffline ? "Offline" : "Online"}
                        {isOffline && (
                          <span>
                            {" "}
                            ({isSimulated ? "Simulated" : "Detected"})
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <Switch
                        checked={simulateOffline}
                        onCheckedChange={(v) => {
                          void setSimulateOffline(!!v);
                        }}
                      />
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleRefreshOffline}
                        disabled={refreshingOffline}
                      >
                        {refreshingOffline ? "Checking..." : "Refresh"}
                      </Button>
                    </div>
                  </div>
                  <Separator />

                  <div className="flex items-center justify-between">
                    <div className="space-y-1">
                      <div className="text-sm font-medium">
                        Clear All Downloads
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Remove all downloaded media files and cached flags. This
                        cannot be undone.
                      </div>
                    </div>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={async () => {
                        const ok = window.confirm(
                          "This will remove all downloaded songs and downloaded collections. Continue?"
                        );
                        if (!ok) return;
                        try {
                          const res = await clearAllDownloads();
                          toast({
                            title: "Downloads cleared",
                            description: res
                              ? `${res.removed} files removed`
                              : "Done",
                          });
                        } catch (e) {
                          toast({
                            title: "Failed to clear downloads",
                            description: String(e),
                          });
                        }
                      }}
                    >
                      Clear
                    </Button>
                  </div>
                </CardContent>
              </Card>

              <SyncManager />
            </TabsContent>

            <TabsContent value="playback" className="space-y-6">
              <div>
                <h3 className="text-lg font-medium mb-2">Playback Settings</h3>
                <p className="text-sm text-muted-foreground mb-6">
                  Configure audio playback and streaming preferences.
                </p>
              </div>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">
                    Audio Quality & Behaviour
                  </CardTitle>
                  <CardDescription>
                    Adjust volume, speed and playback transitions.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <PlaybackSettingsPanel />
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="appearance" className="space-y-6">
              <div>
                <h3 className="text-lg font-medium mb-2">
                  Appearance Settings
                </h3>
                <p className="text-sm text-muted-foreground mb-6">
                  Customize the look and feel of your music player.
                </p>
              </div>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Theme</CardTitle>
                  <CardDescription>
                    Choose your preferred color scheme.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <div className="text-sm font-medium">Appearance</div>
                    <Select
                      value={(theme as string) || "system"}
                      onValueChange={(v) => setTheme(v)}
                    >
                      <SelectTrigger className="w-60 focus:ring-0 focus:outline-none focus-visible:ring-0">
                        <SelectValue placeholder="Theme" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="system">
                          Automatic (Default)
                        </SelectItem>
                        <SelectItem value="light">Light</SelectItem>
                        <SelectItem value="dark">Dark</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-[11px] text-muted-foreground">
                      Current:{" "}
                      {(theme === "system" ? systemTheme : theme) || "system"}
                    </p>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="account" className="space-y-6">
              <div>
                <h3 className="text-lg font-medium mb-2">Server Settings</h3>
                <p className="text-sm text-muted-foreground mb-6">
                  Manage your Jellyfin server connection and account.
                </p>
              </div>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">
                    Server Information
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <div className="font-medium text-foreground">
                        Server Address
                      </div>
                      <div className="text-muted-foreground">
                        {authData?.serverAddress || "Not connected"}
                      </div>
                    </div>
                    <div>
                      <div className="font-medium text-foreground">User ID</div>
                      <div className="text-muted-foreground font-mono text-xs">
                        {authData?.userId || "N/A"}
                      </div>
                    </div>
                  </div>

                  <Separator />

                  <div className="flex justify-end">
                    <Button
                      onClick={handleLogout}
                      variant="destructive"
                      size="sm"
                      className="text-sm px-4 py-2"
                    >
                      Sign Out
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        )}
      </div>
      <MusicPlayer
        showLyrics={showLyrics}
        onLyricsToggle={(show) => setShowLyrics(show)}
      />
    </div>
  );
}

function PlaybackSettingsPanel() {
  const {
    volume,
    setVolume,
    quality,
    setQuality,
    normalizeEnabled,
    setNormalizeEnabled,
    crossfadeSeconds,
    setCrossfadeSeconds,
  } = useMusicPlayer();

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">Master Volume</span>
          <span className="text-xs text-muted-foreground">
            {Math.round(volume * 100)}%
          </span>
        </div>
        <div className="group py-2">
          <Slider
            value={[volume * 100]}
            max={100}
            step={1}
            onValueChange={(v) => setVolume(v[0] / 100)}
          />
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">Streaming Quality</span>
          <span className="text-xs text-muted-foreground capitalize">
            {quality}
          </span>
        </div>
        <Select value={quality} onValueChange={(v) => setQuality(v)}>
          <SelectTrigger className="w-48 focus:ring-0 focus:outline-none focus-visible:ring-0">
            <SelectValue placeholder="Quality" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="auto">Auto (Original)</SelectItem>
            <SelectItem value="high">High (320 kbps)</SelectItem>
            <SelectItem value="medium">Medium (256 kbps)</SelectItem>
            <SelectItem value="low">Low (128 kbps)</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-[11px] text-muted-foreground">
          Lower qualities may transcode to reduce bandwidth.
        </p>
      </div>

      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <div className="text-sm font-medium">Normalize Volume</div>
          <div className="text-xs text-muted-foreground">
            Level songs using ReplayGain/R128 when available; falls back to
            gentle compression.
          </div>
        </div>
        <Switch
          checked={!!normalizeEnabled}
          onCheckedChange={(v) => setNormalizeEnabled?.(!!v)}
        />
      </div>
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">Crossfade (s)</span>
          <span className="text-xs text-muted-foreground">
            {crossfadeSeconds}s
          </span>
        </div>
        <div className="group py-2">
          <Slider
            value={[crossfadeSeconds || 0]}
            max={10}
            step={1}
            onValueChange={(v) => setCrossfadeSeconds?.(v[0] || 0)}
          />
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground leading-relaxed">
        Changes apply instantly.
      </p>
    </div>
  );
}
