import { useState, useEffect, useCallback } from "react";
import { localDb } from "@/lib/database";

export interface OfflineModeState {
  isOffline: boolean;
  hasDownloadedContent: boolean;
  downloadedTracksCount: number;
  downloadedAlbumsCount: number;
  downloadedPlaylistsCount: number;
}

export const useOfflineMode = () => {
  const [offlineState, setOfflineState] = useState<OfflineModeState>({
    isOffline: false,
    hasDownloadedContent: false,
    downloadedTracksCount: 0,
    downloadedAlbumsCount: 0,
    downloadedPlaylistsCount: 0,
  });

  const checkOfflineStatus = useCallback(async () => {
    try {
      // Check if we have downloaded content first
      await localDb.initialize();
      const downloads = await localDb.getAllDownloads();
      const collections = await localDb.getDownloadedCollections();

      const downloadedTracksCount = downloads.length;
      const downloadedAlbumsCount = collections.filter(
        (c) => c.type === "album"
      ).length;
      const downloadedPlaylistsCount = collections.filter(
        (c) => c.type === "playlist"
      ).length;

      const hasDownloadedContent =
        downloadedTracksCount > 0 ||
        downloadedAlbumsCount > 0 ||
        downloadedPlaylistsCount > 0;

      // Check if Jellyfin server is reachable
      let isServerReachable = false;
      try {
        const authData = JSON.parse(localStorage.getItem("authData") || "{}");
        if (authData.serverAddress && authData.accessToken) {
          console.log("Checking server reachability:", authData.serverAddress);

          // Try to ping the server with a simple request
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout

          const response = await fetch(
            `${authData.serverAddress}/System/Info`,
            {
              method: "GET",
              headers: {
                "X-Emby-Token": authData.accessToken,
              },
              signal: controller.signal,
            }
          );

          clearTimeout(timeoutId);
          isServerReachable = response.ok;
          console.log(
            "Server reachable:",
            isServerReachable,
            "Status:",
            response.status
          );
        } else {
          console.log("No auth data available");
          isServerReachable = false;
        }
      } catch (error) {
        console.log("Server check failed:", error);
        // Server is not reachable
        isServerReachable = false;
      }

      setOfflineState({
        isOffline: !isServerReachable,
        hasDownloadedContent,
        downloadedTracksCount,
        downloadedAlbumsCount,
        downloadedPlaylistsCount,
      });

      console.log("useOfflineMode - Updated state:", {
        isOffline: !isServerReachable,
        hasDownloadedContent,
        serverReachable: isServerReachable,
      });
    } catch (error) {
      console.error("Failed to check offline status:", error);
      // If we can't check, assume we're offline
      setOfflineState((prev) => ({
        ...prev,
        isOffline: true,
      }));
    }
  }, []);

  useEffect(() => {
    checkOfflineStatus();

    // Check server status periodically when online
    const interval = setInterval(() => {
      if (navigator.onLine) {
        checkOfflineStatus();
      }
    }, 30000); // Check every 30 seconds

    return () => {
      clearInterval(interval);
    };
  }, [checkOfflineStatus]);

  return {
    ...offlineState,
    refreshOfflineStatus: checkOfflineStatus,
  };
};
