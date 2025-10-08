import React, {
  useState,
  useEffect,
  useMemo,
  useCallback,
  useRef,
} from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Input } from "@/components/ui/input";
import { logger } from "@/lib/logger";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import Sidebar from "@/components/Sidebar";
import MusicPlayer from "@/components/MusicPlayer";
import LoadingSkeleton from "@/components/LoadingSkeleton";
import PlaylistCard from "@/components/PlaylistCard";
import CreatePlaylistDialog from "@/components/CreatePlaylistDialog";
import { useAuthData } from "@/hooks/useAuthData";
import {
  Search,
  Music,
  ListMusic,
  ChevronLeft,
  ChevronRight,
  Plus,
  Heart,
  Download,
} from "lucide-react";
import { createPlaylist } from "@/lib/jellyfin";
import { hybridData } from "@/lib/sync";
import { BaseItemDto } from "@jellyfin/sdk/lib/generated-client/models";

interface Playlist extends BaseItemDto {
  ChildCount?: number;
}

const PLAYLISTS_PER_PAGE = 48; // 6 columns × 8 rows on large screens

const Playlists = () => {
  const navigate = useNavigate();
  const { authData } = useAuthData();
  const [searchParams, setSearchParams] = useSearchParams();

  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [filteredPlaylists, setFilteredPlaylists] = useState<Playlist[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const refreshTimeout = useRef<number | null>(null);

  const isLoggedIn = Boolean(authData?.accessToken && authData?.serverAddress);

  const loadPlaylists = useCallback(async () => {
    if (!isLoggedIn) {
      setLoading(false);
      navigate("/login");
      return;
    }

    setLoading(true);
    try {
      // Use hybrid data service for better performance
      const playlistsData = await hybridData.getPlaylists();

      // Sort playlists alphabetically
      const sortedPlaylists = playlistsData.sort((a, b) =>
        (a.Name || "").localeCompare(b.Name || "")
      );

      setPlaylists(sortedPlaylists);
      setFilteredPlaylists(sortedPlaylists);
    } catch (error) {
      logger.error("Failed to load playlists", error);
    } finally {
      setLoading(false);
    }
  }, [isLoggedIn, navigate]);

  const schedulePlaylistsReload = useCallback(() => {
    if (refreshTimeout.current !== null) return;
    refreshTimeout.current = window.setTimeout(() => {
      refreshTimeout.current = null;
      void loadPlaylists();
    }, 150);
  }, [loadPlaylists]);

  useEffect(() => {
    schedulePlaylistsReload();

    const handleRefresh = (_event?: Event) => {
      schedulePlaylistsReload();
    };

    window.addEventListener("syncUpdate", handleRefresh);
    window.addEventListener("playlistItemsUpdated", handleRefresh);
    window.addEventListener("playlistItemRemoved", handleRefresh);

    return () => {
      if (refreshTimeout.current !== null) {
        window.clearTimeout(refreshTimeout.current);
        refreshTimeout.current = null;
      }
      window.removeEventListener("syncUpdate", handleRefresh);
      window.removeEventListener("playlistItemsUpdated", handleRefresh);
      window.removeEventListener("playlistItemRemoved", handleRefresh);
    };
  }, [schedulePlaylistsReload]);

  // Initialize from URL and sync search input
  useEffect(() => {
    const q = searchParams.get("q") || "";
    setSearchQuery(q);
  }, [searchParams]);

  useEffect(() => {
    // Filter playlists based on search query
    const filtered = playlists.filter((playlist) =>
      playlist.Name?.toLowerCase().includes(searchQuery.toLowerCase())
    );
    setFilteredPlaylists(filtered);
    // Reset to first page when search changes
    setCurrentPage(1);
  }, [searchQuery, playlists]);

  // Calculate pagination
  const totalPages = Math.ceil(filteredPlaylists.length / PLAYLISTS_PER_PAGE);
  const startIndex = (currentPage - 1) * PLAYLISTS_PER_PAGE;
  const endIndex = startIndex + PLAYLISTS_PER_PAGE;
  const currentPlaylists = filteredPlaylists.slice(startIndex, endIndex);

  // Generate page numbers for pagination
  const getPageNumbers = useMemo(() => {
    const delta = 2; // Number of pages to show on each side of current page
    const range = [];
    const rangeWithDots = [];

    for (
      let i = Math.max(2, currentPage - delta);
      i <= Math.min(totalPages - 1, currentPage + delta);
      i++
    ) {
      range.push(i);
    }

    if (currentPage - delta > 2) {
      rangeWithDots.push(1, "...");
    } else {
      rangeWithDots.push(1);
    }

    rangeWithDots.push(...range);

    if (currentPage + delta < totalPages - 1) {
      rangeWithDots.push("...", totalPages);
    } else {
      if (totalPages > 1) {
        rangeWithDots.push(totalPages);
      }
    }

    return rangeWithDots.filter((page, index, arr) => {
      // Remove duplicates
      return arr.indexOf(page) === index;
    });
  }, [currentPage, totalPages]);

  const handlePlaylistCreation = async (name: string) => {
    try {
      await createPlaylist(name);
      // Reload playlists to show the new one
      await loadPlaylists();
    } catch (error) {
      logger.error("Failed to create playlist:", error);
      // You could add toast notification here for better UX
      throw error; // Re-throw to let dialog handle the error state
    }
  };

  const handlePageChange = (page: number) => {
    setCurrentPage(page);
    // Scroll to top when changing pages
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // New Playlist Card Component
  const NewPlaylistCard = () => (
    <div
      className="group cursor-pointer w-48"
      onClick={() => setShowCreateDialog(true)}
    >
      <Card className="aspect-square hover:shadow-lg transition-shadow">
        <CardContent className="p-0 h-full">
          <div className="aspect-square bg-gradient-to-br from-primary/20 to-primary/30 flex items-center justify-center">
            <Plus className="w-12 h-12 text-primary group-hover:scale-110 transition-transform" />
          </div>
        </CardContent>
      </Card>
      <div className="mt-2 text-center">
        <p className="text-sm font-medium text-foreground group-hover:text-primary">
          New Playlist
        </p>
        <p className="text-xs text-muted-foreground">Create a new playlist</p>
      </div>
    </div>
  );

  // Favourites Playlist Card Component
  const FavouritesPlaylistCard = () => (
    <div
      className="group cursor-pointer w-48"
      onClick={() => navigate("/playlist/favourites")}
    >
      <Card className="aspect-square hover:shadow-lg transition-shadow">
        <CardContent className="p-0 h-full">
          <div className="aspect-square bg-gradient-to-br from-primary/20 to-primary/30 flex items-center justify-center">
            <Heart className="w-12 h-12 text-primary fill-primary group-hover:scale-110 transition-transform" />
          </div>
        </CardContent>
      </Card>
      <div className="mt-2 text-center">
        <p className="text-sm font-medium text-foreground group-hover:text-primary">
          Favourites
        </p>
        <p className="text-xs text-muted-foreground">Your favourite tracks</p>
      </div>
    </div>
  );

  // Downloaded Songs pseudo playlist card
  const DownloadedSongsCard = () => (
    <div
      className="group cursor-pointer w-48"
      onClick={() => navigate("/downloads/songs")}
    >
      <Card className="aspect-square hover:shadow-lg transition-shadow">
        <CardContent className="p-0 h-full">
          <div className="aspect-square bg-gradient-to-br from-primary/20 to-primary/30 flex items-center justify-center">
            <Download className="w-12 h-12 text-primary group-hover:scale-110 transition-transform" />
          </div>
        </CardContent>
      </Card>
      <div className="mt-2 text-center">
        <p className="text-sm font-medium text-foreground group-hover:text-primary">
          Downloaded Songs
        </p>
        <p className="text-xs text-muted-foreground">Tracks saved offline</p>
      </div>
    </div>
  );

  if (loading) {
    return (
      <div className="min-h-screen bg-background">
        <Sidebar activeSection="playlists" />
        <div className="ml-64 p-6">
          <div className="max-w-none mx-auto">
            <LoadingSkeleton type="playlists" />
          </div>
        </div>
        <MusicPlayer />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Sidebar activeSection="playlists" />
      <div className="ml-64 p-6 pb-28">
        <div className="max-w-none mx-auto">
          {/* Header */}
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-foreground mb-4">
              Playlists
            </h1>
            <p className="text-muted-foreground mb-6">
              {filteredPlaylists.length}{" "}
              {filteredPlaylists.length === 1 ? "playlist" : "playlists"}
              {filteredPlaylists.length > PLAYLISTS_PER_PAGE && (
                <>
                  {" • "}
                  Showing {startIndex + 1}-
                  {Math.min(endIndex, filteredPlaylists.length)} of{" "}
                  {filteredPlaylists.length}
                </>
              )}
            </p>

            {/* Search */}
            <div className="relative max-w-md">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
              <Input
                placeholder="Search playlists..."
                value={searchQuery}
                onChange={(e) => {
                  const val = e.target.value;
                  setSearchQuery(val);
                  const params = new URLSearchParams(searchParams);
                  if (val) params.set("q", val);
                  else params.delete("q");
                  setSearchParams(params, { replace: false });
                }}
                className="pl-10 bg-background border-border"
              />
            </div>
          </div>

          {/* Playlists Grid */}
          {filteredPlaylists.length > 0 || !searchQuery ? (
            <>
              <div className="flex flex-wrap justify-start gap-6 mb-8">
                {/* Always show special cards first if not searching */}
                {!searchQuery && (
                  <>
                    <NewPlaylistCard />
                    <FavouritesPlaylistCard />
                    <DownloadedSongsCard />
                  </>
                )}

                {/* Show current page playlists */}
                {currentPlaylists.map((playlist) => (
                  <PlaylistCard
                    key={playlist.Id}
                    item={playlist}
                    authData={authData}
                  />
                ))}
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-center space-x-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handlePageChange(currentPage - 1)}
                    disabled={currentPage === 1}
                    className="h-9 px-3"
                  >
                    <ChevronLeft className="w-4 h-4 mr-1" />
                    Previous
                  </Button>

                  <div className="flex items-center space-x-1">
                    {getPageNumbers.map((page, index) => (
                      <React.Fragment key={index}>
                        {page === "..." ? (
                          <span className="px-3 py-2 text-muted-foreground">
                            ...
                          </span>
                        ) : (
                          <Button
                            variant={
                              currentPage === page ? "default" : "outline"
                            }
                            size="sm"
                            onClick={() => handlePageChange(page as number)}
                            className="h-9 w-9"
                          >
                            {page}
                          </Button>
                        )}
                      </React.Fragment>
                    ))}
                  </div>

                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handlePageChange(currentPage + 1)}
                    disabled={currentPage === totalPages}
                    className="h-9 px-3"
                  >
                    Next
                    <ChevronRight className="w-4 h-4 ml-1" />
                  </Button>
                </div>
              )}
            </>
          ) : searchQuery ? (
            <div className="flex items-center justify-center h-64">
              <div className="text-center">
                <ListMusic className="w-16 h-16 text-muted-foreground mx-auto mb-4" />
                <h2 className="text-xl font-semibold text-foreground mb-2">
                  No playlists found
                </h2>
                <p className="text-muted-foreground">
                  Try adjusting your search to find more playlists.
                </p>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center h-64">
              <div className="text-center">
                <Music className="w-16 h-16 text-muted-foreground mx-auto mb-4" />
                <h2 className="text-xl font-semibold text-foreground mb-2">
                  No playlists available
                </h2>
                <p className="text-muted-foreground">
                  No playlists were found in your music library.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
      <MusicPlayer />

      {/* Create Playlist Dialog */}
      <CreatePlaylistDialog
        open={showCreateDialog}
        onOpenChange={setShowCreateDialog}
        onCreatePlaylist={handlePlaylistCreation}
      />
    </div>
  );
};

export default Playlists;
