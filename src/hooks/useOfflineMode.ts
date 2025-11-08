import { useState, useEffect, useCallback } from "react";
import { localDb } from "@/lib/database";
import { hybridData } from "@/lib/sync";

export interface OfflineModeState {
  isOffline: boolean;
  isSimulated: boolean;
  hasDownloadedContent: boolean;
  downloadedTracksCount: number;
  downloadedAlbumsCount: number;
  downloadedPlaylistsCount: number;
}

export const useOfflineMode = () => {
  const [offlineState, setOfflineState] = useState<OfflineModeState>({
    isOffline: false,
    isSimulated: false,
    hasDownloadedContent: false,
    downloadedTracksCount: 0,
    downloadedAlbumsCount: 0,
    downloadedPlaylistsCount: 0,
  });
  const [simulateOffline, setSimulateOfflineState] = useState<boolean>(() => {
    try {
      return localStorage.getItem("offlineMode.simulate") === "true";
    } catch {
      return false;
    }
  });

  const dispatchOfflineEvent = useCallback(
    (isOffline: boolean, isSimulated: boolean) => {
      try {
        window.dispatchEvent(
          new CustomEvent("offlineModeChanged", {
            detail: { isOffline, isSimulated },
          })
        );
      } catch {}
    },
    []
  );

  const checkOfflineStatus = useCallback(
    async (options?: { simulateOverride?: boolean }) => {
      const manualOverride =
        options && options.simulateOverride !== undefined
          ? options.simulateOverride
          : simulateOffline;

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

      // Check if Jellyfin server is reachable (unless we are simulating)
      let isServerReachable = false;
      if (!manualOverride) {
        try {
          const authData = JSON.parse(
            localStorage.getItem("authData") || "{}"
          );
          if (authData.serverAddress && authData.accessToken) {
            console.log(
              "Checking server reachability:",
              authData.serverAddress
            );

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
      }

      const effectiveOffline = manualOverride || !isServerReachable;

      setOfflineState({
        isOffline: effectiveOffline,
        isSimulated: manualOverride,
        hasDownloadedContent,
        downloadedTracksCount,
        downloadedAlbumsCount,
        downloadedPlaylistsCount,
      });

      console.log("useOfflineMode - Updated state:", {
        isOffline: effectiveOffline,
        isSimulated: manualOverride,
        hasDownloadedContent,
        serverReachable: isServerReachable,
      });

      hybridData.setOfflineModeActive(effectiveOffline);
      try {
        localStorage.setItem(
          "offlineMode.active",
          effectiveOffline ? "true" : "false"
        );
      } catch {}
      dispatchOfflineEvent(effectiveOffline, manualOverride);
    } catch (error) {
      console.error("Failed to check offline status:", error);
      // If we can't check, assume we're offline
      setOfflineState((prev) => ({
        ...prev,
        isOffline: true,
        isSimulated: simulateOffline,
      }));
      hybridData.setOfflineModeActive(true);
      dispatchOfflineEvent(true, simulateOffline);
    }
  }, [dispatchOfflineEvent, simulateOffline]);

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

  useEffect(() => {
    try {
      localStorage.setItem(
        "offlineMode.simulate",
        simulateOffline ? "true" : "false"
      );
    } catch {}
  }, [simulateOffline]);

  const setSimulateOffline = useCallback(
    async (value: boolean) => {
      setSimulateOfflineState(value);
      await checkOfflineStatus({ simulateOverride: value });
    },
    [checkOfflineStatus]
  );

  return {
    ...offlineState,
    simulateOffline,
    setSimulateOffline,
    refreshOfflineStatus: checkOfflineStatus,
  };
};
