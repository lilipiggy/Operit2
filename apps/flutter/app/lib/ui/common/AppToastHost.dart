// ignore_for_file: file_names

import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../../core/host/AppToastController.dart';
import 'OperitLogoMark.dart';

/// Presents process-wide toast messages inside the application window.
class AppToastHost extends StatefulWidget {
  /// Creates an application toast overlay around [child].
  const AppToastHost({super.key, required this.child});

  final Widget child;

  /// Creates the state that observes process-wide toast messages.
  @override
  State<AppToastHost> createState() => _AppToastHostState();
}

class _AppToastHostState extends State<AppToastHost> {
  Timer? _dismissTimer;

  /// Starts observing the process-wide toast controller.
  @override
  void initState() {
    super.initState();
    AppToastController.instance.message.addListener(_handleMessageChanged);
    _handleMessageChanged();
  }

  /// Stops observing toast messages and releases the dismissal timer.
  @override
  void dispose() {
    AppToastController.instance.message.removeListener(_handleMessageChanged);
    _dismissTimer?.cancel();
    super.dispose();
  }

  /// Resets dismissal timing when the active toast message changes.
  void _handleMessageChanged() {
    _dismissTimer?.cancel();
    final message = AppToastController.instance.message.value;
    if (message == null) {
      return;
    }
    _dismissTimer = Timer(
      _displayDuration(message.text),
      () => AppToastController.instance.dismiss(message.id),
    );
  }

  /// Builds the application content and its top-centered toast overlay.
  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<AppToastMessage?>(
      valueListenable: AppToastController.instance.message,
      builder: (context, message, child) {
        return Stack(
          fit: StackFit.expand,
          children: <Widget>[
            child!,
            SafeArea(
              child: Align(
                alignment: Alignment.topCenter,
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
                  child: _AppToastSurface(
                    message: message,
                    onDismiss: message == null
                        ? null
                        : () => AppToastController.instance.dismiss(message.id),
                  ),
                ),
              ),
            ),
          ],
        );
      },
      child: widget.child,
    );
  }
}

class _AppToastSurface extends StatelessWidget {
  const _AppToastSurface({required this.message, required this.onDismiss});

  final AppToastMessage? message;
  final VoidCallback? onDismiss;

  /// Builds one animated, bounded toast surface.
  @override
  Widget build(BuildContext context) {
    final visible = message != null;
    final colorScheme = Theme.of(context).colorScheme;
    return AnimatedSlide(
      offset: visible ? Offset.zero : const Offset(0, -0.35),
      duration: const Duration(milliseconds: 220),
      curve: Curves.easeOutCubic,
      child: AnimatedOpacity(
        opacity: visible ? 1 : 0,
        duration: Duration(milliseconds: visible ? 180 : 140),
        child: IgnorePointer(
          ignoring: !visible,
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 720),
            child: Material(
              color: colorScheme.surface.withValues(alpha: 0.98),
              elevation: 8,
              shadowColor: colorScheme.shadow.withValues(alpha: 0.18),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(8),
                side: BorderSide(color: colorScheme.outlineVariant),
              ),
              child: Padding(
                padding: const EdgeInsets.fromLTRB(12, 8, 6, 8),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: <Widget>[
                    const OperitLogoMark(size: 28),
                    const SizedBox(width: 10),
                    Flexible(
                      child: ConstrainedBox(
                        constraints: const BoxConstraints(maxHeight: 240),
                        child: SingleChildScrollView(
                          child: Text(message?.text ?? ''),
                        ),
                      ),
                    ),
                    IconButton(
                      onPressed: onDismiss,
                      icon: const Icon(Icons.close),
                      iconSize: 18,
                      constraints: const BoxConstraints.tightFor(
                        width: 28,
                        height: 28,
                      ),
                      padding: EdgeInsets.zero,
                      tooltip: MaterialLocalizations.of(
                        context,
                      ).closeButtonTooltip,
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// Computes a readable display duration from the toast length.
Duration _displayDuration(String message) {
  final estimatedLines = message
      .split('\n')
      .map((line) => math.max(1, ((line.length + 23) / 24).floor()))
      .fold<int>(0, (sum, lines) => sum + lines);
  final milliseconds = 2500 + estimatedLines * 850;
  return Duration(milliseconds: milliseconds.clamp(3500, 12000));
}
