## 0.1.0

- Introduce a platform-neutral API for content-only desktop windows.
- Add the initial Windows transparent composition adapter.
- Reuse `desktop_multi_window` for secondary Flutter engine lifecycle.
- Keep application rendering and refresh logic independent from native window code.
- Add federated macOS and GTK window adapters (native validation pending).
- Add Android launcher AppWidget snapshot publication, persisted frames, pin confirmation,
  launcher configuration, and application-lifetime click delivery.
- Add transparent Flutter snapshot capture with explicit content readiness.
- Document Android's snapshot-only rendering and lack of background DSL execution.
- Register fresh content providers and refresh confirmed publications at startup,
  on resume, and periodically while active, using one shared application content builder.
