import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

import 'package:operit2/ui/features/packages/screens/GitHubOAuthLoginCallback_io.dart';

void main() {
  test('loopback callback preserves the broker completion query', () async {
    final callback = await GitHubOAuthLoginCallback.create(
      Uri.parse('https://api.operit.app/oauth/github/complete'),
    );
    final client = HttpClient();
    addTearDown(() async {
      client.close(force: true);
      await callback.close();
    });

    final completionRequest = await client.getUrl(
      callback.redirectUri.replace(
        queryParameters: <String, String>{
          'transactionId': 'transaction-123',
          'status': 'complete',
        },
      ),
    );
    final responseFuture = completionRequest.close();
    final completionUrl = await callback.completion;
    final response = await responseFuture;

    expect(response.statusCode, HttpStatus.ok);
    expect(
      completionUrl?.toString(),
      '${callback.redirectUri}?transactionId=transaction-123&status=complete',
    );
  });
}
