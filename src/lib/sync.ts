import { localDb } from "./database";
import {
  getAllArtists,
  getAllAlbums,
  getAllPlaylists,
  getAlbumItems,
  getArtistTracks,
  getAlbumInfo,
  getArtistInfo,
} from "./jellyfin";
import { BaseItemDto } from "@jellyfin/sdk/lib/generated-client/models";
import { logger } from "./logger";

export interface SyncProgress {
  stage: "artists" | "albums" | "tracks" | "playlists" | "complete";
  current: number;
  total: number;
  message: string;
}

export type SyncProgressCallback = (progress: SyncProgress) => void;

class SyncService {
  private isRunning = false;
  private abortController: AbortController | null = null;

  async initialize(): Promise<void> {
    await localDb.initialize();
  }

  async startFullSync(
    onProgress?: SyncProgressCallback,
    force: boolean = false
  ): Promise<void> {
    if (this.isRunning) {
      throw new Error("Sync is already running");
    }

    // Get auth data
    const authData = JSON.parse(localStorage.getItem("authData") || "{}");
    if (!authData.serverAddress || !authData.accessToken) {
      throw new Error("Authentication data not found");
    }

    // Check if we need a full sync
    const syncStatus = await localDb.getSyncStatus();
    const lastFullSync = syncStatus.lastFullSync;
    const daysSinceLastSync =
      (Date.now() - lastFullSync) / (1000 * 60 * 60 * 24);

    if (!force && lastFullSync > 0 && daysSinceLastSync < 1) {
      return;
    }

    this.isRunning = true;
    this.abortController = new AbortController();

    try {
      const notifyProgress = (p: SyncProgress) => {
        try {
          onProgress?.(p);
        } finally {
          // Broadcast progress so other views (e.g., Settings) can reflect it
          window.dispatchEvent(new CustomEvent("syncProgress", { detail: p }));
        }
      };

      // Stage 1: Sync Artists
      notifyProgress({
        stage: "artists",
        current: 0,
        total: 0,
        message: "Fetching artists from server...",
      });

      const artists = await getAllArtists();

      if (artists.length > 0) {
        notifyProgress({
          stage: "artists",
          current: 0,
          total: artists.length,
          message: "Saving artists to local database...",
        });

        await localDb.saveArtists(artists);

        notifyProgress({
          stage: "artists",
          current: artists.length,
          total: artists.length,
          message: "Artists synchronized successfully",
        });
      }

      // Stage 2: Sync Albums
      notifyProgress({
        stage: "albums",
        current: 0,
        total: 0,
        message: "Fetching albums from server...",
      });

      const albums = await getAllAlbums();

      if (albums.length > 0) {
        notifyProgress({
          stage: "albums",
          current: 0,
          total: albums.length,
          message: "Saving albums to local database...",
        });

        await localDb.saveAlbums(albums);

        // Update artist album counts early (before tracks) for quicker UI readiness
        try {
          await localDb.recomputeArtistCounts();
        } catch (e) {
          logger.warn("Recomputing artist counts (post-albums) failed", e);
        }

        notifyProgress({
          stage: "albums",
          current: albums.length,
          total: albums.length,
          message: "Albums synchronized successfully",
        });
      }

      // Stage 3: Sync Tracks (fetch from albums)
      notifyProgress({
        stage: "tracks",
        current: 0,
        total: albums.length,
        message: "Fetching tracks for albums...",
      });

      let allTracks: BaseItemDto[] = [];
      let processedAlbums = 0;

      for (const album of albums) {
        if (this.abortController?.signal.aborted) {
          throw new Error("Sync was aborted");
        }

        try {
          const albumTracksResult = await getAlbumItems(
            authData.serverAddress,
            authData.accessToken,
            album.Id!
          );
          if (albumTracksResult?.Items?.length > 0) {
            allTracks = [...allTracks, ...albumTracksResult.Items];
          }
        } catch (error) {
          logger.warn(`Failed to fetch tracks for album ${album.Name}:`, error);
        }

        processedAlbums++;
        notifyProgress({
          stage: "tracks",
          current: processedAlbums,
          total: albums.length,
          message: `Processing album ${processedAlbums}/${albums.length}: ${album.Name}`,
        });

        // Save tracks in batches to prevent memory issues
        if (allTracks.length >= 100) {
          await localDb.saveTracks(allTracks);
          allTracks = [];
        }
      }

      // Save remaining tracks
      if (allTracks.length > 0) {
        await localDb.saveTracks(allTracks);
      }

      // Recompute counts now that tracks are saved
      try {
        await localDb.recomputeArtistCounts();
      } catch (e) {
        logger.warn("Recomputing artist counts (post-tracks) failed", e);
      }

      // Stage 4: Sync Playlists
      notifyProgress({
        stage: "playlists",
        current: 0,
        total: 0,
        message: "Fetching playlists from server...",
      });

      const playlists = await getAllPlaylists();

      if (playlists.length > 0) {
        notifyProgress({
          stage: "playlists",
          current: 0,
          total: playlists.length,
          message: "Saving playlists to local database...",
        });

        await localDb.savePlaylists(playlists);

        notifyProgress({
          stage: "playlists",
          current: playlists.length,
          total: playlists.length,
          message: "Playlists synchronized successfully",
        });
      }

      // Update sync metadata
      await localDb.setSyncMetadata("lastFullSync", Date.now().toString());
      await localDb.setSyncMetadata(
        "lastIncrementalSync",
        Date.now().toString()
      );

      notifyProgress({
        stage: "complete",
        current: 1,
        total: 1,
        message: "Synchronization completed successfully!",
      });

      // Dispatch sync update event
      window.dispatchEvent(new CustomEvent("syncUpdate"));
    } catch (error) {
      throw error;
    } finally {
      this.isRunning = false;
      this.abortController = null;
    }
  }

