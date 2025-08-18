import { useEffect, useState } from "react";
import { logger } from "@/lib/logger";
import { syncService, hybridData } from "@/lib/sync";
import { useAuthData } from "@/hooks/useAuthData";

export const useSyncInitialization = () => {
  const { isAuthenticated } = useAuthData();
  const [isInitializing, setIsInitializing] = useState(false);
  const [initializationComplete, setInitializationComplete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const initializeSync = async () => {
      if (!isAuthenticated() || isInitializing || initializationComplete) {
        return;
      }

      setIsInitializing(true);
      setError(null);

      try {
        // Initialize the sync service and database
        await syncService.initialize();

        // Wait a bit to ensure database is fully ready
        await new Promise((resolve) => setTimeout(resolve, 100));

        // Check if we have any data
        const syncStatus = await syncService.getSyncStatus();

        // If no data exists and we're online, start initial sync
        if (syncStatus.artistsCount === 0 && navigator.onLine) {
          // Start background sync (don't wait for completion)
          syncService.startFullSync().catch((error) => {
            logger.error("Background sync failed:", error);
          });
        } else {
        }

        // Initialize hybrid data service settings
        const useLocalFirst = localStorage.getItem("useLocalFirst") !== "false";
        hybridData.setUseLocalFirst(useLocalFirst);

        setInitializationComplete(true);
      } catch (error: any) {
        logger.error("Sync initialization failed:", error);
        setError(error.message || "Initialization failed");
      } finally {
        setIsInitializing(false);
      }
    };

    // Initialize when user is authenticated
    if (isAuthenticated()) {
      initializeSync();
    }
  }, [isAuthenticated(), isInitializing, initializationComplete]);

  return {
    isInitializing,
    initializationComplete,
    error,
  };
};

// Auto-sync hook for periodic background synchronization
export const useAutoSync = () => {
  const { isAuthenticated } = useAuthData();
  const [lastAutoSync, setLastAutoSync] = useState(0);

  useEffect(() => {
    if (!isAuthenticated()) return;

    const checkAndAutoSync = async () => {
      try {
        const autoSyncEnabled = localStorage.getItem("autoSync") !== "false";
        if (!autoSyncEnabled || !navigator.onLine) return;

        const syncStatus = await syncService.getSyncStatus();
        const now = Date.now();
        const timeSinceLastSync = now - syncStatus.lastIncrementalSync;

        // Auto-sync every 4 hours
        const AUTO_SYNC_INTERVAL = 4 * 60 * 60 * 1000;

        if (
          timeSinceLastSync > AUTO_SYNC_INTERVAL &&
          now - lastAutoSync > AUTO_SYNC_INTERVAL
        ) {
          setLastAutoSync(now);

          // Start background incremental sync
          syncService.startIncrementalSync().catch(() => {});
        }
      } catch (error) {}
    };

    // Check immediately
    checkAndAutoSync();

    // Set up periodic checks
    const interval = setInterval(checkAndAutoSync, 30 * 60 * 1000); // Check every 30 minutes

    return () => clearInterval(interval);
  }, [isAuthenticated(), lastAutoSync]);

  return { lastAutoSync };
};
