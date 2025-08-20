import React, { useState, useEffect, useMemo } from "react";
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
import { getAllPlaylists, createPlaylist } from "@/lib/jellyfin";
import { hybridData } from "@/lib/sync";
import { BaseItemDto } from "@jellyfin/sdk/lib/generated-client/models";

interface Playlist extends BaseItemDto {
  ChildCount?: number;
}

const PLAYLISTS_PER_PAGE = 48; // 6 columns × 8 rows on large screens

const Playlists = () => {
  const navigate = useNavigate();
  const { authData, isAuthenticated } = useAuthData();
  const [searchParams, setSearchParams] = useSearchParams();

  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [filteredPlaylists, setFilteredPlaylists] = useState<Playlist[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [showCreateDialog, setShowCreateDialog] = useState(false);

  useEffect(() => {
    loadPlaylists();

    // Refresh when a syncUpdate event fires (e.g., after delete)
    const onSyncUpdate = () => loadPlaylists();
    window.addEventListener("syncUpdate", onSyncUpdate);
    return () => window.removeEventListener("syncUpdate", onSyncUpdate);
  }, []);

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

  const loadPlaylists = async () => {
    setLoading(true);
    try {
      if (!isAuthenticated()) {
        navigate("/login");
        return;
      }

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
  };

  const handleCreateNewPlaylist = () => {
    setShowCreateDialog(true);
  };

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
          <div className="aspect-square bg-gradient-to-br from-pink-200 to-rose-200 flex items-center justify-center">
            <Plus className="w-12 h-12 text-pink-600 group-hover:scale-110 transition-transform" />
          </div>
        </CardContent>
      </Card>
      <div className="mt-2 text-center">
        <p className="text-sm font-medium text-gray-900 group-hover:text-pink-600">
          New Playlist
        </p>
        <p className="text-xs text-gray-500">Create a new playlist</p>
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
          <div className="aspect-square bg-gradient-to-br from-pink-200 to-rose-200 flex items-center justify-center">
            <Heart className="w-12 h-12 text-pink-600 fill-pink-600 group-hover:scale-110 transition-transform" />
          </div>
        </CardContent>
      </Card>
      <div className="mt-2 text-center">
        <p className="text-sm font-medium text-gray-900 group-hover:text-pink-600">
          Favourites
        </p>
        <p className="text-xs text-gray-500">Your favourite tracks</p>
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
          <div className="aspect-square bg-gradient-to-br from-pink-200 to-rose-200 flex items-center justify-center">
            <Download className="w-12 h-12 text-pink-600 group-hover:scale-110 transition-transform" />
          </div>
        </CardContent>
      </Card>
      <div className="mt-2 text-center">
        <p className="text-sm font-medium text-gray-900 group-hover:text-pink-600">
          Downloaded Songs
        </p>
        <p className="text-xs text-gray-500">Tracks saved offline</p>
      </div>
    </div>
  );

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
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
    <div className="min-h-screen bg-gray-50">
      <Sidebar activeSection="playlists" />
      <div className="ml-64 p-6 pb-28">
        <div className="max-w-none mx-auto">
          {/* Header */}
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-gray-900 mb-4">Playlists</h1>
            <p className="text-gray-600 mb-6">
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
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
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
                className="pl-10 bg-white border-gray-200"
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
                          <span className="px-3 py-2 text-gray-500">...</span>
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
                <ListMusic className="w-16 h-16 text-gray-400 mx-auto mb-4" />
                <h2 className="text-xl font-semibold text-gray-900 mb-2">
                  No playlists found
                </h2>
                <p className="text-gray-600">
                  Try adjusting your search to find more playlists.
                </p>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center h-64">
              <div className="text-center">
                <Music className="w-16 h-16 text-gray-400 mx-auto mb-4" />
                <h2 className="text-xl font-semibold text-gray-900 mb-2">
                  No playlists available
                </h2>
                <p className="text-gray-600">
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