  async startIncrementalSync(onProgress?: SyncProgressCallback): Promise<void> {
    const syncStatus = await localDb.getSyncStatus();
    // If a full sync is running or none has occurred yet, run full sync
    if (this.isRunning || syncStatus.lastFullSync === 0) {
      await this.startFullSync(onProgress);
      return;
    }

    if (this.isRunning) {
      throw new Error("Sync is already running");
    }

    const authData = JSON.parse(localStorage.getItem("authData") || "{}");
    if (!authData.serverAddress || !authData.accessToken) {
      throw new Error("Authentication data not found");
    }

    this.isRunning = true;
    this.abortController = new AbortController();

    try {
      const notifyProgress = (p: SyncProgress) => {
        try {
          onProgress?.(p);
        } finally {
          window.dispatchEvent(new CustomEvent("syncProgress", { detail: p }));
        }
      };

      const lastIncremental =
        syncStatus.lastIncrementalSync || syncStatus.lastFullSync;
      const cutoff = lastIncremental - 5 * 60 * 1000; // 5-minute window

      notifyProgress({
        stage: "albums",
        current: 0,
        total: 0,
        message: "Fetching updated albums...",
      });
      const allAlbums = await getAllAlbums();
      const changedAlbums = allAlbums.filter((a: any) => {
        const created = a.DateCreated ? Date.parse(a.DateCreated) : 0;
        return created >= cutoff || (a as any).DateModified;
      });

      if (changedAlbums.length) {
        notifyProgress({
          stage: "albums",
          current: 0,
          total: changedAlbums.length,
          message: `Updating ${changedAlbums.length} changed albums...`,
        });
        await localDb.saveAlbums(changedAlbums);
        notifyProgress({
          stage: "albums",
          current: changedAlbums.length,
          total: changedAlbums.length,
          message: "Albums updated",
        });
      }

      if (changedAlbums.length) {
        notifyProgress({
          stage: "tracks",
          current: 0,
          total: changedAlbums.length,
          message: "Refreshing tracks for changed albums...",
        });
        let allTracks: BaseItemDto[] = [];
        let processedAlbums = 0;
        for (const album of changedAlbums) {
          if (this.abortController?.signal.aborted) {
            throw new Error("Sync was aborted");
          }
          try {
            const albumTracksResult = await getAlbumItems(
              authData.serverAddress,
              authData.accessToken,
              album.Id!
            );
            if (albumTracksResult?.Items?.length) {
              allTracks = [...allTracks, ...albumTracksResult.Items];
            }
          } catch (e) {
            logger.warn(
              "Incremental: failed to fetch tracks for",
              album.Name,
              e
            );
          }
          processedAlbums++;
          notifyProgress({
            stage: "tracks",
            current: processedAlbums,
            total: changedAlbums.length,
            message: `Processed ${processedAlbums}/${changedAlbums.length}`,
          });
          if (allTracks.length >= 200) {
            await localDb.saveTracks(allTracks);
            allTracks = [];
          }
        }
        if (allTracks.length) await localDb.saveTracks(allTracks);
        try {
          await localDb.recomputeArtistCounts();
        } catch {}
      }

      await localDb.setSyncMetadata(
        "lastIncrementalSync",
        Date.now().toString()
      );
      notifyProgress({
        stage: "complete",
        current: 1,
        total: 1,
        message: "Incremental sync completed",
      });
      window.dispatchEvent(new CustomEvent("syncUpdate"));
    } catch (e) {
      throw e;
    } finally {
      this.isRunning = false;
      this.abortController = null;
    }
  }

