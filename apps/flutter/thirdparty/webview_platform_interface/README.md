# Shared WebView platform identity

The Linux and OHOS 1.4 adapters import `webview_platform_interface`, while the
Android, Apple, Windows and Web adapters import `webview_flutter_platform_interface`.
This package re-exports the local Flutter interface so every adapter registers
against the same `WebViewPlatform.instance` and receives the same theme contract.

The additional 1.4 data models are retained in the local Flutter interface.
