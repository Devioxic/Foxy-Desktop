import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import {
  AlertCircle,
  CheckCircle,
  Download,
  RefreshCw,
  Database,
  Wifi,
  WifiOff,
} from "lucide-react";
import { syncService, hybridData, SyncProgress } from "@/lib/sync";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface SyncManagerProps {
  onSyncComplete?: () => void;
}

export default function SyncManager({ onSyncComplete }: SyncManagerProps) {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState<SyncProgress | null>(null);
  const [syncStatus, setSyncStatus] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastSyncTime, setLastSyncTime] = useState<string>("Never");

  useEffect(() => {
    loadSyncStatus();

    // Listen for online/offline events
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  const loadSyncStatus = async () => {
    try {
      await syncService.initialize();
      const status = await syncService.getSyncStatus();
      setSyncStatus(status);

      if (status.lastFullSync > 0) {
        setLastSyncTime(new Date(status.lastFullSync).toLocaleString());
      }
    } catch (error) {
      console.error("Failed to load sync status:", error);
      setError("Failed to load sync status");
    }
  };

  const handleFullSync = async (force: boolean = false) => {
    if (!isOnline) {
      setError(
        "Cannot sync while offline. Please check your internet connection."
      );
      return;
    }

    setIsSyncing(true);
    setError(null);
    setSyncProgress(null);

    try {
      await syncService.startFullSync((progress) => {
        setSyncProgress(progress);
      }, force);

      await loadSyncStatus();
      onSyncComplete?.();

      setSyncProgress({
        stage: "complete",
        current: 1,
        total: 1,
        message: "Sync completed successfully!",
      });
    } catch (error: any) {
      setError(error.message || "Sync failed");
      setSyncProgress(null);
    } finally {
      setIsSyncing(false);
    }
  };

  const handleIncrementalSync = async () => {
    if (!isOnline) {
      setError(
        "Cannot sync while offline. Please check your internet connection."
      );
      return;
    }

    setIsSyncing(true);
    setError(null);
    setSyncProgress(null);

    try {
      await syncService.startIncrementalSync((progress) => {
        setSyncProgress(progress);
      });

      await loadSyncStatus();
      onSyncComplete?.();

      setSyncProgress({
        stage: "complete",
        current: 1,
        total: 1,
        message: "Incremental sync completed successfully!",
      });
    } catch (error: any) {
      setError(error.message || "Incremental sync failed");
      setSyncProgress(null);
    } finally {
      setIsSyncing(false);
    }
  };

  const handleAbortSync = async () => {
    try {
      await syncService.abortSync();
      setIsSyncing(false);
      setSyncProgress(null);
    } catch (error) {
      console.error("Failed to abort sync:", error);
    }
  };

  const handleClearDatabase = async () => {
    if (
      window.confirm(
        "Are you sure you want to clear the local database? This will remove all cached music data."
      )
    ) {
      try {
        await syncService.clearDatabase();
        await loadSyncStatus();
        setSyncProgress(null);
      } catch (error: any) {
        setError(error.message || "Failed to clear database");
      }
    }
  };

  const getProgressPercentage = () => {
    if (!syncProgress || syncProgress.total === 0) return 0;
    return (syncProgress.current / syncProgress.total) * 100;
  };

  const formatNumber = (num: number) => {
    return new Intl.NumberFormat().format(num);
  };

  return (
    <div className="space-y-6">
      {/* Connection Status */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <div className="flex items-center space-x-2">
            {isOnline ? (
              <Wifi className="w-5 h-5 text-green-600" />
            ) : (
              <WifiOff className="w-5 h-5 text-red-600" />
            )}
            <CardTitle className="text-base">Connection Status</CardTitle>
          </div>
          <Badge variant={isOnline ? "default" : "destructive"}>
            {isOnline ? "Online" : "Offline"}
          </Badge>
        </CardHeader>
        <CardContent>
          <CardDescription>
            {isOnline
              ? "Connected to the internet. Sync operations are available."
              : "No internet connection. Working in offline mode with cached data."}
          </CardDescription>
        </CardContent>
      </Card>

      {/* Sync Status */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <div className="flex items-center space-x-2">
            <Database className="w-5 h-5 text-pink-600" />
            <CardTitle className="text-base">Local Database Status</CardTitle>
          </div>
          <Badge variant="secondary">Last sync: {lastSyncTime}</Badge>
        </CardHeader>
        <CardContent>
          {syncStatus && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div className="text-center">
                <div className="text-2xl font-bold text-pink-600">
                  {formatNumber(syncStatus.artistsCount)}
                </div>
                <div className="text-gray-600">Artists</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-pink-600">
                  {formatNumber(syncStatus.albumsCount)}
                </div>
                <div className="text-gray-600">Albums</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-pink-600">
                  {formatNumber(syncStatus.tracksCount)}
                </div>
                <div className="text-gray-600">Tracks</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-pink-600">
                  {formatNumber(syncStatus.playlistsCount)}
                </div>
                <div className="text-gray-600">Playlists</div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Sync Progress */}
      {syncProgress && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center space-x-2">
              <RefreshCw
                className={`w-4 h-4 ${
                  isSyncing ? "animate-spin" : ""
                } text-pink-600`}
              />
              <span>Sync Progress</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="capitalize">{syncProgress.stage}</span>
                <span>
                  {syncProgress.current} / {syncProgress.total}
                </span>
              </div>
              <Progress value={getProgressPercentage()} className="h-2" />
            </div>
            <p className="text-sm text-gray-600">{syncProgress.message}</p>
          </CardContent>
        </Card>
      )}

      {/* Error Display */}
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Sync Controls */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Sync Operations</CardTitle>
          <CardDescription>
            Keep your local music library synchronized with the Jellyfin server
            for faster performance and offline access.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-3">
            <Button
              onClick={() => handleFullSync(false)}
              disabled={!isOnline || isSyncing}
              className="bg-pink-600 hover:bg-pink-700"
            >
              <Download className="w-4 h-4 mr-2" />
              Smart Sync
            </Button>

            <Button
              onClick={() => handleFullSync(true)}
              disabled={!isOnline || isSyncing}
              variant="outline"
            >
              <RefreshCw className="w-4 h-4 mr-2" />
              Force Full Sync
            </Button>

            <Button
              onClick={handleIncrementalSync}
              disabled={!isOnline || isSyncing}
              variant="outline"
            >
              <CheckCircle className="w-4 h-4 mr-2" />
              Quick Update
            </Button>

            {isSyncing && (
              <Button onClick={handleAbortSync} variant="destructive" size="sm">
                Cancel
              </Button>
            )}
          </div>

          <div className="border-t pt-4">
            <Button
              onClick={handleClearDatabase}
              disabled={isSyncing}
              variant="destructive"
              size="sm"
            >
              Clear Local Database
            </Button>
            <p className="text-xs text-gray-500 mt-2">
              This will remove all cached music data and require a fresh sync.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Sync Tips */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Sync Tips</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-gray-600">
          <div>
            • <strong>Smart Sync:</strong> Only syncs if data is older than 24
            hours
          </div>
          <div>
            • <strong>Force Full Sync:</strong> Re-downloads all library data
            regardless of age
          </div>
          <div>
            • <strong>Quick Update:</strong> Fast incremental sync for recent
            changes
          </div>
          <div>• Sync runs automatically in the background when needed</div>
          <div>• Your music will work offline after the first sync</div>
        </CardContent>
      </Card>
    </div>
  );
}
