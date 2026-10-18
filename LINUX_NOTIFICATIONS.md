# Ubuntu desktop notification diagnosis

Ubuntu 24.04 uses GNOME 46. The notification plugin locked at 2.4.0 drops
the `notify-rust` notification handle immediately after sending it. GNOME
removes the notification when that handle's D-Bus connection disconnects.
The request can therefore succeed without leaving a visible notification.

The official fix in `tauri-plugin-notification` 2.7.0 keeps a shared D-Bus
connection alive. Use the matching 2.7 JavaScript bindings as well. See
https://github.com/tauri-apps/plugins-workspace/pull/3588.

The 2.7 plugin requires Tauri 2.12 and Rust 1.90 or later; the lockfiles
include those required dependency updates. The Linux click handler uses
the plugin's action callback and notification extras to open HTTPS PTT
article URLs through the system browser. Test notifications have no URL
and do not open a browser. Dismissal events and unrelated URLs are ignored.

## Verification

Use Node.js 22 or later (as in CI) for JavaScript tests. Node 18 does not
provide the global `crypto` API these tests expect by default.

```sh
npm install
npm test
npm run build
cargo test --locked --manifest-path src-tauri/Cargo.toml
```

Check the session's notification daemon:

```sh
notify-send --wait --app-name=Waterball 'Waterball system test' 'Ubuntu notification service test'
gdbus call --session --dest org.freedesktop.Notifications \
  --object-path /org/freedesktop/Notifications \
  --method org.freedesktop.Notifications.GetServerInformation
```

Keep `notify-send` connected with `--wait` while checking the desktop. On
this Ubuntu session the short-lived test was not visible, whereas the
waiting test showed a banner and remained in the notification center.
Dismiss that test notification to let `notify-send` exit.

Run the plugin independently of the frontend, BBS login, or network services:

```sh
cd src-tauri
cargo run --locked --example notification_probe
```

The probe queues one notification, then keeps the application alive for 60
seconds. Check its banner and the notification center during that interval.
GNOME may remove it when the probe exits; that is expected and differs from
the old bug, where it disappears while the application is still running.

Finally run `npm run tauri dev` from the project root and use the local
notification test button in Article Tracking. A successful return from
the plugin alone does not prove that a banner was displayed: Do Not Disturb
and per-application settings can still suppress it.

## Local verification (2026-10-17)

- Baseline: private GitHub commit `9c5894b`; no older local patches applied.
- System: Ubuntu 24.04.5, GNOME notification server 46.0, Wayland; banners
  enabled and screen unlocked. The user confirmed the waiting system
  notification appeared as a banner and in the notification center.
- Updated JavaScript tests: 183 passed using Node 24.
- Updated Rust tests: 17 passed, including article URL handling and the
  no-browser behavior for test notifications and dismissals.
- Production frontend build and diagnostic-code exclusion check passed.
- The user tested Article Tracking's local notification button in the
  updated private development app and confirmed that its notification
  appeared both as a banner and in the notification center.
- Article URL routing is covered by Rust tests; an actual article
  notification click has not yet been manually verified.
