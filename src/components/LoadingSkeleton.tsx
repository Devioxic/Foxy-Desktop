import React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search, Play, Star } from "lucide-react";

interface LoadingSkeletonProps {
  type:
    | "artist"
    | "artists"
    | "album"
    | "albums"
    | "albumDetail"
    | "dashboard"
    | "playlists"
    | "playlist"
    | "library";
}

// MARK: - Shimmer primitive
const ShimmerDiv: React.FC<{
  className?: string;
  children?: React.ReactNode;
}> = ({ className = "", children }) => (
  <div className={`animate-shimmer ${className}`}>{children}</div>
);

// MARK: - Grid skeletons
const ArtistCardSkeleton: React.FC<{ count?: number }> = ({ count = 24 }) => (
  <div className="grid grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 2xl:grid-cols-8 gap-4">
    {Array.from({ length: count }).map((_, i) => (
      <div key={i} className="group cursor-pointer transition-all duration-200">
        <ShimmerDiv className="aspect-square mb-3 rounded-full overflow-hidden shadow-sm" />
        <div className="text-center">
          <ShimmerDiv className="h-3.5 w-full rounded mb-1" />
          <ShimmerDiv className="h-3 w-16 mx-auto rounded" />
        </div>
      </div>
    ))}
  </div>
);

const AlbumCardSkeleton: React.FC<{ count?: number }> = ({ count = 48 }) => (
  <div className="flex flex-wrap justify-start gap-6">
    {Array.from({ length: count }).map((_, i) => (
      <div key={i} className="cursor-pointer group w-48">
        <div className="overflow-hidden shadow-sm hover:shadow-md transition-shadow w-full">
          <ShimmerDiv className="aspect-square" />
        </div>
        <div className="mt-2 text-center space-y-1">
          <ShimmerDiv className="h-3.5 w-32 mx-auto rounded" />
          <ShimmerDiv className="h-3 w-12 mx-auto rounded" />
        </div>
      </div>
    ))}
  </div>
);

// MARK: - List skeletons
const TrackListSkeleton: React.FC<{
  count?: number;
  showAlbumArt?: boolean;
}> = ({ count = 12, showAlbumArt = false }) => (
  <div className="space-y-1">
    {Array.from({ length: count }).map((_, i) => (
      <div
        key={i}
        className="group flex items-center gap-3 p-2 rounded-lg hover:bg-gray-50/80 transition-colors"
      >
        <div className="w-8 h-8 flex items-center justify-center text-sm">
          <ShimmerDiv className="h-3 w-4 rounded" />
        </div>
        {showAlbumArt && <ShimmerDiv className="w-10 h-10 rounded" />}
        <div className="flex-1 min-w-0 space-y-1">
          <ShimmerDiv className="h-3.5 w-48 rounded" />
          <ShimmerDiv className="h-3 w-32 rounded" />
        </div>
        <ShimmerDiv className="h-3 w-8 rounded" />
      </div>
    ))}
  </div>
);

// MARK: - Dashboard skeletons
const QuickAccessCardSkeleton: React.FC<{ count?: number }> = ({
  count = 6,
}) => (
  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
    {Array.from({ length: count }).map((_, i) => (
      <div
        key={i}
        className="group cursor-pointer hover:shadow-md transition-shadow overflow-hidden rounded-lg border bg-white"
      >
        <div className="flex items-center h-20">
          <ShimmerDiv className="w-20 h-20 flex-shrink-0" />
          <div className="flex-1 p-4 space-y-2">
            <ShimmerDiv className="h-3.5 w-24 rounded" />
            <ShimmerDiv className="h-3 w-16 rounded" />
          </div>
        </div>
      </div>
    ))}
  </div>
);

