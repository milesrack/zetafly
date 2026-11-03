import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:webview_flutter/webview_flutter.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  SystemChrome.setSystemUIOverlayStyle(
    const SystemUiOverlayStyle(
      statusBarColor: Colors.transparent,
      systemNavigationBarColor: Colors.transparent,
    ),
  );
  runApp(const MyApp());
}

class MyApp extends StatelessWidget {
  const MyApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Zetafly',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        scaffoldBackgroundColor: Colors.white,
      ),
      home: const WebViewScreen(),
    );
  }
}

class WebViewScreen extends StatefulWidget {
  const WebViewScreen({super.key});

  @override
  State<WebViewScreen> createState() => _WebViewScreenState();
}

class _WebViewScreenState extends State<WebViewScreen> with WidgetsBindingObserver {
  late final WebViewController _controller;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);

    _controller = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setNavigationDelegate(
        NavigationDelegate(
          onPageStarted: (_) => _injectAudioTracker(),
          onPageFinished: (_) => _injectAudioTracker(),
        ),
      )
      ..loadRequest(Uri.parse('https://zetafly.poosd.dev/'));
  }

  void _injectAudioTracker() {
    _controller.runJavaScript('''
      (function() {
        window.__activeAudioContexts = window.__activeAudioContexts || [];
        const OrigAC = window.AudioContext || window.webkitAudioContext;
        if (OrigAC && !window.__acPatched) {
          window.__acPatched = true;
          function PatchedAC(...args) {
            const ctx = new OrigAC(...args);
            window.__activeAudioContexts.push(ctx);
            return ctx;
          }
          PatchedAC.prototype = OrigAC.prototype;
          window.AudioContext = PatchedAC;
          if (window.webkitAudioContext) window.webkitAudioContext = PatchedAC;
        }
      })();
    ''');
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    // Only pause audio when the app is actually placed in the background (paused/hidden)
    // Ignore 'inactive' so pulling down the top notification shade won't stop the audio.
    if (state == AppLifecycleState.paused || state == AppLifecycleState.hidden) {
      _controller.runJavaScript('''
        try {
          if (window.__activeAudioContexts) {
            window.__activeAudioContexts.forEach(function(ctx) {
              if (ctx && ctx.state === 'running') {
                ctx.suspend();
              }
            });
          }
          document.querySelectorAll('audio, video').forEach(function(m) {
            m.pause();
          });
          Object.defineProperty(document, 'hidden', { value: true, writable: true, configurable: true });
          Object.defineProperty(document, 'visibilityState', { value: 'hidden', writable: true, configurable: true });
          document.dispatchEvent(new Event('visibilitychange'));
        } catch (e) {}
      ''');
    } else if (state == AppLifecycleState.resumed) {
      _controller.runJavaScript('''
        try {
          if (window.__activeAudioContexts) {
            window.__activeAudioContexts.forEach(function(ctx) {
              if (ctx && ctx.state === 'suspended') {
                ctx.resume();
              }
            });
          }
          Object.defineProperty(document, 'hidden', { value: false, writable: true, configurable: true });
          Object.defineProperty(document, 'visibilityState', { value: 'visible', writable: true, configurable: true });
          document.dispatchEvent(new Event('visibilitychange'));
        } catch (e) {}
      ''');
    }
  }

  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) async {
        if (!didPop && await _controller.canGoBack()) {
          await _controller.goBack();
        }
      },
      child: Scaffold(
        body: SafeArea(
          child: WebViewWidget(controller: _controller),
        ),
      ),
    );
  }
}
