import type { Plugin } from 'vite';

/**
 * Adds modulepreload links for dynamically imported chunks.
 * This improves loading performance by preloading chunks that will be needed.
 */
export function preloadDynamicChunks(): Plugin {
  return {
    name: 'preload-dynamic-chunks',
    transformIndexHtml(html, ctx) {
      if (!ctx.bundle) return html;

      // Include the setup chunk's static imports (shared CodeMirror chunks),
      // but not its dynamic imports (e.g. vim, loaded only when enabled)
      const files = new Set<string>();
      for (const [fileName, chunk] of Object.entries(ctx.bundle)) {
        if (fileName.startsWith('assets/setup-') && fileName.endsWith('.js')) {
          files.add(fileName);
          if (chunk.type === 'chunk') {
            for (const imported of chunk.imports) {
              const dep = ctx.bundle[imported];
              if (dep?.type === 'chunk' && !dep.isEntry) files.add(imported);
            }
          }
        }
      }

      const preloads = [...files].map(
        (fileName) => `<link rel="modulepreload" crossorigin href="/${fileName}">`
      );

      if (preloads.length === 0) return html;
      return html.replace('</head>', `${preloads.join('\n')}\n</head>`);
    },
  };
}

