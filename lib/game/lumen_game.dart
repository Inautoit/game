import 'dart:math' as math;
import 'dart:ui';
import 'package:flame/components.dart';
import 'package:flame/game.dart';
import 'package:flutter/material.dart' show Colors;
import '../core/balance.dart';
import '../state/game_state.dart';

/// El juego Flame: dibuja el jardín bioluminiscente de forma 100% procedural
/// (nodos y filamentos que brillan sobre fondo oscuro). Lee del [GameState].
class LumenGame extends FlameGame {
  LumenGame(this.state);
  final GameState state;

  final List<Ripple> ripples = [];

  @override
  Color backgroundColor() => const Color(0xFF03060f);

  @override
  Future<void> onLoad() async {
    add(_Garden());
  }

  @override
  void update(double dt) {
    super.update(dt);
    // El bucle idle: la producción automática avanza con el tiempo del juego.
    state.tick(dt);
  }

  /// Onda de luz al tocar el jardín.
  void poke(Vector2 pos) {
    ripples.add(Ripple(pos.clone()));
    if (ripples.length > 12) ripples.removeAt(0);
  }
}

class Ripple {
  Ripple(this.pos);
  final Vector2 pos;
  double age = 0;
}

class _Node {
  _Node(this.base, this.color, this.phase, this.radius, this.speed);
  final Vector2 base; // posición en fracción 0..1 de la pantalla
  final Color color;
  final double phase;
  final double radius;
  final double speed;
  final Vector2 drift = Vector2.zero();
}

class _Mote {
  _Mote(this.pos, this.vel, this.size, this.alpha);
  final Vector2 pos;
  final Vector2 vel;
  final double size;
  final double alpha;
}

/// Componente que pinta todo el jardín.
class _Garden extends Component with HasGameReference<LumenGame> {
  double _t = 0;
  String _sig = '';
  final List<_Node> _nodes = [];
  final List<_Mote> _motes = [];
  final math.Random _rnd = math.Random(7);

  static const int _maxNodes = 70;

  @override
  void onLoad() {
    _seedMotes();
  }

  void _seedMotes() {
    _motes.clear();
    for (int i = 0; i < 46; i++) {
      _motes.add(_Mote(
        Vector2(_rnd.nextDouble(), _rnd.nextDouble()),
        Vector2((_rnd.nextDouble() - 0.5) * 0.01, -0.005 - _rnd.nextDouble() * 0.01),
        0.6 + _rnd.nextDouble() * 1.8,
        0.06 + _rnd.nextDouble() * 0.12,
      ));
    }
  }

  /// Firma del estado que afecta al nº/color de nodos.
  String _stateSignature() {
    final b = StringBuffer();
    for (final o in kOrganisms) {
      b.write(game.state.counts[o.id] ?? 0);
      b.write(',');
    }
    return b.toString();
  }

  void _rebuildNodes() {
    _nodes.clear();
    final counts = game.state.counts;
    final total = kOrganisms.fold<int>(0, (s, o) => s + (counts[o.id] ?? 0));
    if (total == 0) return;

    // Reparte los nodos visibles proporcionalmente a lo que tienes.
    for (final o in kOrganisms) {
      final c = counts[o.id] ?? 0;
      if (c == 0) continue;
      final share = (c / total * _maxNodes).round().clamp(1, _maxNodes);
      // Banda vertical según la zona (someras arriba, abismo abajo).
      final zone = o.zone;
      final yTop = 0.16 + zone * 0.24;
      final yBot = (yTop + 0.30).clamp(0.0, 0.94);
      for (int i = 0; i < share && _nodes.length < _maxNodes; i++) {
        _nodes.add(_Node(
          Vector2(0.1 + _rnd.nextDouble() * 0.8,
              yTop + _rnd.nextDouble() * (yBot - yTop)),
          o.color,
          _rnd.nextDouble() * math.pi * 2,
          2.2 + _rnd.nextDouble() * 4.0,
          0.6 + _rnd.nextDouble() * 1.2,
        ));
      }
    }
  }

