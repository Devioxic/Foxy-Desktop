import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Database,
  RefreshCw,
  Wifi,
  WifiOff,
  CheckCircle,
  AlertCircle,
} from "lucide-react";
import { syncService, SyncProgress } from "@/lib/sync";

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
  const [syncStatus, setSyncStatus] = useState<any>(null);
  const [lastSyncTime, setLastSyncTime] = useState<string>("Never");

  useEffect(() => {
    loadSyncStatus();

    // Listen for online/offline events
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    // Listen for custom sync events
    const handleSyncUpdate = () => {
      console.log("SyncStatusIndicator: Received sync update event");
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
      console.log("SyncStatusIndicator: Loading sync status...");
      await syncService.initialize();
      const status = await syncService.getSyncStatus();
      console.log("SyncStatusIndicator: Sync status loaded:", status);
      setSyncStatus(status);
      setIsSyncing(syncService.isCurrentlyRunning());

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
        console.log(
          "SyncStatusIndicator: Last sync time set to:",
          newLastSyncTime
        );
      } else {
        setLastSyncTime("Never");
        console.log(
          "SyncStatusIndicator: No sync data found, setting to Never"
        );
      }
    } catch (error) {
      console.warn("Failed to load sync status:", error);
      setLastSyncTime("Error");
    }
  };

  const handleQuickSync = async () => {
    if (!isOnline || isSyncing) return;

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
      console.log("SyncStatusIndicator: Sync completed and status reloaded");
    } catch (error) {
      console.error("Quick sync failed:", error);
      setSyncProgress(null);
    } finally {
      setIsSyncing(false);
    }
  };

  const getStatusColor = () => {
    if (!isOnline) return "text-gray-400";
    if (isSyncing) return "text-blue-600";
    if (!syncStatus || syncStatus.lastFullSync === 0) return "text-yellow-600";
    return "text-green-600";
  };

  const getStatusIcon = () => {
    if (!isOnline) return WifiOff;
    if (isSyncing) return RefreshCw;
    if (!syncStatus || syncStatus.lastFullSync === 0) return AlertCircle;
    return CheckCircle;
  };

  const getTooltipContent = () => {
    if (!isOnline) return "Offline - Working with cached data";
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

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleQuickSync}
            disabled={!isOnline || isSyncing}
            className={`p-2 h-auto rounded-xl ${className}`}
          >
            <div className="flex items-center space-x-2">
              <StatusIcon
                className={`w-4 h-4 ${getStatusColor()} ${
                  isSyncing ? "animate-spin" : ""
                }`}
              />
              {showText && (
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
            </div>
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <div className="text-sm">
            {getTooltipContent()
              .split("\n")
              .map((line, i) => (
                <div key={i}>{line}</div>
              ))}
            {isOnline && !isSyncing && (
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
