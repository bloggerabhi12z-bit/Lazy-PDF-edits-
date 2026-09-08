// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//
// - tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro
// - componentTagger (dev-only)
// - VITE_* env injection
// - @ path alias
// - React/TanStack dedupe
// - error logger plugins
// - sandbox detection (port/host/strictPort)
//
// We explicitly override Nitro's deployment target for Vercel.

import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts
    // (our SSR error wrapper).
    server: {
      entry: "server",
    },
  },

  // Override the wrapper's default Cloudflare Nitro target.
  // The application is deployed on Vercel.
  nitro: {
    preset: "vercel",
  },
});