  @override
  void update(double dt) {
    _t += dt;

    final sig = _stateSignature();
    if (sig != _sig) {
      _sig = sig;
      _rnd.nextDouble(); // varía un poco el layout entre reconstrucciones
      _rebuildNodes();
    }

    // Deriva suave de los nodos.
    for (final n in _nodes) {
      n.drift
        ..x = math.sin(_t * n.speed * 0.5 + n.phase) * 0.012
        ..y = math.cos(_t * n.speed * 0.4 + n.phase) * 0.012;
    }

    // Partículas flotantes.
    for (final m in _motes) {
      m.pos.add(m.vel * dt);
      if (m.pos.y < -0.02) {
        m.pos.y = 1.02;
        m.pos.x = _rnd.nextDouble();
      }
      if (m.pos.x < -0.02) m.pos.x = 1.02;
      if (m.pos.x > 1.02) m.pos.x = -0.02;
    }

    // Ondas.
    for (final r in game.ripples) {
      r.age += dt;
    }
    game.ripples.removeWhere((r) => r.age > 1.2);
  }

  @override
  void render(Canvas canvas) {
    final size = game.size;
    final w = size.x, h = size.y;

    _paintBackground(canvas, w, h);
    _paintMotes(canvas, w, h);
    _paintFilaments(canvas, w, h);
    _paintNodes(canvas, w, h);
    _paintRipples(canvas);
  }

  void _paintBackground(Canvas canvas, double w, double h) {
    final zone = kZones[game.state.maxZoneUnlocked.clamp(0, kZones.length - 1)];
    final top = Color.lerp(const Color(0xFF07131f), zone.tint, 0.5)!;
    final rect = Rect.fromLTWH(0, 0, w, h);
    final paint = Paint()
      ..shader = Gradient.linear(
        Offset(w / 2, 0),
        Offset(w / 2, h),
        [top, const Color(0xFF01030a)],
        [0.0, 1.0],
      );
    canvas.drawRect(rect, paint);

    // Halo tenue de "luz que baja".
    final glow = Paint()
      ..shader = Gradient.radial(
        Offset(w * 0.5, -h * 0.1), h * 0.9,
        [zone.tint.withValues(alpha: 0.25), const Color(0x00000000)],
      );
    canvas.drawRect(rect, glow);
  }

  void _paintMotes(Canvas canvas, double w, double h) {
    for (final m in _motes) {
      final p = Paint()..color = Colors.white.withValues(alpha: m.alpha);
      canvas.drawCircle(Offset(m.pos.x * w, m.pos.y * h), m.size, p);
    }
  }

  void _paintFilaments(Canvas canvas, double w, double h) {
    for (int i = 1; i < _nodes.length; i++) {
      final a = _nodes[i - 1];
      final b = _nodes[i];
      if (a.color != b.color) continue; // solo une del mismo organismo
      final pa = Offset((a.base.x + a.drift.x) * w, (a.base.y + a.drift.y) * h);
      final pb = Offset((b.base.x + b.drift.x) * w, (b.base.y + b.drift.y) * h);
      if ((pa - pb).distance > h * 0.22) continue; // evita líneas largas feas
      final paint = Paint()
        ..color = a.color.withValues(alpha: 0.14)
        ..strokeWidth = 1.2;
      canvas.drawLine(pa, pb, paint);
    }
  }

  void _paintNodes(Canvas canvas, double w, double h) {
    for (final n in _nodes) {
      final pulse = 0.75 + 0.25 * math.sin(_t * n.speed + n.phase);
      final r = n.radius * pulse;
      final cx = (n.base.x + n.drift.x) * w;
      final cy = (n.base.y + n.drift.y) * h;
      final center = Offset(cx, cy);

      // Halo (glow) con desenfoque.
      final glow = Paint()
        ..color = n.color.withValues(alpha: 0.5)
        ..maskFilter = MaskFilter.blur(BlurStyle.normal, r * 2.2);
      canvas.drawCircle(center, r * 2.4, glow);

      // Núcleo brillante.
      final core = Paint()..color = Color.lerp(n.color, Colors.white, 0.5)!;
      canvas.drawCircle(center, r * 0.6, core);
      final mid = Paint()..color = n.color.withValues(alpha: 0.9);
      canvas.drawCircle(center, r, mid);
    }
  }

  void _paintRipples(Canvas canvas) {
    for (final r in game.ripples) {
      final t = (r.age / 1.2).clamp(0.0, 1.0);
      final radius = 8 + t * 90;
      final paint = Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = 2.5 * (1 - t)
        ..color = const Color(0xFF9be8ff).withValues(alpha: (1 - t) * 0.6);
      canvas.drawCircle(Offset(r.pos.x, r.pos.y), radius, paint);
    }
  }
}
