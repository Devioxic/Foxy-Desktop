import React from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Music } from "lucide-react";
import BlurHashImage from "@/components/BlurHashImage";
import { resolvePrimaryImageUrl } from "@/utils/media";

interface AlbumCardProps {
  item: {
    Id?: string;
    Name?: string;
    AlbumId?: string;
    ProductionYear?: number;
    ImageTags?: { Primary?: string };
    ImageBlurHashes?: {
      Primary?: { [key: string]: string };
    };
    // New optional artist fields
    AlbumArtist?: string;
    AlbumArtists?: Array<{ Name?: string }>;
  };
  authData: {
    serverAddress?: string;
    accessToken?: string;
  };
  appendQuery?: string;
  showYear?: boolean; // new prop
}

const AlbumCard: React.FC<AlbumCardProps> = ({
  item,
  authData,
  appendQuery,
  showYear,
}) => {
  const navigate = useNavigate();

  const getAlbumArt = (size: number = 400) => {
    const sourceId = item.AlbumId || item.Id;
    return resolvePrimaryImageUrl({
      item: item as any,
      serverAddress: authData.serverAddress,
      accessToken: authData.accessToken || undefined,
      size,
      fallbackId: sourceId,
    });
  };

  const getAlbumBlurHash = () => {
    const primaryImageTag = item.ImageTags?.Primary;
    if (!primaryImageTag || !item.ImageBlurHashes?.Primary) return undefined;
    return item.ImageBlurHashes.Primary[primaryImageTag];
  };

  const handleCardClick = () => {
    const albumId = item.AlbumId || item.Id;
    if (albumId) {
      const suffix = appendQuery ? `?${appendQuery}` : "";
      navigate(`/album/${albumId}${suffix}`);
    }
  };

  // Prefer explicit AlbumArtist, fall back to joined AlbumArtists list
  const artistText =
    item.AlbumArtist ||
    (item.AlbumArtists && item.AlbumArtists.length
      ? item.AlbumArtists.map((a) => a?.Name)
          .filter(Boolean)
          .join(", ")
      : "");

  const subtitle = showYear
    ? item.ProductionYear
      ? item.ProductionYear.toString()
      : ""
    : artistText;

  const albumArt = getAlbumArt();

  return (
    <div className="cursor-pointer group w-48" onClick={handleCardClick}>
      <Card className="overflow-hidden shadow-sm hover:shadow-md transition-shadow w-full">
        <CardContent className="p-0">
          <div className="aspect-square bg-muted">
            {albumArt ? (
              <BlurHashImage
                src={albumArt}
                blurHash={getAlbumBlurHash()}
                alt={item.Name || "Album"}
                className="w-full h-full"
                width={400}
                height={400}
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-primary/20 to-primary/30">
                <Music className="w-8 h-8 text-primary/60" />
              </div>
            )}
          </div>
        </CardContent>
      </Card>
      <div className="mt-2 text-center">
        <p className="text-sm font-medium text-foreground truncate group-hover:text-primary">
          {item.Name}
        </p>
        {subtitle ? (
          <p className="text-xs text-muted-foreground truncate">{subtitle}</p>
        ) : null}
      </div>
    </div>
  );
};

export default AlbumCard;
