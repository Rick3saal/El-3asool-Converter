import path from "path";
import { fileURLToPath } from "url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type Plugin } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Absolute sharing URLs (canonical + Open Graph image).
 *
 * Social crawlers (WhatsApp, Facebook, LinkedIn, X) ignore relative og:image
 * values, so a share preview needs a full URL. Nothing is hardcoded in the repo:
 *
 *   SITE_URL                      wins — set it once a custom domain is attached
 *   VERCEL_PROJECT_PRODUCTION_URL Vercel's production alias
 *   VERCEL_URL                    the current deployment (previews included)
 *
 * With none of them set (a plain local build) the tags keep their origin-relative
 * paths and the site behaves exactly as before.
 */
function sharingMetaUrls(raw: string): Plugin {
  const origin = raw.trim().replace(/\/+$/, "").replace(/^https?:\/\//, "");

  return {
    name: "sharing-meta-urls",
    apply: "build",
    // 'post' so this runs after Vite has finished rewriting asset paths in index.html
    transformIndexHtml: {
      order: "post",
      handler(html) {
        if (!origin) return html;
        const base = `https://${origin}`;
        return html
          .replace(/content="\.?\/social-preview\.png"/g, `content="${base}/social-preview.png"`)
          .replace(
            "</title>",
            [
              "</title>",
              `    <link rel="canonical" href="${base}/" />`,
              `    <meta property="og:url" content="${base}/" />`,
            ].join("\n")
          );
      },
    },
  };
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // SITE_URL may come from a local .env file; the VERCEL_* values come from the
  // Vercel build environment itself. Neither is a secret, and neither ships in
  // the client bundle beyond the two meta tags above.
  const env = loadEnv(mode, process.cwd(), "");
  const siteUrl =
    env.SITE_URL ||
    process.env.SITE_URL ||
    process.env.VERCEL_PROJECT_PRODUCTION_URL ||
    process.env.VERCEL_URL ||
    "";

  return {
    plugins: [react(), tailwindcss(), sharingMetaUrls(siteUrl), viteSingleFile()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "src"),
      },
    },
  };
});
