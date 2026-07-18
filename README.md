HOW TO USE THIS PACKAGE
========================

Everything in here mirrors your project's folder structure. Unzip and
copy each folder over the matching one in your project (overwrite when asked):

  public/       -> overwrite these files in your project's public/ folder
                    (index.html, dreamgoals.html, and 6 .css files)
  routes/       -> overwrite these files in your project's routes/ folder
                    (data.js, home.js, lyrics.js)
  css-src/      -> put this as a NEW top-level folder in your project root
                    (NOT inside public/) — these are the readable, editable
                    originals of the 6 CSS files now shipped minified in
                    public/. See css-src/README.md for how to re-minify
                    after future edits.

ONE MANUAL STEP (can't be done via file copy):
  Delete this file from your project, it's unused and 1.27MB:
      public/icons/background-chat.png

After copying everything in, from your project folder run:
    git add .
    git commit -m "Bandwidth fixes: dead code removal, query trimming, CSS minification"
    git push
