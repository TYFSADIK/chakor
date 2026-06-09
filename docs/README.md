# docs assets

The images the main [README](../README.md) points at. They are generated from code
so they stay consistent and on-brand, and so anyone can regenerate them after a
rebrand or a UI change.

| File | Where it is used |
| --- | --- |
| `banner.png` | Hero at the very top. Also works as the repo's social preview image (GitHub → Settings → General → Social preview). |
| `preview.png` | The chat interface, the main "look" shot. |
| `fit.png` | The hardware-aware model picker: FITS / TIGHT / TOO BIG. |
| `download.png` | The in-app Hugging Face downloader with the background-download tray. |

## Regenerate them

```bash
node docs/build-assets.mjs
```

It renders crisp 2x PNGs with the app's own `sharp`. Edit colors, copy, and layout
in `build-assets.mjs` (one file, plain SVG built from small helpers). The raised
fist and the green come straight from the app's logo.

## Make this page pop even more: a real demo GIF

The renders are sharp, but a short screen recording of the real app is the single
biggest thing you can add for stars. It takes five minutes:

1. Start the app (`npm run dev` or your install) and sign in.
2. Record 8 to 15 seconds: ask something, watch it stream, flip on web search, open
   the model menu and switch an engine.
3. Export it as `docs/demo.gif` (keep it under a few MB) and drop it right under the
   banner in `README.md`:

   ```markdown
   <img src="docs/demo.gif" alt="Chakor in action" width="100%" />
   ```

Clean GIF recorders: [Peek](https://github.com/phw/peek) on Linux,
[Kap](https://getkap.co) on macOS, [ScreenToGif](https://www.screentogif.com) on
Windows.
