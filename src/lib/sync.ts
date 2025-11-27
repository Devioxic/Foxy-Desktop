import { localDb } from "./database";
import {
  getAllArtists,
  getAllAlbums,
  getAllPlaylists,
  getAlbumItems,
  getArtistTracks,
  getAlbumInfo,
  getArtistInfo,
  getPlaylistItems,
  getPlaylistInfo,
  getRecentlyPlayedAlbums,
  searchWithRelatedContent,
} from "./jellyfin";
import { BaseItemDto } from "@jellyfin/sdk/lib/generated-client/models";
import { logger } from "./logger";

const TRACK_BATCH_SIZE = 200;

const getHardwareConcurrency = (): number => {
  const raw = (globalThis as any)?.navigator?.hardwareConcurrency;
  return typeof raw === "number" && raw > 0 ? raw : 4;
};

const computeWorkerCount = (
  totalJobs: number,
  { max = 8, min = 2 }: { max?: number; min?: number } = {}
): number => {
  if (totalJobs <= 0) return 0;
  const hc = getHardwareConcurrency();
  const suggested = Math.floor(hc / 2) || min;
  const capped = Math.min(Math.max(min, suggested), max);
  return Math.max(1, Math.min(totalJobs, capped));
};

const createBatchSaver = <T>(
  batchSize: number,
  flush: (items: T[]) => Promise<void>
) => {
  let buffer: T[] = [];
  let flushChain: Promise<void> = Promise.resolve();

  const scheduleFlush = (items: T[]) => {
    flushChain = flushChain.then(() => flush(items));
  };

  return {
    push(items: T[]) {
      if (!items.length) return;
      buffer.push(...items);
      if (buffer.length >= batchSize) {
        const toFlush = buffer.splice(0, buffer.length);
        scheduleFlush(toFlush);
      }
    },
    async flushAll() {
      if (buffer.length) {
        const remaining = buffer.splice(0, buffer.length);
        scheduleFlush(remaining);
      }
      await flushChain;
    },
  };
};

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
      const artistsWithChildCount = artists.filter((artist: any) => {
        const childCount = artist?.ChildCount;
        return typeof childCount === "number" && childCount > 0;
      });

      const excludedArtists = artists.length - artistsWithChildCount.length;
      if (excludedArtists > 0) {
        logger.info(
          `SyncService: Excluding ${excludedArtists} artists without ChildCount data`
        );
      }

      if (artistsWithChildCount.length > 0) {
        notifyProgress({
          stage: "artists",
          current: 0,
          total: artistsWithChildCount.length,
          message: "Saving artists to local database...",
        });

        await localDb.saveArtists(artistsWithChildCount);

        notifyProgress({
          stage: "artists",
          current: artistsWithChildCount.length,
          total: artistsWithChildCount.length,
          message: "Artists synchronized successfully",
        });
      } else if (excludedArtists > 0) {
        notifyProgress({
          stage: "artists",
          current: 0,
          total: 0,
          message:
            "Skipped syncing artists because none reported album child counts",
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

      if (albums.length > 0) {
        const workerCount = computeWorkerCount(albums.length);
        const trackSaver = createBatchSaver<BaseItemDto>(
          TRACK_BATCH_SIZE,
          async (batch) => {
            await localDb.saveTracks(batch);
          }
        );

        let nextAlbumIndex = 0;
        let processedAlbums = 0;

        const workers = Array.from({ length: workerCount }, async () => {
          for (
            let albumIndex = nextAlbumIndex++;
            albumIndex < albums.length;
            albumIndex = nextAlbumIndex++
          ) {
            if (this.abortController?.signal.aborted) {
              throw new Error("Sync was aborted");
            }

            const album = albums[albumIndex];
            const albumName = album?.Name || "Unknown Album";

            if (!album?.Id) {
              processedAlbums++;
              notifyProgress({
                stage: "tracks",
                current: processedAlbums,
                total: albums.length,
                message: `Skipping album without ID (${processedAlbums}/${albums.length})`,
              });
              continue;
            }

            try {
              const albumTracksResult = await getAlbumItems(
                authData.serverAddress,
                authData.accessToken,
                album.Id
              );
              const items = albumTracksResult?.Items || [];
              if (items.length) {
                trackSaver.push(items);
              }
            } catch (error) {
              logger.warn(
                `Failed to fetch tracks for album ${albumName}:`,
                error
              );
            }

            processedAlbums++;
            notifyProgress({
              stage: "tracks",
              current: processedAlbums,
              total: albums.length,
              message: `Processing album ${processedAlbums}/${albums.length}: ${albumName}`,
            });
          }
        });

        await Promise.all(workers);
        await trackSaver.flushAll();
      } else {
        notifyProgress({
          stage: "tracks",
          current: 0,
          total: 0,
          message: "No albums available for track synchronization",
        });
      }

      // Recompute counts now that tracks are saved
      try {
        await localDb.recomputeArtistCounts();
      } catch (e) {
        logger.warn("Recomputing artist counts (post-tracks) failed", e);
      }

      await this.syncPlaylistsWithItems(notifyProgress);

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
        const trackSaver = createBatchSaver<BaseItemDto>(
          TRACK_BATCH_SIZE,
          async (batch) => {
            await localDb.saveTracks(batch);
          }
        );
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
              trackSaver.push(albumTracksResult.Items);
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
        }
        await trackSaver.flushAll();
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

  private async syncPlaylistsWithItems(
    notifyProgress: (progress: SyncProgress) => void
  ): Promise<void> {
    notifyProgress({
      stage: "playlists",
      current: 0,
      total: 0,
      message: "Fetching playlists from server...",
    });

    const playlists = await getAllPlaylists();

    if (!playlists.length) {
      await localDb.savePlaylists([]);
      notifyProgress({
        stage: "playlists",
        current: 0,
        total: 0,
        message: "No playlists found",
      });
      return;
    }

    notifyProgress({
      stage: "playlists",
      current: 0,
      total: playlists.length,
      message: "Saving playlists to local database...",
    });

    await localDb.savePlaylists(playlists);

    const playlistWorkerCount = computeWorkerCount(playlists.length, {
      max: 6,
      min: 2,
    });
    let processed = 0;
    let nextIndex = 0;

    const trackSaver = createBatchSaver<BaseItemDto>(
      TRACK_BATCH_SIZE,
      async (batch) => {
        await localDb.saveTracks(batch);
      }
    );

    const workers = Array.from({ length: playlistWorkerCount }, async () => {
      for (
        let playlistIndex = nextIndex++;
        playlistIndex < playlists.length;
        playlistIndex = nextIndex++
      ) {
        if (this.abortController?.signal.aborted) {
          throw new Error("Sync was aborted");
        }

        const playlist = playlists[playlistIndex];
        if (!playlist?.Id) {
          processed++;
          notifyProgress({
            stage: "playlists",
            current: processed,
            total: playlists.length,
            message: `Skipping playlist without ID (${processed}/${playlists.length})`,
          });
          continue;
        }

        try {
          const items = (await getPlaylistItems(playlist.Id)) || [];
          const normalized = items.filter(
            (item): item is BaseItemDto => !!item?.Id
          );
          const totalTicks = normalized.reduce(
            (acc, item) => acc + (item.RunTimeTicks || 0),
            0
          );
          const entries = normalized.map((item, index) => {
            const playlistItemId =
              ((item as any).PlaylistItemId as string | undefined) ||
              `${playlist.Id}:${item.Id}:${index}`;
            return {
              playlistItemId,
              trackId: item.Id!,
              sortIndex: index,
            };
          });
          await localDb.replacePlaylistItems(playlist.Id, entries);
          await localDb.updatePlaylistStats(
            playlist.Id,
            normalized.length,
            totalTicks
          );

          const audioTracks = normalized.filter(
            (item): item is BaseItemDto => item.Type === "Audio" && !!item.Id
          );
          if (audioTracks.length) {
            trackSaver.push(audioTracks);
          }
        } catch (error) {
          logger.warn(
            `Failed to fetch playlist items for ${playlist.Name || playlist.Id}`,
            error
          );
          try {
            await localDb.replacePlaylistItems(playlist.Id, []);
            await localDb.updatePlaylistStats(playlist.Id, 0, 0);
          } catch (dbError) {
            logger.warn("Failed to clear cached playlist items", dbError);
          }
        }

        processed++;
        notifyProgress({
          stage: "playlists",
          current: processed,
          total: playlists.length,
          message: `Cached ${processed}/${playlists.length} playlists`,
        });
      }
    });

    await Promise.all(workers);
    await trackSaver.flushAll();

    notifyProgress({
      stage: "playlists",
      current: playlists.length,
      total: playlists.length,
      message: "Playlists synchronized successfully",
    });
  }
}

// Helper functions for hybrid online/offline access
export class HybridDataService {
  private useLocalFirst: boolean = true;
  private offlineModeActive: boolean = false;
  private previousUseLocalFirst: boolean | null = null;

  constructor(useLocalFirst: boolean = true) {
    this.useLocalFirst = useLocalFirst;
  }

  setUseLocalFirst(useLocal: boolean) {
    this.useLocalFirst = useLocal;
  }

  setOfflineModeActive(active: boolean) {
    this.offlineModeActive = active;
    if (active) {
      // When offline we always prioritise local data regardless of preference
      if (this.previousUseLocalFirst === null) {
        this.previousUseLocalFirst = this.useLocalFirst;
      }
      this.useLocalFirst = true;
    } else {
      if (this.previousUseLocalFirst !== null) {
        this.useLocalFirst = this.previousUseLocalFirst;
        this.previousUseLocalFirst = null;
        return;
      }
      try {
        const stored = localStorage.getItem("useLocalFirst");
        if (stored !== null) {
          this.useLocalFirst = stored === "true";
        }
      } catch {}
    }
  }

  isOfflineModeActive() {
    return this.offlineModeActive;
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
    onlyWithAlbums: boolean = true
  ): Promise<BaseItemDto[]> {
    const preferLocal =
      !forceOnline && (this.useLocalFirst || this.offlineModeActive);
    if (preferLocal) {
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

        if (localArtists.length > 0 || this.offlineModeActive) {
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
    const preferLocal =
      !forceOnline && (this.useLocalFirst || this.offlineModeActive);
    if (preferLocal) {
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

    if (this.offlineModeActive) {
      return null;
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
    const preferLocal =
      !forceOnline && (this.useLocalFirst || this.offlineModeActive);
    if (preferLocal) {
      try {
        await localDb.initialize();
        let localAlbums = await localDb.getAlbums(limit, offset);

        // If no local data but sync is running, wait a bit for sync to complete
        if (localAlbums.length === 0 && (await this.shouldWaitForSync())) {
          await this.waitForSyncProgress(3000); // Wait up to 3 seconds

          // Try again after waiting
          localAlbums = await localDb.getAlbums(limit, offset);
        }

        if (localAlbums.length > 0 || this.offlineModeActive) {
          return localAlbums;
        }
      } catch (error) {
        logger.warn(
          "🔍 HybridData.getAlbums: Failed to get albums from local database, falling back to server:",
          error
        );
      }
    }

    if (this.offlineModeActive) {
      return [];
    }

    // Fall back to server
    const serverAlbums = await getAllAlbums();

    return serverAlbums;
  }

  async getRecentlyAddedAlbums(
    limit = 12,
    forceOnline: boolean = false
  ): Promise<BaseItemDto[]> {
    const preferLocal =
      !forceOnline && (this.useLocalFirst || this.offlineModeActive);
    if (preferLocal) {
      try {
        await localDb.initialize();
        const local = await localDb.getRecentlyAddedAlbums(limit);
        if (local.length > 0 || this.offlineModeActive) {
          return local;
        }
      } catch (error) {
        logger.warn(
          "Failed to get recently added albums from local database",
          error
        );
      }
    }

    if (this.offlineModeActive) {
      return [];
    }

    const all = await getAllAlbums();
    if (all.length) {
      await localDb.saveAlbums(all);
    }
    await localDb.initialize();
    return await localDb.getRecentlyAddedAlbums(limit);
  }

  async getFavoriteAlbums(
    limit?: number,
    forceOnline: boolean = false
  ): Promise<BaseItemDto[]> {
    const preferLocal =
      !forceOnline && (this.useLocalFirst || this.offlineModeActive);
    if (preferLocal) {
      try {
        await localDb.initialize();
        const local = await localDb.getFavoriteAlbums(limit);
        if (local.length > 0 || this.offlineModeActive) {
          return local;
        }
      } catch (error) {
        logger.warn(
          "Failed to get favourite albums from local database",
          error
        );
      }
    }

    if (this.offlineModeActive) {
      return [];
    }

    const all = await getAllAlbums();
    if (all.length) {
      await localDb.saveAlbums(all);
    }
    const filtered = all.filter(
      (album: any) => album?.UserData?.IsFavorite === true
    );
    if (filtered.length) {
      await localDb.saveAlbums(filtered as BaseItemDto[]);
    }
    await localDb.initialize();
    return await localDb.getFavoriteAlbums(limit);
  }

  async getRecentlyPlayedAlbums(
    limit = 6,
    forceOnline: boolean = false
  ): Promise<BaseItemDto[]> {
    const preferLocal =
      !forceOnline && (this.useLocalFirst || this.offlineModeActive);
    if (preferLocal) {
      try {
        await localDb.initialize();
        const local = await localDb.getRecentlyPlayedAlbums(limit);
        if (local.length > 0 || this.offlineModeActive) {
          return local;
        }
      } catch (error) {
        logger.warn(
          "Failed to get recently played albums from local database",
          error
        );
      }
    }

    if (this.offlineModeActive) {
      return [];
    }

    const authData = JSON.parse(localStorage.getItem("authData") || "{}");
    if (!authData.serverAddress || !authData.accessToken) {
      return [];
    }

    const remote = await getRecentlyPlayedAlbums(
      authData.serverAddress,
      authData.accessToken,
      Math.max(limit * 2, limit)
    );

    await localDb.initialize();
    const resolved: BaseItemDto[] = [];
    for (const entry of remote) {
      if (!entry?.Id) continue;
      let album = await localDb.getAlbumById(entry.Id);
      if (!album) {
        try {
          const full = await getAlbumInfo(
            authData.serverAddress,
            authData.accessToken,
            entry.Id
          );
          if (full) {
            await localDb.saveAlbums([full]);
            album = (await localDb.getAlbumById(
              entry.Id
            )) as BaseItemDto | null;
          }
        } catch (error) {
          logger.warn(
            "Failed to fetch album info for recently played entry",
            error
          );
        }
      }
      if (album) {
        resolved.push(album);
      }
      if (resolved.length >= limit) break;
    }
    if (resolved.length >= limit) {
      return resolved.slice(0, limit);
    }
    return await localDb.getRecentlyPlayedAlbums(limit);
  }

  async getAlbumById(
    id: string,
    forceOnline: boolean = false
  ): Promise<BaseItemDto | null> {
    // Optionally try local first
    const preferLocal =
      !forceOnline && (this.useLocalFirst || this.offlineModeActive);
    if (preferLocal) {
      try {
        await localDb.initialize();
        const localAlbum = await localDb.getAlbumById(id);
        if (localAlbum) return localAlbum;
      } catch (error) {
        logger.warn("Local album lookup failed", error);
      }
    }

    if (this.offlineModeActive) {
      return null;
    }

    // Try server
    try {
      const authData = JSON.parse(localStorage.getItem("authData") || "{}");
      if (!authData.serverAddress || !authData.accessToken) {
        throw new Error("Authentication data not found");
      }
      const online = await getAlbumInfo(
        authData.serverAddress,
        authData.accessToken,
        id
      );
      if (online) return online;
    } catch (error) {
      logger.warn(
        "Server album fetch failed, attempting local fallback",
        error
      );
    }

    // Final local fallback regardless of useLocalFirst
    try {
      await localDb.initialize();
      return (await localDb.getAlbumById(id)) as any;
    } catch (e) {
      return null;
    }
  }

  async getAlbumTracks(
    albumId: string,
    forceOnline: boolean = false
  ): Promise<BaseItemDto[]> {
    // Optionally try local first
    const preferLocal =
      !forceOnline && (this.useLocalFirst || this.offlineModeActive);
    if (preferLocal) {
      try {
        await localDb.initialize();
        const localTracks = await localDb.getTracksByAlbumId(albumId);
        if (localTracks.length > 0 || this.offlineModeActive)
          return localTracks;
      } catch (error) {
        logger.warn("Local album tracks lookup failed", error);
      }
    }

    if (this.offlineModeActive) {
      return [];
    }

    // Try server
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
      const items = result.Items || [];
      if (items.length) return items;
    } catch (error) {
      logger.warn(
        "Server album tracks fetch failed, attempting local fallback",
        error
      );
    }

    // Final local fallback
    try {
      await localDb.initialize();
      return await localDb.getTracksByAlbumId(albumId);
    } catch (e) {
      return [];
    }
  }

  async getArtistAlbums(
    artistId: string,
    forceOnline: boolean = false
  ): Promise<BaseItemDto[]> {
    const preferLocal =
      !forceOnline && (this.useLocalFirst || this.offlineModeActive);
    if (preferLocal) {
      try {
        await localDb.initialize();
        const localAlbums = await localDb.getAlbumsByArtistId(artistId);
        if (localAlbums.length > 0 || this.offlineModeActive) {
          return localAlbums;
        }
      } catch (error) {
        logger.warn(
          "Failed to get artist albums from local database, falling back to server:",
          error
        );
      }
    }

    if (this.offlineModeActive) {
      return [];
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
    const preferLocal =
      !forceOnline && (this.useLocalFirst || this.offlineModeActive);
    if (preferLocal) {
      try {
        await localDb.initialize();
        const localTracks = await localDb.getTracksByArtistId(artistId);
        if (localTracks.length > 0 || this.offlineModeActive) {
          return localTracks;
        }
      } catch (error) {
        logger.warn(
          "Failed to get artist tracks from local database, falling back to server:",
          error
        );
      }
    }

    if (this.offlineModeActive) {
      return [];
    }

    // Fall back to server

    return await getArtistTracks(artistId);
  }

  async getPlaylists(forceOnline: boolean = false): Promise<BaseItemDto[]> {
    const preferLocal =
      !forceOnline && (this.useLocalFirst || this.offlineModeActive);
    if (preferLocal) {
      try {
        await localDb.initialize();
        const localPlaylists = await localDb.getPlaylists();
        if (localPlaylists.length > 0 || this.offlineModeActive) {
          logger.debug(
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

    if (this.offlineModeActive) {
      return [];
    }

    // Fall back to server

    return await getAllPlaylists();
  }

  async getPlaylistById(
    id: string,
    forceOnline: boolean = false
  ): Promise<BaseItemDto | null> {
    const preferLocal =
      !forceOnline && (this.useLocalFirst || this.offlineModeActive);
    if (preferLocal) {
      try {
        await localDb.initialize();
        const localPlaylist = await localDb.getPlaylistById(id);
        if (localPlaylist) {
          return localPlaylist;
        }
      } catch (error) {
        logger.warn(
          "Failed to get playlist from local database, falling back to server:",
          error
        );
      }
    }

    if (this.offlineModeActive) {
      return null;
    }

    try {
      return await getPlaylistInfo(id);
    } catch (error) {
      logger.warn("Failed to fetch playlist from server:", error);
    }

    try {
      await localDb.initialize();
      return await localDb.getPlaylistById(id);
    } catch (error) {
      logger.warn("Final local playlist lookup failed", error);
      return null;
    }
  }

  async getPlaylistTracks(
    playlistId: string,
    forceOnline: boolean = false
  ): Promise<BaseItemDto[]> {
    const preferLocal =
      !forceOnline && (this.useLocalFirst || this.offlineModeActive);
    if (preferLocal) {
      try {
        await localDb.initialize();
        const localTracks = await localDb.getPlaylistTracks(playlistId);
        if (localTracks.length > 0 || this.offlineModeActive) {
          return localTracks;
        }
      } catch (error) {
        logger.warn(
          "Failed to get playlist tracks from local database, falling back to server:",
          error
        );
      }
    }

    if (this.offlineModeActive) {
      return [];
    }

    try {
      const tracks = await getPlaylistItems(playlistId);
      return tracks || [];
    } catch (error) {
      logger.warn("Failed to fetch playlist tracks from server:", error);
    }

    try {
      await localDb.initialize();
      return await localDb.getPlaylistTracks(playlistId);
    } catch (error) {
      logger.warn("Final local playlist tracks lookup failed", error);
      return [];
    }
  }

  async searchArtists(
    query: string,
    forceOnline: boolean = false
  ): Promise<BaseItemDto[]> {
    const preferLocal =
      !forceOnline && (this.useLocalFirst || this.offlineModeActive);
    if (preferLocal) {
      try {
        await localDb.initialize();
        const localResults = await localDb.searchArtists(query);
        if (localResults.length > 0 || this.offlineModeActive) {
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

    if (this.offlineModeActive) {
      return [];
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

  async searchLibrary(
    query: string,
    forceOnline: boolean = false
  ): Promise<{
    albums: BaseItemDto[];
    artists: BaseItemDto[];
    tracks: BaseItemDto[];
    playlists: BaseItemDto[];
  }> {
    const preferLocal =
      !forceOnline && (this.useLocalFirst || this.offlineModeActive);

    const gatherLocal = async () => {
      await localDb.initialize();
      const [albums, artists, tracks, playlists] = await Promise.all([
        localDb.searchAlbums(query, 80),
        localDb.searchArtists(query),
        localDb.searchTracks(query),
        localDb.searchPlaylists(query, 40),
      ]);
      return { albums, artists, tracks, playlists };
    };

    if (preferLocal) {
      try {
        const localResults = await gatherLocal();
        const hasResults =
          localResults.albums.length +
            localResults.artists.length +
            localResults.tracks.length +
            localResults.playlists.length >
          0;
        if (hasResults || this.offlineModeActive) {
          return localResults;
        }
      } catch (error) {
        logger.warn("Local library search failed", error);
      }
    }

    if (this.offlineModeActive) {
      return {
        albums: [],
        artists: [],
        tracks: [],
        playlists: [],
      };
    }

    const remote = await searchWithRelatedContent(query, {
      forceRemote: true,
    });
    const albumsRemote = remote.filter(
      (item: any) => item?.Type === "MusicAlbum"
    );
    const artistsRemote = remote.filter(
      (item: any) => item?.Type === "MusicArtist"
    );
    const tracksRemote = remote.filter((item: any) => item?.Type === "Audio");
    const playlistsRemote = remote.filter(
      (item: any) => item?.Type === "Playlist"
    );

    try {
      await localDb.initialize();
      if (albumsRemote.length) {
        await localDb.saveAlbums(albumsRemote as BaseItemDto[]);
      }
      if (artistsRemote.length) {
        await localDb.saveArtists(artistsRemote as BaseItemDto[]);
      }
      if (tracksRemote.length) {
        await localDb.saveTracks(tracksRemote as BaseItemDto[]);
      }
      if (playlistsRemote.length) {
        await localDb.savePlaylists(playlistsRemote as BaseItemDto[]);
      }
    } catch (error) {
      logger.warn("Failed to persist remote search results locally", error);
    }

    return gatherLocal();
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
