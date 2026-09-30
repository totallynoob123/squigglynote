# Squigglynote https://totallynoob123.github.io/squigglynote/ 

## Project layout

```
index.html   page markup + the list of stylesheets and scripts
css/         styles, loaded in numbered order
js/          scripts, loaded in numbered order
server/      the AI + monitor server that runs on a PC behind ngrok (see server/README.md)
```

The site is still a plain static site with no build step: open `index.html` or serve the folder.
Its AI features (SquigglyBot, Make concise, transcription, read aloud) call the server at the
address in `js/00-config.js`.

**Load order matters.** Many scripts build on earlier ones by replacing global functions
(`render`, `edit`, `applyPrefs`) or button handlers, so a file only works after the files
numbered before it. When adding a feature, add a new file with the next number and a
matching `<script>` / `<link>` tag at the end of the list in `index.html`.

To preview locally:

```
python -m http.server 8000
```

then open http://localhost:8000.
