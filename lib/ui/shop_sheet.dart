import 'package:flutter/material.dart';
import '../core/balance.dart';
import '../core/format.dart';
import '../core/palette.dart';
import '../state/game_state.dart';

/// Lista de organismos: comprar nuevos y mejorar (más ejemplares) los que ya
/// tienes. Las zonas aún bloqueadas se muestran atenuadas con su requisito.
class ShopSheet extends StatelessWidget {
  const ShopSheet({super.key, required this.state});
  final GameState state;

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: state,
      builder: (context, _) {
        final maxZone = state.maxZoneUnlocked;
        final items = <Widget>[];
        for (final zone in kZones) {
          if (zone.index > maxZone) {
            items.add(_LockedZone(zone: zone, state: state));
            break; // solo mostramos la siguiente bloqueada
          }
          items.add(_ZoneHeader(zone: zone));
          for (final o in kOrganisms.where((o) => o.zone == zone.index)) {
            items.add(_OrganismTile(state: state, def: o));
          }
        }
        return ListView(
          padding: const EdgeInsets.fromLTRB(12, 8, 12, 20),
          children: items,
        );
      },
    );
  }
}

class _ZoneHeader extends StatelessWidget {
  const _ZoneHeader({required this.zone});
  final ZoneDef zone;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(4, 14, 4, 6),
      child: Row(
        children: [
          Container(width: 8, height: 8, decoration: BoxDecoration(
              shape: BoxShape.circle, color: Palette.cyan.withValues(alpha: 0.8))),
          const SizedBox(width: 8),
          Text(zone.name.toUpperCase(),
              style: const TextStyle(
                  color: Palette.textHi,
                  fontWeight: FontWeight.w800,
                  letterSpacing: 1.2,
                  fontSize: 12)),
          const SizedBox(width: 8),
          Expanded(
            child: Text(zone.subtitle,
                style: const TextStyle(color: Palette.textLo, fontSize: 11)),
          ),
        ],
      ),
    );
  }
}

class _LockedZone extends StatelessWidget {
  const _LockedZone({required this.zone, required this.state});
  final ZoneDef zone;
  final GameState state;

  @override
  Widget build(BuildContext context) {
    final falta = zone.unlockAtLifetime - state.lifetimeTotal;
    return Container(
      margin: const EdgeInsets.only(top: 14),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Palette.panel,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: Palette.line),
      ),
      child: Row(
        children: [
          const Icon(Icons.lock_outline, color: Palette.textLo),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Próxima zona: ${zone.name}',
                    style: const TextStyle(
                        color: Palette.textHi, fontWeight: FontWeight.w700)),
                const SizedBox(height: 4),
                Text(
                  'Genera ${formatNumber(falta.clamp(0, double.infinity))} lumens más para desbloquear',
                  style: const TextStyle(color: Palette.textLo, fontSize: 12),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _OrganismTile extends StatelessWidget {
  const _OrganismTile({required this.state, required this.def});
  final GameState state;
  final OrganismDef def;

  @override
  Widget build(BuildContext context) {
    final count = state.counts[def.id] ?? 0;
    final cost = state.costOf(def);
    final afford = state.canAfford(def);
    final prod = def.baseProd * state.globalMultiplier;

    return Container(
      margin: const EdgeInsets.symmetric(vertical: 5),
      decoration: BoxDecoration(
        color: Palette.panel,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: def.color.withValues(alpha: 0.25)),
      ),
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          borderRadius: BorderRadius.circular(14),
          onTap: afford ? () => state.buy(def) : null,
          child: Padding(
            padding: const EdgeInsets.all(12),
            child: Row(
              children: [
                _Bulb(color: def.color),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Flexible(
                            child: Text(def.name,
                                style: const TextStyle(
                                    color: Palette.textHi,
                                    fontWeight: FontWeight.w700)),
                          ),
                          if (count > 0) ...[
                            const SizedBox(width: 8),
                            Container(
                              padding: const EdgeInsets.symmetric(
                                  horizontal: 8, vertical: 2),
                              decoration: BoxDecoration(
                                color: def.color.withValues(alpha: 0.16),
                                borderRadius: BorderRadius.circular(20),
                              ),
                              child: Text('x$count',
                                  style: TextStyle(
                                      color: def.color,
                                      fontWeight: FontWeight.w800,
                                      fontSize: 12)),
                            ),
                          ],
                        ],
                      ),
                      const SizedBox(height: 2),
                      Text('${formatRate(prod)} cada uno',
                          style: const TextStyle(
                              color: Palette.textLo, fontSize: 12)),
                    ],
                  ),
                ),
                const SizedBox(width: 8),
                Column(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    Container(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 12, vertical: 8),
                      decoration: BoxDecoration(
                        color: afford
                            ? def.color.withValues(alpha: 0.9)
                            : Palette.panelHi,
                        borderRadius: BorderRadius.circular(10),
                      ),
                      child: Text(
                        formatNumber(cost),
                        style: TextStyle(
                          color: afford ? Palette.abyss : Palette.textLo,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                    ),
                    const SizedBox(height: 3),
                    const Text('lumens',
                        style: TextStyle(color: Palette.textLo, fontSize: 10)),
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _Bulb extends StatelessWidget {
  const _Bulb({required this.color});
  final Color color;
  @override
  Widget build(BuildContext context) {
    return Container(
      width: 40,
      height: 40,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        gradient: RadialGradient(colors: [
          Color.lerp(color, Colors.white, 0.6)!,
          color,
        ]),
        boxShadow: [BoxShadow(color: color.withValues(alpha: 0.7), blurRadius: 16)],
      ),
    );
  }
}
