import 'package:flutter/material.dart';
import '../core/balance.dart';
import '../core/format.dart';
import '../core/palette.dart';
import '../services/ads_service.dart';
import '../state/game_state.dart';

/// Popup de ganancias offline con opción de x2 por vídeo recompensado.
Future<void> showOfflineDialog(
  BuildContext context, {
  required GameState state,
  required AdsService ads,
  required double amount,
  required Duration elapsed,
}) {
  return showDialog(
    context: context,
    barrierDismissible: false,
    builder: (ctx) => _GlowDialog(
      icon: Icons.nightlight_round,
      accent: Palette.cyan,
      title: 'Tu jardín siguió brillando',
      content: [
        Text('Estuviste fuera ${formatDuration(elapsed)}.',
            style: const TextStyle(color: Palette.textLo)),
        const SizedBox(height: 14),
        Text(formatNumber(amount),
            style: const TextStyle(
                color: Palette.cyan, fontSize: 34, fontWeight: FontWeight.w800)),
        const Text('lumens acumulados', style: TextStyle(color: Palette.textLo)),
      ],
      actions: [
        _DialogButton(
          label: 'Reclamar',
          onTap: () {
            state.addLumens(amount);
            Navigator.of(ctx).pop();
          },
        ),
        _DialogButton(
          label: 'Ver anuncio · x2',
          primary: true,
          icon: Icons.play_circle_fill,
          onTap: () {
            ads.showRewarded(onReward: () => state.addLumens(amount * 2));
            Navigator.of(ctx).pop();
          },
        ),
      ],
    ),
  );
}

/// Diálogo de floración (prestigio).
Future<void> showPrestigeDialog(
  BuildContext context, {
  required GameState state,
  required AdsService ads,
}) {
  final gained = state.sporesAvailable;
  final newMult =
      1 + (state.spores + gained) * Balance.prestigeBonusPerSpore;
  return showDialog(
    context: context,
    builder: (ctx) => _GlowDialog(
      icon: Icons.local_florist,
      accent: Palette.magenta,
      title: 'Floración',
      content: [
        const Text(
          'Reinicia tu jardín a cambio de esporas permanentes que multiplican '
          'toda tu producción para siempre.',
          style: TextStyle(color: Palette.textLo),
          textAlign: TextAlign.center,
        ),
        const SizedBox(height: 14),
        Text('+$gained esporas',
            style: const TextStyle(
                color: Palette.magenta,
                fontSize: 28,
                fontWeight: FontWeight.w800)),
        Text('Multiplicador: x${newMult.toStringAsFixed(2)}',
            style: const TextStyle(color: Palette.textLo)),
      ],
      actions: [
        _DialogButton(label: 'Ahora no', onTap: () => Navigator.of(ctx).pop()),
        _DialogButton(
          label: 'Florecer',
          primary: true,
          icon: Icons.local_florist,
          onTap: () {
            state.prestige();
            Navigator.of(ctx).pop();
          },
        ),
        _DialogButton(
          label: 'Anuncio · x2 esporas',
          icon: Icons.play_circle_fill,
          onTap: () {
            final g = state.prestige();
            if (g > 0) {
              ads.showRewarded(onReward: () => state.addBonusSpores(g));
            }
            Navigator.of(ctx).pop();
          },
        ),
      ],
    ),
  );
}

/// Diálogo de recompensa diaria (racha).
Future<void> showDailyDialog(
  BuildContext context, {
  required GameState state,
  required double reward,
  required int day,
}) {
  return showDialog(
    context: context,
    builder: (ctx) => _GlowDialog(
      icon: Icons.wb_sunny,
      accent: Palette.amber,
      title: 'Recompensa diaria',
      content: [
        Text('Día $day de racha 🔥',
            style: const TextStyle(color: Palette.textLo)),
        const SizedBox(height: 12),
        Text('+${formatNumber(reward)}',
            style: const TextStyle(
                color: Palette.amber,
                fontSize: 30,
                fontWeight: FontWeight.w800)),
        const Text('lumens', style: TextStyle(color: Palette.textLo)),
      ],
      actions: [
        _DialogButton(
          label: '¡Gracias!',
          primary: true,
          onTap: () => Navigator.of(ctx).pop(),
        ),
      ],
    ),
  );
}

// ---------- Widgets internos ----------

class _GlowDialog extends StatelessWidget {
  const _GlowDialog({
    required this.icon,
    required this.accent,
    required this.title,
    required this.content,
    required this.actions,
  });

  final IconData icon;
  final Color accent;
  final String title;
  final List<Widget> content;
  final List<Widget> actions;

  @override
  Widget build(BuildContext context) {
    return Dialog(
      backgroundColor: Palette.panel,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(22),
        side: BorderSide(color: accent.withValues(alpha: 0.4)),
      ),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(22, 24, 22, 16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 62,
              height: 62,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: accent.withValues(alpha: 0.14),
                boxShadow: [
                  BoxShadow(color: accent.withValues(alpha: 0.5), blurRadius: 24),
                ],
              ),
              child: Icon(icon, color: accent, size: 30),
            ),
            const SizedBox(height: 14),
            Text(title,
                style: const TextStyle(
                    color: Palette.textHi,
                    fontSize: 20,
                    fontWeight: FontWeight.w700)),
            const SizedBox(height: 10),
            ...content,
            const SizedBox(height: 20),
            Wrap(
              alignment: WrapAlignment.center,
              spacing: 10,
              runSpacing: 10,
              children: actions,
            ),
          ],
        ),
      ),
    );
  }
}

class _DialogButton extends StatelessWidget {
  const _DialogButton({
    required this.label,
    required this.onTap,
    this.primary = false,
    this.icon,
  });

  final String label;
  final VoidCallback onTap;
  final bool primary;
  final IconData? icon;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: primary ? Palette.cyan : Palette.panelHi,
      borderRadius: BorderRadius.circular(12),
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 11),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (icon != null) ...[
                Icon(icon,
                    size: 18,
                    color: primary ? Palette.abyss : Palette.textHi),
                const SizedBox(width: 6),
              ],
              Text(label,
                  style: TextStyle(
                    color: primary ? Palette.abyss : Palette.textHi,
                    fontWeight: FontWeight.w700,
                  )),
            ],
          ),
        ),
      ),
    );
  }
}
