import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "FXQY Method",
    short_name: "FXQY",
    description: "Quality-first video analysis and standards-compliant export workstation.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#070815",
    theme_color: "#070815",
    orientation: "any",
    categories: ["photo", "video", "utilities"],
    icons: [
      { src: "/optimizer-icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/optimizer-icon-maskable.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" },
    ],
  };
}
