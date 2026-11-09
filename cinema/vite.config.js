import fs from 'fs';
// The cinema is part of the Twin Hearts web app: it is built into ../public/cinema and served at /cinema/ on the same domain.
// Supabase URL + anon key (public values) come from the web app's own index.html, so there are no separate env vars.
const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const pick = n => (html.match(new RegExp('window\\.' + n + "\\s*=\\s*'([^']+)'")) || [])[1] || '';
export default {
  base: '/cinema/',
  define: { __SB_URL__: JSON.stringify(pick('__SUPABASE_URL__')), __SB_KEY__: JSON.stringify(pick('__SUPABASE_ANON_KEY__')) },
  build: { outDir: '../public/cinema', emptyOutDir: true, chunkSizeWarningLimit: 1200 }
};
