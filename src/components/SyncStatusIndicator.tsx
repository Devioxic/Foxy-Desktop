import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { RefreshCw, WifiOff, CheckCircle, AlertCircle } from "lucide-react";
import { syncService, SyncProgress } from "@/lib/sync";
import { logger } from "@/lib/logger";
import { useOfflineModeContext } from "@/contexts/OfflineModeContext";

interface SyncStatusIndicatorProps {
  className?: string;
  showText?: boolean;
}

export default function SyncStatusIndicator({
  className = "",
  showText = false,
}: SyncStatusIndicatorProps) {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState<SyncProgress | null>(null);
  const [syncStatus, setSyncStatus] = useState<any>(() => {
    try {
      const cached = localStorage.getItem("syncStatus.cache");
      return cached ? JSON.parse(cached) : null;
    } catch {
      return null;
    }
  });
  const [lastSyncTime, setLastSyncTime] = useState<string>(
    () => localStorage.getItem("syncStatus.last") || "Never"
  );
  const { isOffline: offlineModeActive, isSimulated } = useOfflineModeContext();
  const offlineActive = !isOnline || offlineModeActive;

  useEffect(() => {
    loadSyncStatus();

    // Listen for online/offline events
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    // Listen for custom sync events
    const handleSyncUpdate = () => {
      loadSyncStatus();
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    window.addEventListener("syncUpdate", handleSyncUpdate);

    // Check sync status periodically
    const interval = setInterval(loadSyncStatus, 30000); // Every 30 seconds

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("syncUpdate", handleSyncUpdate);
      clearInterval(interval);
    };
  }, []);

  const loadSyncStatus = async () => {
    try {
      await syncService.initialize();
      const status = await syncService.getSyncStatus();
      setSyncStatus(status);
      setIsSyncing(syncService.isCurrentlyRunning());
      try {
        localStorage.setItem("syncStatus.cache", JSON.stringify(status));
      } catch {}

      // Update last sync time based on the loaded status
      if (status && status.lastFullSync > 0) {
        const now = Date.now();
        const timeDiff = now - status.lastFullSync;
        const hours = Math.floor(timeDiff / (1000 * 60 * 60));
        const days = Math.floor(hours / 24);

        let newLastSyncTime = "";
        if (days > 0) {
          newLastSyncTime = `${days} day${days > 1 ? "s" : ""} ago`;
        } else if (hours > 0) {
          newLastSyncTime = `${hours} hour${hours > 1 ? "s" : ""} ago`;
        } else {
          newLastSyncTime = "Recently";
        }
        setLastSyncTime(newLastSyncTime);
        try {
          localStorage.setItem("syncStatus.last", newLastSyncTime);
        } catch {}
      } else {
        setLastSyncTime("Never");
        try {
          localStorage.setItem("syncStatus.last", "Never");
        } catch {}
      }
    } catch (error) {
      logger.warn("Failed to load sync status:", error);
      setLastSyncTime("Error");
    }
  };

  const handleQuickSync = async () => {
    if (offlineActive || isSyncing) return;

    try {
      setIsSyncing(true);
      setSyncProgress({
        stage: "artists",
        current: 0,
        total: 0,
        message: "Starting sync...",
      });

      await syncService.startIncrementalSync((progress) => {
        setSyncProgress(progress);
      });

      // Wait a moment for the database to be saved
      await new Promise((resolve) => setTimeout(resolve, 500));

      await loadSyncStatus();
      setSyncProgress(null);
    } catch (error) {
      setSyncProgress(null);
    } finally {
      setIsSyncing(false);
    }
  };

  const getStatusColor = () => {
    if (offlineActive) return "text-red-500";
    if (isSyncing) return "text-blue-600";
    if (!syncStatus || syncStatus.lastFullSync === 0) return "text-yellow-600";
    return "text-green-600";
  };

  const getStatusIcon = () => {
    if (offlineActive) return WifiOff;
    if (isSyncing) return RefreshCw;
    if (!syncStatus || syncStatus.lastFullSync === 0) return AlertCircle;
    return CheckCircle;
  };

  const getTooltipContent = () => {
    if (offlineActive)
      return isSimulated
        ? "Offline mode (simulated)"
        : "Foxy is offline - Working with downloaded content";
    if (isSyncing) return syncProgress ? syncProgress.message : "Syncing...";
    if (!syncStatus || syncStatus.lastFullSync === 0)
      return "No sync yet - Click to sync library";
    return `Last sync: ${lastSyncTime}\nTotal: ${
      syncStatus?.artistsCount || 0
    } artists, ${syncStatus?.albumsCount || 0} albums, ${
      syncStatus?.tracksCount || 0
    } tracks`;
  };

  const StatusIcon = getStatusIcon();
  const iconSizeClass = offlineActive ? "w-5 h-5" : "w-4 h-4";

  const offlineLabel = offlineActive ? "Foxy is offline" : null;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleQuickSync}
            disabled={offlineActive || isSyncing}
            className={`relative group p-2 h-auto rounded-xl disabled:opacity-100 ${className}`}
          >
            <div className="flex items-center space-x-2">
              <StatusIcon
                className={`${iconSizeClass} ${getStatusColor()} ${
                  isSyncing ? "animate-spin" : ""
                }`}
              />
              {showText && !offlineActive && (
                <div className="flex flex-col items-start text-xs">
                  <span className="text-gray-700">
                    {syncStatus
                      ? `${syncStatus.tracksCount || 0} tracks`
                      : "No data"}
                  </span>
                  <span className="text-gray-500">
                    {isOnline
                      ? isSyncing
                        ? syncProgress?.message || "Syncing..."
                        : lastSyncTime === "Never"
                          ? "Click to sync"
                          : lastSyncTime
                      : "Offline"}
                  </span>
                </div>
              )}
              {showText && offlineActive && offlineLabel && (
                <span className="text-xs font-medium text-red-400">
                  {offlineLabel}
                </span>
              )}
            </div>
            {offlineLabel && (
              <span className="pointer-events-none absolute left-1/2 -bottom-8 -translate-x-1/2 whitespace-nowrap rounded-md bg-popover px-2 py-1 text-xs font-medium text-popover-foreground shadow-md opacity-0 transition-opacity group-hover:opacity-100 z-50">
                {offlineLabel}
              </span>
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <div className="text-sm">
            {getTooltipContent()
              .split("\n")
              .map((line, i) => (
                <div key={i}>{line}</div>
              ))}
            {!offlineActive && !isSyncing && (
              <div className="text-xs text-gray-400 mt-1">
                Click to sync recent changes
              </div>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
