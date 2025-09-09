
import RPC from "discord-rpc";
import log from "electron-log";


export type TrackPresence = {
  title: string;
  artist?: string;
  album?: string;
  durationMs?: number;   // total duration
  positionMs?: number;   // current position
  isPaused?: boolean;
  publicUrl?: string;    // optional: Jellyfin/track page
};

let rpc: RPC.Client | null = null;
let loggedIn = false;

const CLIENT_ID = process.env.DISCORD_CLIENT_ID || "1414699738355335389";

export async function rpcInit() {
  if (rpc) return;
  rpc = new RPC.Client({ transport: "ipc" });

  rpc.on("ready", () => {
    loggedIn = true;
    log.info("[RPC] Ready");
  });

  try {
    await rpc.login({ clientId: CLIENT_ID });
    log.info("[RPC] Logged in");
  } catch (e) {
    log.error("[RPC] Login failed", e);
  }
}

export async function rpcUpdate(track: TrackPresence) {
  if (!rpc || !loggedIn) return;

  const details = "Listening to:"; // keep your custom top line

  // When paused, replace artist/title with "(Paused)"
  const playingState = [track.artist, track.title ?? track.title].filter(Boolean).join(" — ");
  const state = track.isPaused ? "(Paused)" : playingState;

  const activity: RPC.Presence = {
    details,
    state,
    largeImageKey: "foxy_logo",
    largeImageText: track.album || "",

    smallImageKey: track.isPaused ? "pause" : "play",
    smallImageText: track.isPaused ? "Paused" : "Playing",
    instance: false,
    buttons: track.publicUrl ? [{ label: "Open in Jellyfin", url: track.publicUrl }] : undefined,
  };

  try {
    await rpc.setActivity(activity);
  } catch (e) {
  }
}
export async function rpcClear() {
  if (!rpc || !loggedIn) return;
  try { await rpc.clearActivity(); } catch {}
}

export async function rpcShutdown() {
  try { await rpcClear(); rpc?.destroy(); } catch {}
  rpc = null;
  loggedIn = false;
}