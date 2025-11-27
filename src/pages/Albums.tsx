import React, { useState, useEffect, useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import Sidebar from "@/components/Sidebar";
import MusicPlayer from "@/components/MusicPlayer";
import LoadingSkeleton from "@/components/LoadingSkeleton";
import AlbumCard from "@/components/AlbumCard";
import { useAuthData } from "@/hooks/useAuthData";
import { Search, Music, Disc, ChevronLeft, ChevronRight } from "lucide-react";
import { hybridData } from "@/lib/sync";
import { BaseItemDto } from "@jellyfin/sdk/lib/generated-client/models";

interface Album extends BaseItemDto {
  AlbumArtist?: string;
  ProductionYear?: number;
}

const ALBUMS_PER_PAGE = 100; // Show 100 albums per page for better performance

const Albums = () => {
  const navigate = useNavigate();
  const { authData, isAuthenticated } = useAuthData();
  const [searchParams, setSearchParams] = useSearchParams();

  const [albums, setAlbums] = useState<Album[]>([]);
  const [filteredAlbums, setFilteredAlbums] = useState<Album[]>([]);
  const [loading, setLoading] = useState(false); // Start with false - show page immediately
  const [dataLoaded, setDataLoaded] = useState(false); // Track if we've attempted to load data
  const [searchQuery, setSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);

  useEffect(() => {
    loadAlbums();
  }, []);

  // Initialize search query from URL and keep in sync when it changes (back/forward)
  useEffect(() => {
    const q = searchParams.get("q") || "";
    setSearchQuery(q);
  }, [searchParams]);

  useEffect(() => {
    // Filter albums based on search query (album name, album artist, track name)
    const runFilter = async () => {
      if (!searchQuery) {
        setFilteredAlbums(albums);
        setCurrentPage(1);
        return;
      }
      const q = searchQuery.toLowerCase();
      // Basic filter by album + artist first
      let base = albums.filter(
        (album) =>
          album.Name?.toLowerCase().includes(q) ||
          album.AlbumArtist?.toLowerCase().includes(q) ||
          (album.AlbumArtists || [])
            .map((a: any) => a.Name?.toLowerCase())
            .some((n: string) => n && n.includes(q))
      );

      // Track-based filtering: find tracks whose name matches and include their albums
      const trackMatches = await hybridData.searchTracks(q);
      if (trackMatches.length) {
        const trackAlbumIds = new Set(
          trackMatches.map((t) => t.AlbumId).filter(Boolean)
        );
        const albumsFromTracks = albums.filter((a) => trackAlbumIds.has(a.Id));
        // Merge ensuring uniqueness
        const combinedMap = new Map<string, Album>();
        [...base, ...albumsFromTracks].forEach((a: any) => {
          if (a?.Id) combinedMap.set(a.Id, a);
        });
        base = Array.from(combinedMap.values());
      }

      setFilteredAlbums(base);
      setCurrentPage(1);
    };
    runFilter();
  }, [searchQuery, albums]);

  // Calculate pagination
  const totalPages = Math.ceil(filteredAlbums.length / ALBUMS_PER_PAGE);
  const startIndex = (currentPage - 1) * ALBUMS_PER_PAGE;
  const endIndex = startIndex + ALBUMS_PER_PAGE;
  const currentAlbums = filteredAlbums.slice(startIndex, endIndex);

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

  const loadAlbums = async () => {
    // Don't block the UI - load data in background

    try {
      if (!isAuthenticated()) {
        navigate("/login");
        return;
      }

      // Use hybrid data service for better performance
      const albumsData = await hybridData.getAlbums();

      // Set unsorted data first for immediate display
      setAlbums(albumsData);
      setFilteredAlbums(albumsData);

      // Sort in the background without blocking
      setTimeout(() => {
        const sortedAlbums = [...albumsData].sort((a, b) =>
          (a.Name || "").localeCompare(b.Name || "")
        );
        setAlbums(sortedAlbums);
        setFilteredAlbums(sortedAlbums);
      }, 0);
    } catch (error) {
    } finally {
      setDataLoaded(true); // Mark that we've attempted to load data
    }
  };

  const handlePageChange = (page: number) => {
    setCurrentPage(page);
    // Scroll to top when changing pages
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background">
        <Sidebar activeSection="albums" />
        <div className="ml-64 p-6">
          <LoadingSkeleton type="albums" />
        </div>
        <MusicPlayer />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Sidebar activeSection="albums" />
      <div className="ml-64 pb-28">
        <div className="max-w-none mx-auto p-6">
          {/* Header */}
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-foreground mb-4">Albums</h1>
            <p className="text-muted-foreground mb-6">
              {filteredAlbums.length}{" "}
              {filteredAlbums.length === 1 ? "album" : "albums"}
              {filteredAlbums.length > ALBUMS_PER_PAGE && (
                <>
                  {" • "}
                  Showing {startIndex + 1}-
                  {Math.min(endIndex, filteredAlbums.length)} of{" "}
                  {filteredAlbums.length}
                </>
              )}
            </p>

            {/* Search */}
            <div className="relative max-w-md">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
              <Input
                placeholder="Search albums and artists..."
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

          {/* Albums Grid */}
          {currentAlbums.length > 0 ? (
            <>
              <div className="flex flex-wrap justify-start gap-4 mb-8">
                {currentAlbums.map((album) => (
                  <AlbumCard
                    key={album.Id}
                    item={album}
                    authData={authData}
                    appendQuery={
                      searchParams.get("q")
                        ? `q=${encodeURIComponent(searchParams.get("q") || "")}`
                        : undefined
                    }
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
          ) : !dataLoaded ? (
            // Show skeleton while data is still loading
            <div className="flex flex-wrap justify-start gap-4 mb-8">
              {Array.from({ length: 100 }).map((_, i) => (
                <div key={i} className="cursor-pointer group w-48">
                  <div className="overflow-hidden shadow-sm hover:shadow-md transition-shadow w-full">
                    <div className="aspect-square animate-shimmer" />
                  </div>
                  <div className="mt-2 text-center space-y-1">
                    <div className="h-3.5 w-32 mx-auto animate-shimmer rounded" />
                    <div className="h-3 w-12 mx-auto animate-shimmer rounded" />
                  </div>
                </div>
              ))}
            </div>
          ) : searchQuery ? (
            <div className="flex items-center justify-center h-64">
              <div className="text-center">
                <Disc className="w-16 h-16 text-muted-foreground mx-auto mb-4" />
                <h2 className="text-xl font-semibold text-foreground mb-2">
                  No albums found
                </h2>
                <p className="text-muted-foreground">
                  Try adjusting your search to find more albums.
                </p>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center h-64">
              <div className="text-center">
                <Music className="w-16 h-16 text-gray-400 mx-auto mb-4" />
                <h2 className="text-xl font-semibold text-gray-900 mb-2">
                  No albums available
                </h2>
                <p className="text-gray-600">
                  No albums were found in your music library.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
      <MusicPlayer />
    </div>
  );
};

export default Albums;
