import React from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { ListMusic } from "lucide-react";
import BlurHashImage from "@/components/BlurHashImage";

interface PlaylistCardProps {
  item: {
    Id?: string;
    Name?: string;
    ChildCount?: number;
    ImageTags?: { Primary?: string };
    ImageBlurHashes?: {
      Primary?: { [key: string]: string };
    };
  };
  authData: {
    serverAddress?: string;
  };
  // Optional query string to append when navigating (e.g., "q=term")
  appendQuery?: string;
}

const PlaylistCard: React.FC<PlaylistCardProps> = ({
  item,
  authData,
  appendQuery,
}) => {
  const navigate = useNavigate();

  const getPlaylistArt = (size: number = 400) => {
    if (item.ImageTags?.Primary && authData.serverAddress && item.Id) {
      return `${authData.serverAddress}/Items/${item.Id}/Images/Primary?maxWidth=${size}&quality=90`;
    }
    return null;
  };

  const getPlaylistBlurHash = () => {
    const primaryImageTag = item.ImageTags?.Primary;
    if (!primaryImageTag || !item.ImageBlurHashes?.Primary) {
      return undefined;
    }
    return item.ImageBlurHashes.Primary[primaryImageTag];
  };

  const handleCardClick = () => {
    if (item.Id) {
      const suffix = appendQuery ? `?${appendQuery}` : "";
      navigate(`/playlist/${item.Id}${suffix}`);
    }
  };

  return (
    <div className="cursor-pointer group w-48" onClick={handleCardClick}>
      <Card className="overflow-hidden shadow-sm hover:shadow-md transition-shadow w-full">
        <CardContent className="p-0">
          <div className="aspect-square bg-muted">
            {getPlaylistArt() ? (
              <BlurHashImage
                src={getPlaylistArt()!}
                blurHash={getPlaylistBlurHash()}
                alt={item.Name || "Playlist"}
                className="w-full h-full"
                width={400}
                height={400}
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-primary/20 to-primary/30">
                <ListMusic className="w-8 h-8 text-primary/60" />
              </div>
            )}
          </div>
        </CardContent>
      </Card>
      <div className="mt-2 text-center">
        <p className="text-sm font-medium text-card-foreground truncate group-hover:text-primary">
          {item.Name}
        </p>
        {item.ChildCount !== undefined && (
          <p className="text-xs text-muted-foreground">
            {item.ChildCount} {item.ChildCount === 1 ? "track" : "tracks"}
          </p>
        )}
      </div>
    </div>
  );
};

export default PlaylistCard;
