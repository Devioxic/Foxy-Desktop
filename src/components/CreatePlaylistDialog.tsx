import React, { useState } from "react";
import { logger } from "@/lib/logger";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ListMusic } from "lucide-react";

interface CreatePlaylistDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreatePlaylist: (name: string) => void;
}

const CreatePlaylistDialog: React.FC<CreatePlaylistDialogProps> = ({
  open,
  onOpenChange,
  onCreatePlaylist,
}) => {
  const [playlistName, setPlaylistName] = useState("");
  const [isCreating, setIsCreating] = useState(false);

  const handleCreate = async () => {
    if (!playlistName.trim()) return;

    setIsCreating(true);
    try {
      await onCreatePlaylist(playlistName.trim());
      // Reset form and close dialog
      setPlaylistName("");
      onOpenChange(false);
    } catch (error) {
      logger.error("Failed to create playlist:", error);
    } finally {
      setIsCreating(false);
    }
  };

  const handleCancel = () => {
    setPlaylistName("");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ListMusic className="w-5 h-5 text-pink-600" />
            Create New Playlist
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="playlist-name">Playlist Name</Label>
            <Input
              id="playlist-name"
              placeholder="Enter playlist name..."
              value={playlistName}
              onChange={(e) => setPlaylistName(e.target.value)}
              className="w-full"
              autoFocus
            />
          </div>
        </div>

        <DialogFooter className="flex gap-2">
          <Button
            variant="outline"
            onClick={handleCancel}
            disabled={isCreating}
          >
            Cancel
          </Button>
          <Button
            onClick={handleCreate}
            disabled={!playlistName.trim() || isCreating}
            className="bg-pink-600 hover:bg-pink-700"
          >
            {isCreating ? "Creating..." : "Create Playlist"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default CreatePlaylistDialog;