  async abortSync(): Promise<void> {
    if (this.abortController) {
      this.abortController.abort();
      this.isRunning = false;
    }
  }

  isCurrentlyRunning(): boolean {
    return this.isRunning;
  }

  async getSyncStatus() {
    return await localDb.getSyncStatus();
  }

  async clearDatabase(): Promise<void> {
    await localDb.initialize();

    const tables = [
      "artists",
      "albums",
      "tracks",
      "playlists",
      "playlist_items",
      "sync_metadata",
    ];
    for (const table of tables) {
      await localDb["exec"](`DELETE FROM ${table}`);
    }

    await localDb["saveDatabase"]();
  }
}

// Helper functions for hybrid online/offline access
export class HybridDataService {
  private useLocalFirst: boolean = true;

  constructor(useLocalFirst: boolean = true) {
    this.useLocalFirst = useLocalFirst;
  }

  setUseLocalFirst(useLocal: boolean) {
    this.useLocalFirst = useLocal;
  }

  private async shouldWaitForSync(): Promise<boolean> {
    // If sync is running and we have no local data, wait a bit for sync to complete
    if (syncService.isCurrentlyRunning()) {
      const status = await syncService.getSyncStatus();
      return status.artistsCount === 0 && status.albumsCount === 0;
    }
    return false;
  }

