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
      console.log("Full sync not needed, last sync was less than 24 hours ago");
      return;
    }

    this.isRunning = true;
    this.abortController = new AbortController();

    try {
      console.log("Starting full sync...");

      // Stage 1: Sync Artists
      onProgress?.({
        stage: "artists",
        current: 0,
        total: 0,
        message: "Fetching artists from server...",
      });

      const artists = await getAllArtists();
      console.log(`Found ${artists.length} artists`);

      if (artists.length > 0) {
        onProgress?.({
          stage: "artists",
          current: 0,
          total: artists.length,
          message: "Saving artists to local database...",
        });

        await localDb.saveArtists(artists);

        onProgress?.({
          stage: "artists",
          current: artists.length,
          total: artists.length,
          message: "Artists synchronized successfully",
        });
      }

      // Stage 2: Sync Albums
      onProgress?.({
        stage: "albums",
        current: 0,
        total: 0,
        message: "Fetching albums from server...",
      });

      const albums = await getAllAlbums();
      console.log(`Found ${albums.length} albums`);

      if (albums.length > 0) {
        onProgress?.({
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
          console.warn("Recomputing artist counts (post-albums) failed", e);
        }

        onProgress?.({
          stage: "albums",
          current: albums.length,
          total: albums.length,
          message: "Albums synchronized successfully",
        });
      }

      // Stage 3: Sync Tracks (fetch from albums)
      onProgress?.({
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
          console.warn(
            `Failed to fetch tracks for album ${album.Name}:`,
            error
          );
        }

        processedAlbums++;
        onProgress?.({
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
        console.warn("Recomputing artist counts (post-tracks) failed", e);
      }

      // Stage 4: Sync Playlists
      onProgress?.({
        stage: "playlists",
        current: 0,
        total: 0,
        message: "Fetching playlists from server...",
      });

      const playlists = await getAllPlaylists();
      console.log(`Found ${playlists.length} playlists`);

      if (playlists.length > 0) {
        onProgress?.({
          stage: "playlists",
          current: 0,
          total: playlists.length,
          message: "Saving playlists to local database...",
        });

        await localDb.savePlaylists(playlists);

        onProgress?.({
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

      onProgress?.({
        stage: "complete",
        current: 1,
        total: 1,
        message: "Synchronization completed successfully!",
      });

      console.log("Full sync completed successfully");

      // Dispatch sync update event
      window.dispatchEvent(new CustomEvent("syncUpdate"));
    } catch (error) {
      console.error("Full sync failed:", error);
      throw error;
    } finally {
      this.isRunning = false;
      this.abortController = null;
    }
  }

  async startIncrementalSync(onProgress?: SyncProgressCallback): Promise<void> {
    // True incremental: if a full sync is running or none yet, delegate to full sync
    const syncStatus = await localDb.getSyncStatus();
    if (this.isRunning || syncStatus.lastFullSync === 0) {
      console.log(
        "Incremental sync delegates to full sync (none run yet or already running)"
      );
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
      console.log("Starting incremental sync...");
      const lastIncremental =
        syncStatus.lastIncrementalSync || syncStatus.lastFullSync;
      const cutoff = lastIncremental - 5 * 60 * 1000; // small fudge window

      // For simplicity, fetch all albums then filter by date_created after cutoff
      onProgress?.({
        stage: "albums",
        current: 0,
        total: 0,
        message: "Fetching updated albums...",
      });
      const allAlbums = await getAllAlbums();
      const changedAlbums = allAlbums.filter((a: any) => {
        const created = a.DateCreated ? Date.parse(a.DateCreated) : 0;
        return created >= cutoff || (a as any).DateModified; // naive detection
      });

      if (changedAlbums.length) {
        let processed = 0;
        onProgress?.({
          stage: "albums",
          current: 0,
          total: changedAlbums.length,
          message: `Updating ${changedAlbums.length} changed albums...`,
        });
        await localDb.saveAlbums(changedAlbums);
        processed = changedAlbums.length;
        onProgress?.({
          stage: "albums",
          current: processed,
          total: changedAlbums.length,
          message: "Albums updated",
        });
      }

      // Tracks for changed albums only
      if (changedAlbums.length) {
        onProgress?.({
          stage: "tracks",
          current: 0,
          total: changedAlbums.length,
          message: "Refreshing tracks for changed albums...",
        });
        let allTracks: any[] = [];
        let processedAlbums = 0;
        for (const album of changedAlbums) {
          if (this.abortController?.signal.aborted)
            throw new Error("Sync was aborted");
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
            console.warn(
              "Incremental: failed to fetch tracks for",
              album.Name,
              e
            );
          }
          processedAlbums++;
          onProgress?.({
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

      // Update incremental sync metadata only
      await localDb.setSyncMetadata(
        "lastIncrementalSync",
        Date.now().toString()
      );
      onProgress?.({
        stage: "complete",
        current: 1,
        total: 1,
        message: "Incremental sync completed",
      });
      window.dispatchEvent(new CustomEvent("syncUpdate"));
    } catch (e) {
      console.error("Incremental sync failed", e);
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
    console.log("Database cleared");
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
        console.log("✅ Sync has produced data, continuing with local data");
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
          console.log(
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
        console.warn(
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
          console.log(`Retrieved artist ${id} from local database`);
          return localArtist;
        }
      } catch (error) {
        console.warn(
          "Failed to get artist from local database, falling back to server:",
          error
        );
      }
    }

    // Fall back to server
    console.log(`Fetching artist ${id} from server...`);
    try {
      return await getArtistInfo(id);
    } catch (error) {
      console.error("Failed to fetch artist from server:", error);
      return null;
    }
  }

  async getAlbums(
    limit?: number,
    offset?: number,
    forceOnline: boolean = false
  ): Promise<BaseItemDto[]> {
    console.time("HybridData.getAlbums");
    console.log("🔍 HybridData.getAlbums: Starting...");

    if (!forceOnline && this.useLocalFirst) {
      try {
        console.log("🔍 HybridData.getAlbums: Initializing local DB...");
        await localDb.initialize();
        console.log("🔍 HybridData.getAlbums: Getting albums from local DB...");
        let localAlbums = await localDb.getAlbums(limit, offset);
        console.log(
          `🔍 HybridData.getAlbums: Found ${localAlbums.length} local albums`
        );

        // If no local data but sync is running, wait a bit for sync to complete
        if (localAlbums.length === 0 && (await this.shouldWaitForSync())) {
          console.log(
            "🔄 No local albums found, but sync is running. Waiting for sync progress..."
          );
          await this.waitForSyncProgress(3000); // Wait up to 3 seconds

          // Try again after waiting
          localAlbums = await localDb.getAlbums(limit, offset);
          console.log(
            `🔍 HybridData.getAlbums: After waiting, found ${localAlbums.length} local albums`
          );
        }

        if (localAlbums.length > 0) {
          console.log(
            `🔍 HybridData.getAlbums: Retrieved ${localAlbums.length} albums from local database`
          );
          console.timeEnd("HybridData.getAlbums");
          return localAlbums;
        }
      } catch (error) {
        console.warn(
          "🔍 HybridData.getAlbums: Failed to get albums from local database, falling back to server:",
          error
        );
      }
    }

    // Fall back to server
    console.log("🔍 HybridData.getAlbums: Fetching albums from server...");
    const serverAlbums = await getAllAlbums();
    console.log(
      `🔍 HybridData.getAlbums: Got ${serverAlbums.length} albums from server`
    );
    console.timeEnd("HybridData.getAlbums");
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
          console.log(`Retrieved album ${id} from local database`);
          return localAlbum;
        }
      } catch (error) {
        console.warn(
          "Failed to get album from local database, falling back to server:",
          error
        );
      }
    }

    // Fall back to server
    console.log(`Fetching album ${id} from server...`);
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
      console.error("Failed to fetch album from server:", error);
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
          console.log(
            `Retrieved ${localTracks.length} tracks for album ${albumId} from local database`
          );
          return localTracks;
        }
      } catch (error) {
        console.warn(
          "Failed to get album tracks from local database, falling back to server:",
          error
        );
      }
    }

    // Fall back to server
    console.log(`Fetching tracks for album ${albumId} from server...`);
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
      console.error("Failed to fetch album tracks from server:", error);
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
          console.log(
            `Retrieved ${localAlbums.length} albums for artist ${artistId} from local database`
          );
          return localAlbums;
        }
      } catch (error) {
        console.warn(
          "Failed to get artist albums from local database, falling back to server:",
          error
        );
      }
    }

    // Fall back to server
    console.log(`Fetching albums for artist ${artistId} from server...`);
    try {
      const { getArtistAlbums } = await import("./jellyfin");
      return await getArtistAlbums(artistId);
    } catch (error) {
      console.error("Failed to fetch artist albums from server:", error);
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
          console.log(
            `Retrieved ${localTracks.length} tracks for artist ${artistId} from local database`
          );
          return localTracks;
        }
      } catch (error) {
        console.warn(
          "Failed to get artist tracks from local database, falling back to server:",
          error
        );
      }
    }

    // Fall back to server
    console.log(`Fetching tracks for artist ${artistId} from server...`);
    return await getArtistTracks(artistId);
  }

  async getPlaylists(forceOnline: boolean = false): Promise<BaseItemDto[]> {
    if (!forceOnline && this.useLocalFirst) {
      try {
        await localDb.initialize();
        const localPlaylists = await localDb.getPlaylists();
        if (localPlaylists.length > 0) {
          console.log(
            `Retrieved ${localPlaylists.length} playlists from local database`
          );
          return localPlaylists;
        }
      } catch (error) {
        console.warn(
          "Failed to get playlists from local database, falling back to server:",
          error
        );
      }
    }

    // Fall back to server
    console.log("Fetching playlists from server...");
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
          console.log(
            `Found ${localResults.length} artists matching "${query}" in local database`
          );
          return localResults;
        }
      } catch (error) {
        console.warn(
          "Failed to search artists in local database, falling back to server:",
          error
        );
      }
    }

    // Fall back to server search (would need to implement server search)
    console.log(`Searching for artists "${query}" on server...`);
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
      console.warn("Track search failed", e);
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
  autoSyncInterval = window.setInterval(() => {
    if (!enabled) return;
    if (syncService.isCurrentlyRunning()) return;
    syncService
      .startIncrementalSync()
      .catch((e) => console.warn("Auto incremental sync failed", e));
  }, 30 * 60 * 1000);
}

// Visibility / online triggers
if (typeof window !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      const enabled = localStorage.getItem("autoSync") === "true";
      if (enabled && !syncService.isCurrentlyRunning()) {
        syncService
          .startIncrementalSync()
          .catch((e) => console.warn("Visibility incremental sync failed", e));
      }
    }
  });
  window.addEventListener("online", () => {
    const enabled = localStorage.getItem("autoSync") === "true";
    if (enabled && !syncService.isCurrentlyRunning()) {
      syncService
        .startIncrementalSync()
        .catch((e) => console.warn("Online incremental sync failed", e));
    }
  });
  scheduleAutoSync();
}
