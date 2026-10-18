import type { MetadataRoute } from "next";
import { APP_NAME, APP_DESCRIPTION } from "../lib/constants";
import { assetUrl } from "../lib/static-assets";

export const dynamic = "force-static";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: assetUrl(""),
    name: APP_NAME,
    short_name: APP_NAME,
    description: APP_DESCRIPTION,
    start_url: assetUrl(""),
    scope: assetUrl(""),
    display: "fullscreen",
    background_color: "#0f141a",
    theme_color: "#0f141a",
    icons: [
      { src: assetUrl("icons/icon-192.png"), sizes: "192x192", type: "image/png", purpose: "any" },
      { src: assetUrl("icons/icon-512.png"), sizes: "512x512", type: "image/png", purpose: "any" },
      { src: assetUrl("icons/icon-512.png"), sizes: "512x512", type: "image/png", purpose: "maskable" }
    ]
  };
}
