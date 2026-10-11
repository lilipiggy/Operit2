@TestOn('browser')
library;

import 'dart:async';
import 'dart:js_interop';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:web/web.dart' as web;
import 'package:webview_all_web/webview_all_web.dart';

/// Verifies that browser-native media queries receive the iframe color preference.
void main() {
  test(
    'iframe media queries and CSS follow app preference without navigation',
    () async {
      final params = WebWebViewControllerCreationParams();
      final controller = WebWebViewController(params);
      final frame = params.iFrame;
      final loaded = Completer<void>();
      frame.addEventListener(
        'load',
        ((web.Event event) => loaded.complete()).toJS,
        web.AddEventListenerOptions(once: true),
      );
      frame.srcdoc =
          '''
      <style>
        body { color: rgb(0, 0, 0); }
        @media (prefers-color-scheme: dark) { body { color: rgb(255, 255, 255); } }
      </style><body>Theme probe</body>
    '''
              .toJS;
      await controller.setPreferredColorScheme(Brightness.dark);
      web.document.body!.appendChild(frame);
      addTearDown(() => frame.remove());
      await loaded.future.timeout(const Duration(seconds: 10));
      final page = frame.contentWindow!;
      expect(page.matchMedia('(prefers-color-scheme: dark)').matches, isTrue);
      expect(
        page.getComputedStyle(frame.contentDocument!.body!).color,
        'rgb(255, 255, 255)',
      );
      final document = frame.contentDocument;
      await controller.setPreferredColorScheme(Brightness.light);
      expect(page.matchMedia('(prefers-color-scheme: light)').matches, isTrue);
      expect(
        page.getComputedStyle(frame.contentDocument!.body!).color,
        'rgb(0, 0, 0)',
      );
      expect(frame.contentDocument, document);
    },
  );
}
