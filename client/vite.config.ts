import react from '@vitejs/plugin-react';
// @ts-ignore
import path from 'path';
import type { Plugin } from 'vite';
import { defineConfig } from 'vite';
import { compression } from 'vite-plugin-compression2';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import { VitePWA } from 'vite-plugin-pwa';

// https://vitejs.dev/config/
const backendPort = process.env.BACKEND_PORT && Number(process.env.BACKEND_PORT) || 23080;
const backendURL = process.env.HOST ? `http://${process.env.HOST}:${backendPort}` : `http://localhost:${backendPort}`;

export default defineConfig(({ command }) => ({
  base: '/arp/',
  server: {
    allowedHosts: process.env.VITE_ALLOWED_HOSTS && process.env.VITE_ALLOWED_HOSTS.split(',') || [],
    host: process.env.HOST || 'localhost',
    port: process.env.PORT && Number(process.env.PORT) || 3090,
    strictPort: false,
    proxy: {
      '/arp/api': {
        target: backendURL,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/arp/, ''),
      },
      '/arp/oauth': {
        target: backendURL,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/arp/, ''),
      },
      '/arp/images': {
        target: backendURL,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/arp/, ''),
      },
      '/arp/health': {
        target: backendURL,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/arp/, ''),
      },
      '/api': {
        target: backendURL,
        changeOrigin: true,
      },
      '/oauth': {
        target: backendURL,
        changeOrigin: true,
      },
    },
  },
  // Set the directory where environment variables are loaded from and restrict prefixes
  envDir: '../',
  envPrefix: ['VITE_', 'SCRIPT_', 'DOMAIN_', 'ALLOW_'],
  plugins: [
    react(),
    nodePolyfills({
      exclude: ['crypto', 'buffer', 'global'],
    }),
    // VitePWA completely disabled to prevent Service Worker cache issues
    // If you want to re-enable PWA in the future, uncomment the block below
    // VitePWA({
    //   injectRegister: 'auto',
    //   registerType: 'autoUpdate',
    //   devOptions: { enabled: false },
    //   useCredentials: true,
    //   includeManifestIcons: false,
    //   workbox: {
    //     globPatterns: ['**/*.{js,css,html}', 'assets/favicon*.png', 'assets/icon-*.png'],
    //     globIgnores: ['images/**/*', '**/*.map', 'index.html'],
    //     maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
    //     navigateFallbackDenylist: [/^\/oauth/, /^\/api/],
    //   },
    //   includeAssets: [],
    //   manifest: {
    //     name: 'LibreChat',
    //     short_name: 'LibreChat',
    //     display: 'standalone',
    //     background_color: '#000000',
    //     theme_color: '#009688',
    //     icons: [...],
    //   },
    // }),
    sourcemapExclude({ excludeNodeModules: true }),
    // compression({
    //   threshold: 10240,
    // }),
  ],
  publicDir: command === 'serve' ? './public' : false,
  build: {
    sourcemap: process.env.NODE_ENV === 'development',
    outDir: './dist',
    minify: 'terser',
    rollupOptions: {
      preserveEntrySignatures: 'strict',
      output: {
        manualChunks(id: string) {
          const normalizedId = id.replace(/\\/g, '/');
          if (!normalizedId.includes('node_modules')) {
            // Create a separate chunk for all locale files under src/locales.
            if (normalizedId.includes('/src/locales/')) {
              return 'locales';
            }
            // Let Rollup decide automatically for any other app source files.
            return null;
          }

          // Only split out large, self-contained libraries that are independently
          // useful and lazy/conditionally loaded. Everything else goes into a
          // single `vendor` chunk so Rollup can freely order modules internally
          // and resolve circular dependencies without cross-chunk TDZ issues.
          //
          // Background: aggressive per-package chunking (25+ manual rules) fought
          // Rollup's module ordering and created cross-chunk circular dependencies.
          // Adding jspdf/html2canvas shifted the module graph just enough to expose
          // latent cycles → "Cannot access 'X' before initialization" TDZ errors
          // that only appear in production builds (dev mode uses native ESM).
          if (
            normalizedId.includes('mermaid') ||
            normalizedId.includes('dagre-d3-es') ||
            normalizedId.includes('chevrotain') ||
            normalizedId.includes('langium') ||
            normalizedId.includes('lodash-es') ||
            normalizedId.includes('/khroma') ||
            normalizedId.includes('/cytoscape') ||
            normalizedId.includes('/stylis') ||
            normalizedId.includes('/roughjs') ||
            normalizedId.includes('/d3') ||
            normalizedId.includes('/dagre')
          ) {
            return 'mermaid';
          }
          if (normalizedId.includes('@codesandbox/sandpack')) {
            return 'sandpack';
          }
          if (normalizedId.includes('heic-to')) {
            return 'heic-converter';
          }

          return 'vendor';
        },
        entryFileNames: 'assets/[name].[hash].js',
        chunkFileNames: 'assets/[name].[hash].js',
        assetFileNames: (assetInfo) => {
          if (assetInfo.names?.[0] && /\.(woff|woff2|eot|ttf|otf)$/.test(assetInfo.names[0])) {
            return 'assets/fonts/[name][extname]';
          }
          return 'assets/[name].[hash][extname]';
        },
      },
      /**
       * Ignore "use client" warning since we are not using SSR
       * @see {@link https://github.com/TanStack/query/pull/5161#issuecomment-1477389761 Preserve 'use client' directives TanStack/query#5161}
       */
      onwarn(warning, warn) {
        if (warning.message.includes('Error when using sourcemap')) {
          return;
        }
        warn(warning);
      },
    },
    chunkSizeWarningLimit: 1500,
  },
  resolve: {
    alias: {
      '~': path.join(__dirname, 'src/'),
      $fonts: path.resolve(__dirname, 'public/fonts'),
      'micromark-extension-math': 'micromark-extension-llm-math',
    },
  },
}));

interface SourcemapExclude {
  excludeNodeModules?: boolean;
}

export function sourcemapExclude(opts?: SourcemapExclude): Plugin {
  return {
    name: 'sourcemap-exclude',
    transform(code: string, id: string) {
      if (opts?.excludeNodeModules && id.includes('node_modules')) {
        return {
          code,
          // https://github.com/rollup/rollup/blob/master/docs/plugin-development/index.md#source-code-transformations
          map: { mappings: '' },
        };
      }
    },
  };
}
