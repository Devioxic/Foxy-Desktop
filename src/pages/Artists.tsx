import React, { useState, useEffect } from "react";
import { logger } from "@/lib/logger";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import Sidebar from "@/components/Sidebar";
import MusicPlayer from "@/components/MusicPlayer";
import LoadingSkeleton from "@/components/LoadingSkeleton";
import { useAuthData } from "@/hooks/useAuthData";
import { getImageUrl } from "@/utils/media";
import { Search, User, Users, ChevronLeft, ChevronRight } from "lucide-react";
import { getAllArtists } from "@/lib/jellyfin";
import { hybridData } from "@/lib/sync";
import { BaseItemDto } from "@jellyfin/sdk/lib/generated-client/models";
import BlurHashImage from "@/components/BlurHashImage";

interface Artist extends BaseItemDto {
  SongCount?: number;
  AlbumCount?: number;
}

const ARTISTS_PER_PAGE = 100; // Match albums page style

const Artists = () => {
  const navigate = useNavigate();
  const { authData, isAuthenticated } = useAuthData();
  const [searchParams, setSearchParams] = useSearchParams();

  const [artists, setArtists] = useState<Artist[]>([]);
  const [filteredArtists, setFilteredArtists] = useState<Artist[]>([]);
  const [dataLoaded, setDataLoaded] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [page, setPage] = useState(1); // renamed from previous pagination approach

  // Initialize from URL and sync back on param change
  useEffect(() => {
    const q = searchParams.get("q") || "";
    setSearchQuery(q);
  }, [searchParams]);

  // Generate a consistent color gradient based on artist name
  const getArtistGradient = (artistName?: string) => {
    if (!artistName) return "from-pink-200 to-rose-300";

    const gradients = [
      "from-pink-200 to-rose-300",
      "from-rose-200 to-pink-300",
      "from-pink-100 to-rose-200",
      "from-rose-100 to-pink-200",
      "from-pink-300 to-rose-400",
      "from-rose-300 to-pink-400",
      "from-pink-200 to-rose-400",
      "from-rose-200 to-pink-400",
    ];

    // Use character codes to get consistent gradient for same artist name
    const hash = artistName
      .split("")
      .reduce((acc, char) => acc + char.charCodeAt(0), 0);
    return gradients[hash % gradients.length];
  };

  useEffect(() => {
    loadArtists();
  }, []); // initial load only

  useEffect(() => {
    // Filter artists based on search query
    const filtered = artists.filter((artist) =>
      artist.Name?.toLowerCase().includes(searchQuery.toLowerCase())
    );
    setFilteredArtists(filtered);
    setPage(1); // reset to first page on search
  }, [searchQuery, artists]);

  const loadArtists = async () => {
    try {
      if (!isAuthenticated()) {
        navigate("/login");
        return;
      }

      console.time("ArtistsPage.loadArtists.total");
      // Fetch all artists with albums (local DB provides counts, then client paginates like Albums page)
      const artistsData = await hybridData.getArtists(
        undefined,
        undefined,
        false,
        true
      );
      logger.info(
        `ArtistsPage: received ${artistsData.length} artists with albums (unpaginated)`
      );

      setArtists(artistsData as Artist[]);
      setFilteredArtists(artistsData as Artist[]);
      console.timeEnd("ArtistsPage.loadArtists.total");
    } catch (error) {
      logger.error("Failed to load artists", error);
    } finally {
      setDataLoaded(true);
    }
  };

  const getArtistImage = (artist: Artist, size: number = 150) => {
    return getImageUrl(artist, authData.serverAddress!, size);
  };

  const getArtistBlurHash = (artist: Artist) => {
    // Get the primary image blur hash
    const primaryImageTag = artist.ImageTags?.Primary;
    if (!primaryImageTag || !artist.ImageBlurHashes?.Primary) {
      return undefined;
    }
    return artist.ImageBlurHashes.Primary[primaryImageTag];
  };

  const handleArtistClick = (artist: Artist) => {
    if (artist.Id) {
      navigate(`/artist/${artist.Id}`);
    }
  };

  // Pagination calculations (mirror Albums page pattern)
  const totalPages = Math.ceil(filteredArtists.length / ARTISTS_PER_PAGE) || 1;
  const startIndex = (page - 1) * ARTISTS_PER_PAGE;
  const endIndex = startIndex + ARTISTS_PER_PAGE;
  const currentArtists = filteredArtists.slice(startIndex, endIndex);

  const getPageNumbers = React.useMemo(() => {
    const delta = 2;
    const range: (number | string)[] = [];
    const rangeWithDots: (number | string)[] = [];

    for (
      let i = Math.max(2, page - delta);
      i <= Math.min(totalPages - 1, page + delta);
      i++
    ) {
      range.push(i);
    }

    if (page - delta > 2) {
      rangeWithDots.push(1, "...");
    } else {
      rangeWithDots.push(1);
    }

    rangeWithDots.push(...range);

    if (page + delta < totalPages - 1) {
      rangeWithDots.push("...", totalPages);
    } else {
      if (totalPages > 1) rangeWithDots.push(totalPages);
    }

    return rangeWithDots.filter((p, idx, arr) => arr.indexOf(p) === idx);
  }, [page, totalPages]);

  const handlePageChange = (newPage: number) => {
    setPage(newPage);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <Sidebar activeSection="artists" />
      <div className="ml-64 pb-28">
        <div className="max-w-none mx-auto p-6">
          {!dataLoaded ? (
            // Show only skeleton (which includes placeholder search) before data loads
            <LoadingSkeleton type="artists" />
          ) : (
            <>
              {/* Header */}
              <div className="mb-8">
                <h1 className="text-3xl font-bold text-gray-900 mb-4">
                  Artists
                </h1>
                <p className="text-gray-600 mb-6">
                  {filteredArtists.length}{" "}
                  {filteredArtists.length === 1 ? "artist" : "artists"}
                  {filteredArtists.length > ARTISTS_PER_PAGE && (
                    <>
                      {" "}
                      • Showing {startIndex + 1}-
                      {Math.min(endIndex, filteredArtists.length)} of{" "}
                      {filteredArtists.length}
                    </>
                  )}
                </p>

                {/* Search */}
                <div className="relative max-w-md">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                  <Input
                    placeholder="Search artists..."
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

              {/* Artists Grid */}
              {filteredArtists.length > 0 && (
                <>
                  <div className="grid grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 2xl:grid-cols-8 gap-4 mb-8">
                    {currentArtists.map((artist) => (
                      <div
                        key={artist.Id}
                        className="group cursor-pointer transition-all duration-200"
                        onClick={() => handleArtistClick(artist)}
                      >
                        <div className="aspect-square mb-3 rounded-full overflow-hidden bg-gradient-to-br from-pink-100 to-rose-200 shadow-sm hover:shadow-md transition-shadow">
                          {getArtistImage(artist) ? (
                            <BlurHashImage
                              src={getArtistImage(artist)!}
                              blurHash={getArtistBlurHash(artist)}
                              alt={artist.Name || "Artist"}
                              className="w-full h-full group-hover:scale-105 transition-transform duration-200"
                              width={150}
                              height={150}
                            />
                          ) : (
                            <div
                              className={`w-full h-full flex items-center justify-center bg-gradient-to-br ${getArtistGradient(
                                artist.Name
                              )}`}
                            >
                              <User className="w-8 h-8 text-pink-600" />
                            </div>
                          )}
                        </div>
                        <div className="text-center">
                          <h3 className="text-sm font-medium text-gray-900 truncate mb-1 group-hover:text-pink-600 transition-colors">
                            {artist.Name}
                          </h3>
                          <p className="text-xs text-gray-500">
                            {(() => {
                              const albums =
                                artist.AlbumCount ||
                                (artist as any).ChildCount ||
                                0;
                              if (albums > 0) {
                                return `${albums} album${
                                  albums === 1 ? "" : "s"
                                }`;
                              }
                              return "Artist";
                            })()}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>

                  {totalPages > 1 && (
                    <div className="flex items-center justify-center space-x-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handlePageChange(page - 1)}
                        disabled={page === 1}
                        className="h-9 px-3"
                      >
                        <ChevronLeft className="w-4 h-4 mr-1" />
                        Previous
                      </Button>
                      <div className="flex items-center space-x-1">
                        {getPageNumbers.map((p, idx) => (
                          <React.Fragment key={idx}>
                            {p === "..." ? (
                              <span className="px-3 py-2 text-gray-500">
                                ...
                              </span>
                            ) : (
                              <Button
                                variant={page === p ? "default" : "outline"}
                                size="sm"
                                onClick={() => handlePageChange(p as number)}
                                className="h-9 w-9"
                              >
                                {p}
                              </Button>
                            )}
                          </React.Fragment>
                        ))}
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handlePageChange(page + 1)}
                        disabled={page === totalPages}
                        className="h-9 px-3"
                      >
                        Next
                        <ChevronRight className="w-4 h-4 ml-1" />
                      </Button>
                    </div>
                  )}
                </>
              )}

              {/* Empty Search Result */}
              {searchQuery && filteredArtists.length === 0 && (
                <div className="flex items-center justify-center h-64">
                  <div className="text-center">
                    <Users className="w-16 h-16 text-pink-400 mx-auto mb-4" />
                    <h2 className="text-xl font-semibold text-gray-900 mb-2">
                      No artists found
                    </h2>
                    <p className="text-gray-600">
                      Try adjusting your search to find more artists.
                    </p>
                  </div>
                </div>
              )}

              {/* Empty Library */}
              {!searchQuery && filteredArtists.length === 0 && (
                <div className="flex items-center justify-center h-64">
                  <div className="text-center">
                    <Users className="w-16 h-16 text-pink-400 mx-auto mb-4" />
                    <h2 className="text-xl font-semibold text-gray-900 mb-2">
                      No artists available
                    </h2>
                    <p className="text-gray-600">
                      Only artists with albums are shown. None were found.
                    </p>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
      <MusicPlayer />
    </div>
  );
};

export default Artists;