  private async waitForSyncProgress(maxWaitMs: number = 5000): Promise<void> {
    const startTime = Date.now();
    while (Date.now() - startTime < maxWaitMs) {
      if (!syncService.isCurrentlyRunning()) {
        break;
      }

      const status = await syncService.getSyncStatus();
      if (status.artistsCount > 0 || status.albumsCount > 0) {
        break;
      }

      // Wait 100ms before checking again
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  async getArtists(
    limit?: number,
    offset?: number,
    forceOnline: boolean = false,
    onlyWithAlbums: boolean = false
  ): Promise<BaseItemDto[]> {
    if (!forceOnline && this.useLocalFirst) {
      try {
        await localDb.initialize();
        let localArtists: BaseItemDto[] = [];
        if (onlyWithAlbums) {
          localArtists = await localDb.getArtistsWithAlbums(limit, offset);
        } else {
          localArtists = await localDb.getArtists(limit, offset);
        }

        if (localArtists.length === 0 && (await this.shouldWaitForSync())) {
          logger.info(
            "🔄 No local artists found, waiting briefly for sync progress..."
          );
          await this.waitForSyncProgress(3000);
          if (onlyWithAlbums) {
            localArtists = await localDb.getArtistsWithAlbums(limit, offset);
          } else {
            localArtists = await localDb.getArtists(limit, offset);
          }
        }

        if (localArtists.length > 0) {
          return localArtists;
        }
      } catch (error) {
        logger.warn(
          "Local artist retrieval failed, falling back to server",
          error
        );
      }
    }

    // Fallback online fetch (still returns full list currently)
    const all = await getAllArtists();
    if (onlyWithAlbums) {
      return all.filter(
        (a: any) =>
          (a.AlbumCount || a.ChildCount || a.ItemCounts?.AlbumCount) > 0
      );
    }
    return all;
  }

  async getArtistById(
    id: string,
    forceOnline: boolean = false
  ): Promise<BaseItemDto | null> {
    if (!forceOnline && this.useLocalFirst) {
      try {
        await localDb.initialize();
        const localArtist = await localDb.getArtistById(id);
        if (localArtist) {
          return localArtist;
        }
      } catch (error) {
        logger.warn(
          "Failed to get artist from local database, falling back to server:",
          error
        );
      }
    }

    // Fall back to server

    try {
      return await getArtistInfo(id);
    } catch (error) {
      logger.error("Failed to fetch artist from server:", error);
      return null;
    }
  }

  async getAlbums(
    limit?: number,
    offset?: number,
    forceOnline: boolean = false
  ): Promise<BaseItemDto[]> {
    if (!forceOnline && this.useLocalFirst) {
      try {
        await localDb.initialize();
        let localAlbums = await localDb.getAlbums(limit, offset);

        // If no local data but sync is running, wait a bit for sync to complete
        if (localAlbums.length === 0 && (await this.shouldWaitForSync())) {
          await this.waitForSyncProgress(3000); // Wait up to 3 seconds

          // Try again after waiting
          localAlbums = await localDb.getAlbums(limit, offset);
        }

        if (localAlbums.length > 0) {
          return localAlbums;
        }
      } catch (error) {
        logger.warn(
          "🔍 HybridData.getAlbums: Failed to get albums from local database, falling back to server:",
          error
        );
      }
    }

    // Fall back to server
    const serverAlbums = await getAllAlbums();

    return serverAlbums;
  }

  async getAlbumById(
    id: string,
    forceOnline: boolean = false
  ): Promise<BaseItemDto | null> {
    if (!forceOnline && this.useLocalFirst) {
      try {
        await localDb.initialize();
        const localAlbum = await localDb.getAlbumById(id);
        if (localAlbum) {
          return localAlbum;
        }
      } catch (error) {
        logger.warn(
          "Failed to get album from local database, falling back to server:",
          error
        );
      }
    }

    // Fall back to server

    try {
      const authData = JSON.parse(localStorage.getItem("authData") || "{}");
      if (!authData.serverAddress || !authData.accessToken) {
        throw new Error("Authentication data not found");
      }
      return await getAlbumInfo(
        authData.serverAddress,
        authData.accessToken,
        id
      );
    } catch (error) {
      logger.error("Failed to fetch album from server:", error);
      return null;
    }
  }

  async getAlbumTracks(
    albumId: string,
    forceOnline: boolean = false
  ): Promise<BaseItemDto[]> {
    if (!forceOnline && this.useLocalFirst) {
      try {
        await localDb.initialize();
        const localTracks = await localDb.getTracksByAlbumId(albumId);
        if (localTracks.length > 0) {
          return localTracks;
        }
      } catch (error) {
        logger.warn(
          "Failed to get album tracks from local database, falling back to server:",
          error
        );
      }
    }

    // Fall back to server

    try {
      const authData = JSON.parse(localStorage.getItem("authData") || "{}");
      if (!authData.serverAddress || !authData.accessToken) {
        throw new Error("Authentication data not found");
      }
      const result = await getAlbumItems(
        authData.serverAddress,
        authData.accessToken,
        albumId
      );
      return result.Items || [];
    } catch (error) {
      logger.error("Failed to fetch album tracks from server:", error);
      return [];
    }
  }

  async getArtistAlbums(
    artistId: string,
    forceOnline: boolean = false
  ): Promise<BaseItemDto[]> {
    if (!forceOnline && this.useLocalFirst) {
      try {
        await localDb.initialize();
        const localAlbums = await localDb.getAlbumsByArtistId(artistId);
        if (localAlbums.length > 0) {
          return localAlbums;
        }
      } catch (error) {
        logger.warn(
          "Failed to get artist albums from local database, falling back to server:",
          error
        );
      }
    }

    // Fall back to server

    try {
      const { getArtistAlbums } = await import("./jellyfin");
      return await getArtistAlbums(artistId);
    } catch (error) {
      logger.error("Failed to fetch artist albums from server:", error);
      return [];
    }
  }

  async getArtistTracks(
    artistId: string,
    forceOnline: boolean = false
  ): Promise<BaseItemDto[]> {
    if (!forceOnline && this.useLocalFirst) {
      try {
        await localDb.initialize();
        const localTracks = await localDb.getTracksByArtistId(artistId);
        if (localTracks.length > 0) {
          return localTracks;
        }
      } catch (error) {
        logger.warn(
          "Failed to get artist tracks from local database, falling back to server:",
          error
        );
      }
    }

    // Fall back to server

    return await getArtistTracks(artistId);
  }

  async getPlaylists(forceOnline: boolean = false): Promise<BaseItemDto[]> {
    if (!forceOnline && this.useLocalFirst) {
      try {
        await localDb.initialize();
        const localPlaylists = await localDb.getPlaylists();
        if (localPlaylists.length > 0) {
          logger.info(
            `Retrieved ${localPlaylists.length} playlists from local database`
          );
          return localPlaylists;
        }
      } catch (error) {
        logger.warn(
          "Failed to get playlists from local database, falling back to server:",
          error
        );
      }
    }

    // Fall back to server

    return await getAllPlaylists();
  }

  async searchArtists(
    query: string,
    forceOnline: boolean = false
  ): Promise<BaseItemDto[]> {
    if (!forceOnline && this.useLocalFirst) {
      try {
        await localDb.initialize();
        const localResults = await localDb.searchArtists(query);
        if (localResults.length > 0) {
          logger.info(
            `Found ${localResults.length} artists matching "${query}" in local database`
          );
          return localResults;
        }
      } catch (error) {
        logger.warn(
          "Failed to search artists in local database, falling back to server:",
          error
        );
      }
    }

    // Fall back to server search (would need to implement server search)

    const allArtists = await this.getArtists(undefined, undefined, true);
    return allArtists.filter((artist) =>
      artist.Name?.toLowerCase().includes(query.toLowerCase())
    );
  }

  // New: search tracks locally (used for album page filtering by track name)
  async searchTracks(query: string): Promise<BaseItemDto[]> {
    try {
      await localDb.initialize();
      return await localDb.searchTracks(query);
    } catch (e) {
      logger.warn("Track search failed", e);
      return [];
    }
  }
}

// Create and export singleton instances
export const syncService = new SyncService();
export const hybridData = new HybridDataService();

// Auto-sync scheduler
let autoSyncInterval: number | null = null;
function scheduleAutoSync() {
  const enabled = localStorage.getItem("autoSync") === "true";
  if (!enabled) {
    if (autoSyncInterval) {
      clearInterval(autoSyncInterval);
      autoSyncInterval = null;
    }
    return;
  }
  if (autoSyncInterval) return; // already scheduled
  // Run incremental every 30 minutes
  autoSyncInterval = window.setInterval(
    () => {
      if (!enabled) return;
      if (syncService.isCurrentlyRunning()) return;
      syncService
        .startIncrementalSync()
        .catch((e) => logger.warn("Auto incremental sync failed", e));
    },
    30 * 60 * 1000
  );
}

// Visibility / online triggers
if (typeof window !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      const enabled = localStorage.getItem("autoSync") === "true";
      if (enabled && !syncService.isCurrentlyRunning()) {
        syncService
          .startIncrementalSync()
          .catch((e) => logger.warn("Visibility incremental sync failed", e));
      }
    }
  });
  window.addEventListener("online", () => {
    const enabled = localStorage.getItem("autoSync") === "true";
    if (enabled && !syncService.isCurrentlyRunning()) {
      syncService
        .startIncrementalSync()
        .catch((e) => logger.warn("Online incremental sync failed", e));
    }
  });
  scheduleAutoSync();
}
