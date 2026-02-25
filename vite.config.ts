import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import tailwindcss from "@tailwindcss/vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import path from "path";

// https://vite.dev/config/
// BETTER_AUTH_URL is the single source of truth for app/auth URL (set in .env / Cloudflare).
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const siteUrl =
    env.BETTER_AUTH_URL ??
    env.VITE_SITE_URL ??
    (mode === "production" ? "https://unlockaffiliate.com" : "http://localhost:5173");

  return {
    plugins: [react(), cloudflare(), tailwindcss()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    define: {
      "import.meta.env.VITE_BETTER_AUTH_URL": JSON.stringify(siteUrl),
      "import.meta.env.VITE_SITE_URL": JSON.stringify(siteUrl),
    },
  };
});
