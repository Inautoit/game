import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'core/palette.dart';
import 'services/ads_service.dart';
import 'services/notification_service.dart';
import 'services/save_service.dart';
import 'state/game_state.dart';
import 'ui/game_screen.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await SystemChrome.setPreferredOrientations([DeviceOrientation.portraitUp]);
  SystemChrome.setEnabledSystemUIMode(SystemUiMode.edgeToEdge);

  // Cargar partida guardada (o empezar de cero).
  final save = await SaveService.create();
  final state = GameState();
  save.load(state);

  // Servicios (no bloquean el arranque si fallan).
  final ads = AdsService();
  final notifications = NotificationService();
  // ignore: unawaited_futures
  ads.init();
  // ignore: unawaited_futures
  notifications.init();

  runApp(LumenApp(
    state: state,
    save: save,
    ads: ads,
    notifications: notifications,
  ));
}

class LumenApp extends StatelessWidget {
  const LumenApp({
    super.key,
    required this.state,
    required this.save,
    required this.ads,
    required this.notifications,
  });

  final GameState state;
  final SaveService save;
  final AdsService ads;
  final NotificationService notifications;

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Lumen',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        useMaterial3: true,
        brightness: Brightness.dark,
        scaffoldBackgroundColor: Palette.abyss,
        colorScheme: ColorScheme.fromSeed(
          seedColor: Palette.cyan,
          brightness: Brightness.dark,
          surface: Palette.panel,
        ),
        snackBarTheme: const SnackBarThemeData(
          behavior: SnackBarBehavior.floating,
        ),
      ),
      home: GameScreen(
        state: state,
        save: save,
        ads: ads,
        notifications: notifications,
      ),
    );
  }
}