// MARK: - Page skeleton router
const LoadingSkeleton: React.FC<LoadingSkeletonProps> = ({ type }) => {
  if (type === "artists") {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between mb-6">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
            <Input
              placeholder="Search artists..."
              className="pl-10 bg-white border-gray-200 shadow-sm disabled:opacity-50"
              disabled
            />
          </div>
          <div className="flex items-center space-x-2 text-sm text-gray-600">
            <ShimmerDiv className="h-4 w-16 rounded" />
          </div>
        </div>
        <ArtistCardSkeleton count={24} />
      </div>
    );
  }

  if (type === "albums") {
    return (
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between mb-6">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
            <Input
              placeholder="Search albums..."
              className="pl-10 bg-white border-gray-200 shadow-sm disabled:opacity-50"
              disabled
            />
          </div>
          <div className="flex items-center space-x-2">
            <Button variant="outline" disabled className="text-sm">
              Sort
            </Button>
            <Button variant="outline" disabled className="text-sm">
              Filter
            </Button>
          </div>
        </div>
        <AlbumCardSkeleton count={48} />
        <div className="flex justify-center items-center space-x-2 mt-8">
          <Button variant="outline" disabled className="px-3 py-2">
            Previous
          </Button>
          <ShimmerDiv className="h-10 w-10 rounded" />
          <ShimmerDiv className="h-10 w-10 rounded" />
          <ShimmerDiv className="h-10 w-10 rounded" />
          <Button variant="outline" disabled className="px-3 py-2">
            Next
          </Button>
        </div>
      </div>
    );
  }

  if (type === "playlists") {
    return (
      <div className="space-y-6">
        <div className="mb-8">
          <ShimmerDiv className="h-8 w-32 mb-4 rounded" />
          <ShimmerDiv className="h-4 w-48 mb-6 rounded" />
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
            <Input
              placeholder="Search playlists..."
              className="pl-10 bg-white border-gray-200 shadow-sm disabled:opacity-50"
              disabled
            />
          </div>
        </div>
        <AlbumCardSkeleton count={12} />
      </div>
    );
  }

  if (type === "dashboard") {
    return (
      <div className="space-y-8">
        <div className="mb-8">
          <ShimmerDiv className="h-8 w-64 mb-2 rounded" />
          <ShimmerDiv className="h-4 w-48 rounded" />
        </div>
        <div className="space-y-4">
          <h2 className="text-xl font-bold text-gray-900">Recently Played</h2>
          <QuickAccessCardSkeleton count={6} />
        </div>
        <div className="space-y-4">
          <h2 className="text-xl font-bold text-gray-900">Recently Added</h2>
          <AlbumCardSkeleton count={12} />
        </div>
        <div className="space-y-4">
          <h2 className="text-xl font-bold text-gray-900">Your Favorites</h2>
          <AlbumCardSkeleton count={6} />
        </div>
      </div>
    );
  }

  if (type === "artist") {
    return (
      <div className="space-y-8">
        <div className="flex flex-col md:flex-row gap-8">
          <ShimmerDiv className="w-64 h-64 rounded-lg flex-shrink-0" />
          <div className="flex-1 space-y-4">
            <ShimmerDiv className="h-12 w-1/2 rounded" />
            <ShimmerDiv className="h-4 w-3/4 rounded" />
            <ShimmerDiv className="h-4 w-1/2 rounded" />
            <div className="flex space-x-4 mt-6">
              <Button className="bg-pink-600 hover:bg-pink-700" disabled>
                <Play className="w-4 h-4 mr-2" />
                Play
              </Button>
              <Button variant="outline" disabled>
                <Star className="w-4 h-4 mr-2" />
                Follow
              </Button>
            </div>
          </div>
        </div>
        <div className="space-y-4">
          <h2 className="text-xl font-bold text-gray-900">Albums</h2>
          <AlbumCardSkeleton count={8} />
        </div>
        <div className="space-y-4">
          <h2 className="text-xl font-bold text-gray-900">Popular</h2>
          <TrackListSkeleton count={10} />
        </div>
      </div>
    );
  }

  if (type === "albumDetail") {
    return (
      <div className="space-y-8">
        <Button variant="ghost" disabled className="mb-6 text-gray-600">
          ← Back
        </Button>
        <div className="flex flex-col md:flex-row gap-8">
          <ShimmerDiv className="w-64 h-64 rounded-lg flex-shrink-0" />
          <div className="flex-1 space-y-4">
            <ShimmerDiv className="h-8 w-1/2 rounded" />
            <ShimmerDiv className="h-4 w-1/3 rounded" />
            <ShimmerDiv className="h-4 w-1/4 rounded" />
            <Button className="bg-pink-600 hover:bg-pink-700 mt-6" disabled>
              <Play className="w-4 h-4 mr-2" />
              Play Album
            </Button>
          </div>
        </div>
        <div className="space-y-4">
          <h2 className="text-xl font-bold text-gray-900">Tracks</h2>
          <TrackListSkeleton count={12} showAlbumArt={false} />
        </div>
      </div>
    );
  }

  if (type === "playlist") {
    return (
      <div className="space-y-8">
        <Button variant="ghost" disabled className="mb-6 text-gray-600">
          ← Back
        </Button>
        <div className="flex flex-col md:flex-row gap-8">
          <ShimmerDiv className="w-64 h-64 rounded-lg flex-shrink-0" />
          <div className="flex-1 space-y-4">
            <ShimmerDiv className="h-8 w-1/2 rounded" />
            <ShimmerDiv className="h-4 w-1/4 rounded" />
            <Button className="bg-pink-600 hover:bg-pink-700 mt-6" disabled>
              <Play className="w-4 h-4 mr-2" />
              Play Playlist
            </Button>
          </div>
        </div>
        <TrackListSkeleton count={15} showAlbumArt={true} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <ShimmerDiv className="h-10 w-80 rounded" />
      <AlbumCardSkeleton count={12} />
    </div>
  );
};
export default LoadingSkeleton;
