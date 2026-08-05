import 'dart:async';
import 'package:flame/game.dart';
import 'package:flutter/material.dart';
import 'package:share_plus/share_plus.dart';
import '../core/format.dart';
import '../core/palette.dart';
import '../game/lumen_game.dart';
import '../services/ads_service.dart';
import '../services/notification_service.dart';
import '../services/save_service.dart';
import '../state/game_state.dart';
import 'dialogs.dart';
import 'shop_sheet.dart';

class GameScreen extends StatefulWidget {
  const GameScreen({
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
  State<GameScreen> createState() => _GameScreenState();
}

class _GameScreenState extends State<GameScreen> with WidgetsBindingObserver {
  late final LumenGame _game;
  Timer? _autosave;
  final List<_FloatText> _floats = [];
  int _floatId = 0;

  GameState get state => widget.state;

  @override
  void initState() {
    super.initState();
    _game = LumenGame(state);
    WidgetsBinding.instance.addObserver(this);
    _autosave = Timer.periodic(
        const Duration(seconds: 10), (_) => widget.save.save(state));
    WidgetsBinding.instance.addPostFrameCallback((_) => _onStart());
  }

  Future<void> _onStart() async {
    // 1) Ganancias offline (si estuvo cerrado el tiempo suficiente).
    final off = state.computeOffline(DateTime.now());
    if (off.amount > 0 && off.elapsed.inSeconds > 60) {
      await showOfflineDialog(context,
          state: state, ads: widget.ads, amount: off.amount, elapsed: off.elapsed);
      await widget.save.save(state); // fija lastSaved = ahora
    }
    // 2) Recompensa diaria.
    if (!mounted) return;
    final now = DateTime.now();
    if (state.dailyAvailable(now)) {
      final r = state.claimDaily(now);
      if (r.reward > 0) {
        await showDailyDialog(context, state: state, reward: r.reward, day: r.day);
      }
    }
    // 3) Permiso de notificaciones (silencioso si se deniega).
    await widget.notifications.requestPermission();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState s) {
    if (s == AppLifecycleState.paused || s == AppLifecycleState.inactive) {
      widget.save.save(state);
      widget.notifications.scheduleReminder();
    } else if (s == AppLifecycleState.resumed) {
      widget.notifications.cancelAll();
      _handleResumeOffline();
    }
  }

  Future<void> _handleResumeOffline() async {
    final off = state.computeOffline(DateTime.now());
    if (off.amount > 0 && off.elapsed.inSeconds > 120) {
      await showOfflineDialog(context,
          state: state, ads: widget.ads, amount: off.amount, elapsed: off.elapsed);
      await widget.save.save(state);
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _autosave?.cancel();
    widget.save.save(state);
    super.dispose();
  }

  // ---- Interacción ----

  void _onTapGarden(TapDownDetails d) {
    final gained = state.tap();
    _game.poke(Vector2(d.localPosition.dx, d.localPosition.dy));
    final id = _floatId++;
    setState(() {
      _floats.add(_FloatText(
          id: id, pos: d.localPosition, text: '+${formatNumber(gained)}'));
    });
    Future.delayed(const Duration(milliseconds: 900), () {
      if (!mounted) return;
      setState(() => _floats.removeWhere((f) => f.id == id));
    });
  }

  void _boost() {
    if (state.boostActive) return;
    widget.ads.showRewarded(onReward: () {
      state.activateBoost();
      _snack('¡Boost x3 activado durante 4 horas!');
    });
  }

  Future<void> _share() async {
    try {
      await SharePlus.instance.share(ShareParams(
        text: 'Mi jardín bioluminiscente en Lumen brilla con '
            '${formatNumber(state.lps)}/s de luz 🌊✨ #LumenGame',
      ));
    } catch (_) {}
  }

  void _snack(String msg) {
    if (!mounted) return;
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(content: Text(msg)));
  }

  void _confirmReset() {
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: Palette.panel,
        title: const Text('¿Reiniciar todo?',
            style: TextStyle(color: Palette.textHi)),
        content: const Text(
          'Borra TODO el progreso, incluidas las esporas. No se puede deshacer.',
          style: TextStyle(color: Palette.textLo),
        ),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(ctx),
              child: const Text('Cancelar')),
          TextButton(
            onPressed: () async {
              final nav = Navigator.of(ctx);
              final messenger = ScaffoldMessenger.of(context);
              await widget.save.wipe();
              nav.pop();
              messenger
                ..hideCurrentSnackBar()
                ..showSnackBar(const SnackBar(
                    content: Text('Progreso reiniciado. Reabre la app.')));
            },
            child: const Text('Borrar', style: TextStyle(color: Palette.magenta)),
          ),
        ],
      ),
    );
  }

  // ---- Construcción ----

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Column(
        children: [
          Expanded(
            child: Stack(
              children: [
                Positioned.fill(child: GameWidget(game: _game)),
                Positioned.fill(
                  child: GestureDetector(
                    behavior: HitTestBehavior.opaque,
                    onTapDown: _onTapGarden,
                  ),
                ),
                // Textos flotantes de recolección.
                ..._floats.map((f) => _FloatWidget(key: ValueKey(f.id), data: f)),
                // HUD superior.
                Positioned(top: 0, left: 0, right: 0, child: _Hud(state: state)),
                // Botones de acción a la derecha.
                Positioned(
                  right: 12,
                  bottom: 12,
                  child: _ActionRail(
                    state: state,
                    onBoost: _boost,
                    onPrestige: () =>
                        showPrestigeDialog(context, state: state, ads: widget.ads),
                    onShare: _share,
                    onReset: _confirmReset,
                  ),
                ),
                // Pista de toque.
                const Positioned(
                  bottom: 12,
                  left: 16,
                  child: Text('Toca el agua para recolectar',
                      style: TextStyle(color: Palette.textLo, fontSize: 12)),
                ),
              ],
            ),
          ),
          // Tienda inferior.
          Container(
            height: MediaQuery.of(context).size.height * 0.40,
            decoration: const BoxDecoration(
              color: Palette.abyss,
              border: Border(top: BorderSide(color: Palette.line)),
            ),
            child: Column(
              children: [
                Container(
                  width: 44,
                  height: 4,
                  margin: const EdgeInsets.only(top: 8, bottom: 2),
                  decoration: BoxDecoration(
                    color: Palette.textLo,
                    borderRadius: BorderRadius.circular(4),
                  ),
                ),
                Expanded(child: ShopSheet(state: state)),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

// ---------- HUD ----------

class _Hud extends StatelessWidget {
  const _Hud({required this.state});
  final GameState state;

  @override
  Widget build(BuildContext context) {
    final pad = MediaQuery.of(context).padding.top;
    return ListenableBuilder(
      listenable: state,
      builder: (context, _) {
        return Container(
          padding: EdgeInsets.fromLTRB(18, pad + 10, 18, 12),
          decoration: BoxDecoration(
            gradient: LinearGradient(
              begin: Alignment.topCenter,
              end: Alignment.bottomCenter,
              colors: [Palette.abyss.withValues(alpha: 0.85), Colors.transparent],
            ),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Text(formatNumber(state.lumens),
                      style: const TextStyle(
                          color: Palette.textHi,
                          fontSize: 40,
                          fontWeight: FontWeight.w800,
                          height: 1)),
                  const SizedBox(width: 6),
                  const Padding(
                    padding: EdgeInsets.only(bottom: 6),
                    child: Text('lumens',
                        style: TextStyle(color: Palette.textLo, fontSize: 14)),
                  ),
                ],
              ),
              const SizedBox(height: 2),
              Row(
                children: [
                  Text(formatRate(state.lps),
                      style: const TextStyle(
                          color: Palette.cyan,
                          fontSize: 15,
                          fontWeight: FontWeight.w700)),
                  const SizedBox(width: 12),
                  if (state.spores > 0)
                    _Chip(
                      icon: Icons.local_florist,
                      color: Palette.magenta,
                      label: 'x${state.globalMultiplier.toStringAsFixed(2)}',
                    ),
                  if (state.boostActive) ...[
                    const SizedBox(width: 8),
                    _Chip(
                      icon: Icons.bolt,
                      color: Palette.amber,
                      label: 'x3 ${formatDuration(state.boostRemaining)}',
                    ),
                  ],
                ],
              ),
            ],
          ),
        );
      },
    );
  }
}

class _Chip extends StatelessWidget {
  const _Chip({required this.icon, required this.color, required this.label});
  final IconData icon;
  final Color color;
  final String label;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.16),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: color.withValues(alpha: 0.4)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 14, color: color),
          const SizedBox(width: 4),
          Text(label,
              style: TextStyle(
                  color: color, fontWeight: FontWeight.w800, fontSize: 12)),
        ],
      ),
    );
  }
}

