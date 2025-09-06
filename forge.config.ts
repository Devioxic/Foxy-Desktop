import type { ForgeConfig } from "@electron-forge/shared-types";
import { MakerSquirrel } from "@electron-forge/maker-squirrel";
import { MakerDMG } from "@electron-forge/maker-dmg";
import { VitePlugin } from "@electron-forge/plugin-vite";
import { FusesPlugin } from "@electron-forge/plugin-fuses";
import { FuseV1Options, FuseVersion } from "@electron/fuses";

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    icon: "public/icon",
    osxSign: {
      optionsForFile: (filepath) => {
        return {
          entitlements: "public/entitlements.plist",
        };
      },
      identity: process.env.IDENTITY,
    },
    osxNotarize: {
      keychainProfile: "Foxy",
    },
    executableName: "foxy",
    appBundleId: "com.tillycloud.foxydesktop",
  },
  rebuildConfig: {},
  makers: [
    new MakerSquirrel({
      iconUrl:
        "https://raw.githubusercontent.com/Devioxic/Foxy-Desktop/refs/heads/master/public/icon%400.5x.ico",
      setupIcon: "public/icon.ico",
    }),
    new MakerDMG({
      icon: "public/icon.icns",
    }),
    //new MakerFlatpak({
    //  options: {
    //    files: [],
    //    icon: "public/icon@0.5x.png",
    //    id: "com.tillycloud.foxydesktop",
    //    productName: "Foxy",
    //    genericName: "Jellyfin Music Player",
    //    description: "A modern desktop music player for Jellyfin",
    //  },
    //}),
  ],
  plugins: [
    new VitePlugin({
      // `build` can specify multiple entry builds, which can be Main process, Preload scripts, Worker process, etc.
      // If you are familiar with Vite configuration, it will look really familiar.
      build: [
        {
          // `entry` is just an alias for `build.lib.entry` in the corresponding file of `config`.
          entry: "src/main.ts",
          config: "vite.main.config.ts",
          target: "main",
        },
        {
          entry: "src/preload.ts",
          config: "vite.preload.config.ts",
          target: "preload",
        },
      ],
      renderer: [
        {
          name: "main_window",
          config: "vite.renderer.config.ts",
        },
      ],
    }),
    // Fuses are used to enable/disable various Electron functionality
    // at package time, before code signing the application
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

export default config;
