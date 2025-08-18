import { hybridData, syncService } from "@/lib/sync";
import { logger } from "@/lib/logger";

// Lightweight performance marking helpers
export const perf = {
  start(label: string) {
    try {
      performance.mark(`${label}-start`);
    } catch {}
  },
  end(label: string) {
    try {
      performance.mark(`${label}-end`);
      performance.measure(label, `${label}-start`, `${label}-end`);
      if (import.meta.env.DEV) {
        const measures = performance.getEntriesByName(label, "measure");
        const last = measures[measures.length - 1];
        if (last) logger.info(`🕒 ${label}: ${last.duration.toFixed(2)}ms`);
      }
    } catch {}
  },
};

// Performance diagnostic tool
export const performanceDiagnostics = {
  async diagnoseLoadingSpeed() {
    const results = {
      timestamp: new Date().toISOString(),
      tests: {} as Record<string, any>,
    };

    console.group("🔍 Performance Diagnostics");

    // Test 1: Database initialization
    const dbInitStart = performance.now();
    try {
      // Access optional localDb if present without index signature complaints
      await (hybridData as any)?.localDb?.initialize?.();
      const dbInitEnd = performance.now();
      results.tests.databaseInit = {
        duration: dbInitEnd - dbInitStart,
        success: true,
      };
      logger.info(
        `✅ Database init: ${(dbInitEnd - dbInitStart).toFixed(2)}ms`
      );
    } catch (error: any) {
      results.tests.databaseInit = {
        duration: -1,
        success: false,
        error: error.message,
      };
      logger.error("❌ Database init failed:", error);
    }

    // Test 2: Sync status check
    const syncStatusStart = performance.now();
    try {
      const syncStatus = await syncService.getSyncStatus();
      const syncStatusEnd = performance.now();
      results.tests.syncStatus = {
        duration: syncStatusEnd - syncStatusStart,
        success: true,
        status: syncStatus,
      };
      logger.info(
        `✅ Sync status: ${(syncStatusEnd - syncStatusStart).toFixed(2)}ms`,
        syncStatus
      );
    } catch (error: any) {
      results.tests.syncStatus = {
        duration: -1,
        success: false,
        error: error.message,
      };
      logger.error("❌ Sync status failed:", error);
    }

    // Test 3: Artists loading
    const artistsStart = performance.now();
    try {
      const artists = await hybridData.getArtists();
      const artistsEnd = performance.now();
      results.tests.artistsLoad = {
        duration: artistsEnd - artistsStart,
        success: true,
        count: artists.length,
        source: artists.length > 0 ? "local" : "server",
      };
      logger.info(
        `✅ Artists load: ${(artistsEnd - artistsStart).toFixed(2)}ms (${artists.length} artists)`
      );
    } catch (error: any) {
      results.tests.artistsLoad = {
        duration: -1,
        success: false,
        error: error.message,
      };
      logger.error("❌ Artists load failed:", error);
    }

    // Test 4: Albums loading
    const albumsStart = performance.now();
    try {
      const albums = await hybridData.getAlbums();
      const albumsEnd = performance.now();
      results.tests.albumsLoad = {
        duration: albumsEnd - albumsStart,
        success: true,
        count: albums.length,
        source: albums.length > 0 ? "local" : "server",
      };
      logger.info(
        `✅ Albums load: ${(albumsEnd - albumsStart).toFixed(2)}ms (${albums.length} albums)`
      );
    } catch (error: any) {
      results.tests.albumsLoad = {
        duration: -1,
        success: false,
        error: error.message,
      };
      logger.error("❌ Albums load failed:", error);
    }

    // Test 5: Playlists loading
    const playlistsStart = performance.now();
    try {
      const playlists = await hybridData.getPlaylists();
      const playlistsEnd = performance.now();
      results.tests.playlistsLoad = {
        duration: playlistsEnd - playlistsStart,
        success: true,
        count: playlists.length,
        source: playlists.length > 0 ? "local" : "server",
      };
      logger.info(
        `✅ Playlists load: ${(playlistsEnd - playlistsStart).toFixed(2)}ms (${playlists.length} playlists)`
      );
    } catch (error: any) {
      results.tests.playlistsLoad = {
        duration: -1,
        success: false,
        error: error.message,
      };
      logger.error("❌ Playlists load failed:", error);
    }

    console.groupEnd();

    // Summary
    const totalDuration = Object.values(results.tests)
      .filter((test: any) => test.success && test.duration > 0)
      .reduce((sum: number, test: any) => sum + test.duration, 0);

    logger.info(`📊 Total test duration: ${totalDuration.toFixed(2)}ms`);

    return results;
  },

  async checkDataAvailability() {
    console.group("📦 Data Availability Check");

    try {
      const syncStatus = await syncService.getSyncStatus();
      logger.info("Artists count:", syncStatus.artistsCount);
      logger.info("Albums count:", syncStatus.albumsCount);
      logger.info("Tracks count:", syncStatus.tracksCount);
      logger.info("Playlists count:", syncStatus.playlistsCount);
      logger.info(
        "Last full sync:",
        syncStatus.lastFullSync
          ? new Date(syncStatus.lastFullSync).toLocaleString()
          : "Never"
      );
      logger.info(
        "Last incremental sync:",
        syncStatus.lastIncrementalSync
          ? new Date(syncStatus.lastIncrementalSync).toLocaleString()
          : "Never"
      );

      const hasData = syncStatus.artistsCount > 0 || syncStatus.albumsCount > 0;
      logger.info(
        hasData ? "✅ Local data available" : "❌ No local data found"
      );

      if (!hasData) {
        logger.warn(
          "🔄 Pages will load from server (slow). Consider running a sync first."
        );
      }
    } catch (error) {
      logger.error("❌ Failed to check data availability:", error);
    }

    console.groupEnd();
  },
};

// Auto-run diagnostics in development
if (import.meta.env.DEV) {
  // Run diagnostics after a short delay to ensure app is loaded
  setTimeout(() => {
    performanceDiagnostics.checkDataAvailability();
  }, 2000);
}
