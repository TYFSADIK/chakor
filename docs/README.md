# docs assets

These are the images the main [README](../README.md) points at.

- `banner.png` / `banner.svg` - the hero banner at the top of the readme.
- `preview.png` / `preview.svg` - an illustration of the app, used as the "look" image.

The readme shows the PNGs (rendered at 2x so they stay sharp, and stable on every
viewer). The `.svg` files are the editable source. The raised fist and the green
come straight from the app's own logo. `banner.png` also works as the repo's social
preview image: set it under Settings → General → Social preview on GitHub.

## Make this page pop with real media

The illustration is a stand in. Real screenshots and a short demo always do better.
It takes five minutes:

1. Start the app (`npm run dev` or your running install) and sign in.
2. Open a chat with a couple of messages, the model picker, and maybe the Compare
   or Notes view so the screenshot shows off real features.
3. Take a PNG. Save the best ones in this folder, for example `docs/chat.png`,
   `docs/compare.png`, `docs/settings.png`.
4. In `README.md`, swap the `docs/preview.svg` line for your `docs/chat.png`, or add
   a small grid of them.

### A demo GIF (the big one)

A short screen recording at the very top of the readme is the single biggest thing
you can do for stars. Record 8 to 15 seconds of a real chat (ask something, watch it
stream, flip on web search), export it as `docs/demo.gif`, and put it right under the
banner:

```markdown
<img src="docs/demo.gif" alt="Chakor in action" width="100%" />
```

Tools that make clean GIFs: [Peek](https://github.com/phw/peek) on Linux,
[Kap](https://getkap.co) on macOS, or [ScreenToGif](https://www.screentogif.com) on
Windows. Keep it under a few MB so it loads fast on GitHub.