// ---------- Botones de acción ----------

class _ActionRail extends StatelessWidget {
  const _ActionRail({
    required this.state,
    required this.onBoost,
    required this.onPrestige,
    required this.onShare,
    required this.onReset,
  });

  final GameState state;
  final VoidCallback onBoost;
  final VoidCallback onPrestige;
  final VoidCallback onShare;
  final VoidCallback onReset;

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: state,
      builder: (context, _) {
        return Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (state.canPrestige)
              _RailButton(
                icon: Icons.local_florist,
                color: Palette.magenta,
                tooltip: 'Florecer',
                onTap: onPrestige,
              ),
            _RailButton(
              icon: Icons.bolt,
              color: state.boostActive ? Palette.textLo : Palette.amber,
              tooltip: 'Boost x3 (anuncio)',
              onTap: onBoost,
            ),
            _RailButton(
              icon: Icons.ios_share,
              color: Palette.cyan,
              tooltip: 'Compartir',
              onTap: onShare,
            ),
            _RailButton(
              icon: Icons.restart_alt,
              color: Palette.textLo,
              tooltip: 'Reiniciar',
              onTap: onReset,
            ),
          ],
        );
      },
    );
  }
}

class _RailButton extends StatelessWidget {
  const _RailButton({
    required this.icon,
    required this.color,
    required this.tooltip,
    required this.onTap,
  });
  final IconData icon;
  final Color color;
  final String tooltip;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(top: 10),
      child: Tooltip(
        message: tooltip,
        child: Material(
          color: Palette.panel,
          shape: CircleBorder(side: BorderSide(color: color.withValues(alpha: 0.5))),
          child: InkWell(
            customBorder: const CircleBorder(),
            onTap: onTap,
            child: Container(
              width: 52,
              height: 52,
              alignment: Alignment.center,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                boxShadow: [
                  BoxShadow(color: color.withValues(alpha: 0.3), blurRadius: 14),
                ],
              ),
              child: Icon(icon, color: color),
            ),
          ),
        ),
      ),
    );
  }
}

// ---------- Texto flotante al recolectar ----------

class _FloatText {
  _FloatText({required this.id, required this.pos, required this.text});
  final int id;
  final Offset pos;
  final String text;
}

class _FloatWidget extends StatelessWidget {
  const _FloatWidget({super.key, required this.data});
  final _FloatText data;

  @override
  Widget build(BuildContext context) {
    return TweenAnimationBuilder<double>(
      tween: Tween(begin: 0, end: 1),
      duration: const Duration(milliseconds: 900),
      builder: (context, t, child) {
        return Positioned(
          left: data.pos.dx - 20,
          top: data.pos.dy - 20 - t * 46,
          child: Opacity(
            opacity: (1 - t).clamp(0.0, 1.0),
            child: Text(
              data.text,
              style: TextStyle(
                color: Palette.cyan,
                fontSize: 18 + t * 6,
                fontWeight: FontWeight.w800,
                shadows: const [Shadow(color: Palette.cyan, blurRadius: 12)],
              ),
            ),
          ),
        );
      },
    );
  }
}
