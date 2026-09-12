# Resurface Chrome extension

## Local installation

1. Start the web app at `http://localhost:3000`.
2. Open `chrome://extensions`, enable Developer mode, and choose **Load unpacked**.
3. Select this `extension` directory.
4. In Resurface, open **Connections**, generate a pairing code, and enter it in the extension.
5. Keep the API origin as `http://localhost:3000` and send bookmarks or open tabs.

The extension stores only its opaque pairing token and chosen API origin. It does not store a Supabase session or social-media password.

## Demo package

From the repository root:

```bash
pnpm extension:package
```

Before a production package, add the exact deployed HTTPS origin to `host_permissions` in `manifest.json`, increment the extension version, reload it in Chrome, and repeat the pairing/import test.
