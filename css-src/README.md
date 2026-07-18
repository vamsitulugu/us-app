These are the readable source versions of the CSS files served (minified)
from `public/`. The files in `public/*.css` are generated from these —
don't hand-edit the minified versions in `public/`, edit here instead.

To regenerate after making a change:

    npm install clean-css --no-save
    node -e "
      const fs = require('fs');
      const CleanCSS = require('clean-css');
      const f = 'FILENAME'; // e.g. 'theme-burgundy'
      const src = fs.readFileSync('css-src/' + f + '.css', 'utf8');
      const out = new CleanCSS({}).minify(src);
      if (out.errors.length) throw new Error(out.errors.join('\n'));
      fs.writeFileSync('public/' + f + '.css', out.styles);
    "

Files: app-polish, composer, premium-motion, premium-states,
responsive-fix, theme-burgundy.
