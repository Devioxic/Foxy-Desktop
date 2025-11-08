import React, { createContext, useContext, useMemo } from "react";
import {
  OfflineModeState,
  useOfflineMode,
} from "@/hooks/useOfflineMode";

interface OfflineModeContextValue extends OfflineModeState {
  simulateOffline: boolean;
  setSimulateOffline: (value: boolean) => Promise<void>;
  refreshOfflineStatus: () => Promise<void>;
}

const OfflineModeContext = createContext<OfflineModeContextValue | undefined>(
  undefined
);

export const OfflineModeProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const {
    isOffline,
    isSimulated,
    hasDownloadedContent,
    downloadedTracksCount,
    downloadedAlbumsCount,
    downloadedPlaylistsCount,
    simulateOffline,
    setSimulateOffline,
    refreshOfflineStatus,
  } = useOfflineMode();

  const value = useMemo<OfflineModeContextValue>(
    () => ({
      isOffline,
      isSimulated,
      hasDownloadedContent,
      downloadedTracksCount,
      downloadedAlbumsCount,
      downloadedPlaylistsCount,
      simulateOffline,
      setSimulateOffline,
      refreshOfflineStatus,
    }),
    [
      isOffline,
      isSimulated,
      hasDownloadedContent,
      downloadedTracksCount,
      downloadedAlbumsCount,
      downloadedPlaylistsCount,
      simulateOffline,
      setSimulateOffline,
      refreshOfflineStatus,
    ]
  );

  return (
    <OfflineModeContext.Provider value={value}>
      {children}
    </OfflineModeContext.Provider>
  );
};

export const useOfflineModeContext = () => {
  const ctx = useContext(OfflineModeContext);
  if (!ctx) {
    throw new Error(
      "useOfflineModeContext must be used within an OfflineModeProvider"
    );
  }
  return ctx;
};
