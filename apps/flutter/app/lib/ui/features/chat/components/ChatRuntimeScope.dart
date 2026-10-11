// ignore_for_file: file_names

import 'package:flutter/widgets.dart';

import '../../../../core/proxy/generated/CoreProxyClients.g.dart';

/// Makes the window-scoped chat runtime available to descendant renderers.
class ChatRuntimeScope extends InheritedWidget {
  const ChatRuntimeScope({
    super.key,
    required this.chatCore,
    required this.chatId,
    required super.child,
  });

  final GeneratedChatRuntimeHolderMainCoreProxy chatCore;
  final String? chatId;

  static GeneratedChatRuntimeHolderMainCoreProxy? maybeOf(
    BuildContext context,
  ) {
    return context
        .dependOnInheritedWidgetOfExactType<ChatRuntimeScope>()
        ?.chatCore;
  }

  /// Reads the chat id associated with the current chat surface.
  static String? maybeChatIdOf(BuildContext context) {
    return context
        .dependOnInheritedWidgetOfExactType<ChatRuntimeScope>()
        ?.chatId;
  }

  @override
  bool updateShouldNotify(ChatRuntimeScope oldWidget) {
    return oldWidget.chatCore != chatCore || oldWidget.chatId != chatId;
  }
}
