# App Icons

Tauri expects these files for the production bundle:

- `32x32.png`
- `128x128.png`
- `128x128@2x.png`
- `icon.icns` (macOS)
- `icon.ico` (Windows)

Generate them all from a single 1024x1024 PNG with:

```bash
npm run tauri icon path/to/source.png
```

For `npm run tauri dev`, missing icons emit a warning but do not block the dev server.
