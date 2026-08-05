import 'dart:convert';
import 'dart:math' as math;
import 'package:flutter/foundation.dart';
import '../core/balance.dart';

/// Estado y economía del juego. Pura lógica (sin Flutter widgets ni Flame),
/// para poder testearla y razonarla por separado.
class GameState extends ChangeNotifier {
  double lumens = 0;
  double earnedThisRun = 0; // para calcular esporas de floración
  double lifetimeTotal = 0; // total histórico (desbloquea zonas)
  double spores = 0; // moneda de prestigio permanente
  int blooms = 0; // nº de floraciones hechas

  final Map<String, int> counts = {for (final o in kOrganisms) o.id: 0};

  int? boostEndMs; // fin del boost x3 (epoch ms) o null
  int streak = 0; // racha de días
  int? lastDailyDay; // día (epoch/86400000) en que se reclamó la diaria
  int lastSavedMs = DateTime.now().millisecondsSinceEpoch;

  // ---- Derivados ----

  double get globalMultiplier => 1 + spores * Balance.prestigeBonusPerSpore;

  bool get boostActive =>
      boostEndMs != null && DateTime.now().millisecondsSinceEpoch < boostEndMs!;

  Duration get boostRemaining {
    if (!boostActive) return Duration.zero;
    return Duration(
        milliseconds: boostEndMs! - DateTime.now().millisecondsSinceEpoch);
  }

  /// Producción por segundo SIN boost (base * multiplicador de prestigio).
  double get baseLps {
    double sum = 0;
    for (final o in kOrganisms) {
      sum += (counts[o.id] ?? 0) * o.baseProd;
    }
    return sum * globalMultiplier;
  }

  /// Producción por segundo real (aplica boost si está activo).
  double get lps => baseLps * (boostActive ? Balance.boostMultiplier : 1);

  /// Valor de un toque manual.
  double get tapValue =>
      Balance.baseTapValue + lps * Balance.tapLpsFraction;

  /// Coste del siguiente ejemplar de [def].
  double costOf(OrganismDef def) =>
      def.baseCost * math.pow(Balance.costGrowth, counts[def.id] ?? 0);

  bool canAfford(OrganismDef def) => lumens >= costOf(def);

  /// Índice de la zona más profunda desbloqueada (por total histórico).
  int get maxZoneUnlocked {
    int z = 0;
    for (final zone in kZones) {
      if (lifetimeTotal >= zone.unlockAtLifetime) z = zone.index;
    }
    return z;
  }

  bool zoneUnlocked(int index) => index <= maxZoneUnlocked;

  /// Esporas que se ganarían al florecer ahora.
  int get sporesAvailable =>
      math.sqrt(earnedThisRun / Balance.prestigeDivisor).floor();

  bool get canPrestige => sporesAvailable >= Balance.prestigeMinSpores;

  // ---- Acciones ----

  void _earn(double amount) {
    lumens += amount;
    earnedThisRun += amount;
    lifetimeTotal += amount;
  }

  /// Avance del tiempo (segundos). Suma la producción automática.
  void tick(double dt) {
    if (dt <= 0) return;
    final gain = lps * dt;
    if (gain > 0) {
      _earn(gain);
      notifyListeners();
    }
  }

  /// Toque manual del jugador.
  double tap() {
    final v = tapValue;
    _earn(v);
    notifyListeners();
    return v;
  }

  /// Compra un ejemplar de [def]. Devuelve true si se pudo.
  bool buy(OrganismDef def) {
    if (!zoneUnlocked(def.zone)) return false;
    final cost = costOf(def);
    if (lumens < cost) return false;
    lumens -= cost;
    counts[def.id] = (counts[def.id] ?? 0) + 1;
    notifyListeners();
    return true;
  }

  /// Añade lumens directamente (recompensas, offline, etc.).
  void addLumens(double amount) {
    if (amount <= 0) return;
    _earn(amount);
    notifyListeners();
  }

  /// Concede esporas extra (recompensa por vídeo al florecer).
  void addBonusSpores(int n) {
    if (n <= 0) return;
    spores += n;
    notifyListeners();
  }

  /// Activa el boost x3 durante [Balance.boostDuration].
  void activateBoost() {
    final now = DateTime.now().millisecondsSinceEpoch;
    final base = boostActive ? boostEndMs! : now;
    boostEndMs = base + Balance.boostDuration.inMilliseconds;
    notifyListeners();
  }

  /// Floración (prestigio): reinicia progreso a cambio de esporas.
  int prestige() {
    final gained = sporesAvailable;
    if (gained < Balance.prestigeMinSpores) return 0;
    spores += gained;
    blooms += 1;
    lumens = 0;
    earnedThisRun = 0;
    for (final k in counts.keys) {
      counts[k] = 0;
    }
    boostEndMs = null;
    notifyListeners();
    return gained;
  }

  // ---- Ganancias offline ----

  /// Calcula lo generado mientras la app estuvo cerrada (sin sumarlo aún).
  /// Devuelve (cantidad, duraciónReal). Aplica tope y eficiencia.
  ({double amount, Duration elapsed}) computeOffline(DateTime now) {
    final elapsedMs = now.millisecondsSinceEpoch - lastSavedMs;
    if (elapsedMs <= 0) return (amount: 0, elapsed: Duration.zero);
    var elapsed = Duration(milliseconds: elapsedMs);
    final capped = elapsed > Balance.offlineCap ? Balance.offlineCap : elapsed;
    final amount = baseLps * Balance.offlineEfficiency * capped.inSeconds;
    return (amount: amount, elapsed: elapsed);
  }

  // ---- Recompensa diaria ----

  static int _dayOf(DateTime t) => t.millisecondsSinceEpoch ~/ 86400000;

  /// ¿Se puede reclamar la diaria hoy?
  bool dailyAvailable(DateTime now) => lastDailyDay != _dayOf(now);

  /// Reclama la diaria. Devuelve (lumens, díaDeRacha). 0 si ya reclamada.
  ({double reward, int day}) claimDaily(DateTime now) {
    final today = _dayOf(now);
    if (lastDailyDay == today) return (reward: 0, day: streak);
    // Racha: +1 si fue ayer; reinicia si se saltó un día.
    if (lastDailyDay != null && today - lastDailyDay! == 1) {
      streak = math.min(streak + 1, Balance.dailyStreakMax);
    } else {
      streak = 1;
    }
    lastDailyDay = today;
    final reward = math.max(baseLps, 1) *
        Balance.dailyRewardSeconds *
        (1 + (streak - 1) * 0.5);
    addLumens(reward);
    return (reward: reward, day: streak);
  }

  // ---- Serialización ----

  Map<String, dynamic> toJson() => {
        'lumens': lumens,
        'earnedThisRun': earnedThisRun,
        'lifetimeTotal': lifetimeTotal,
        'spores': spores,
        'blooms': blooms,
        'counts': counts,
        'boostEndMs': boostEndMs,
        'streak': streak,
        'lastDailyDay': lastDailyDay,
        'lastSavedMs': DateTime.now().millisecondsSinceEpoch,
      };

  String encode() => jsonEncode(toJson());

  void loadFromJson(Map<String, dynamic> j) {
    lumens = (j['lumens'] as num?)?.toDouble() ?? 0;
    earnedThisRun = (j['earnedThisRun'] as num?)?.toDouble() ?? 0;
    lifetimeTotal = (j['lifetimeTotal'] as num?)?.toDouble() ?? 0;
    spores = (j['spores'] as num?)?.toDouble() ?? 0;
    blooms = (j['blooms'] as num?)?.toInt() ?? 0;
    final c = j['counts'];
    if (c is Map) {
      for (final o in kOrganisms) {
        counts[o.id] = (c[o.id] as num?)?.toInt() ?? 0;
      }
    }
    boostEndMs = (j['boostEndMs'] as num?)?.toInt();
    streak = (j['streak'] as num?)?.toInt() ?? 0;
    lastDailyDay = (j['lastDailyDay'] as num?)?.toInt();
    lastSavedMs =
        (j['lastSavedMs'] as num?)?.toInt() ?? DateTime.now().millisecondsSinceEpoch;
  }

  void loadFromString(String? s) {
    if (s == null || s.isEmpty) return;
    try {
      loadFromJson(jsonDecode(s) as Map<String, dynamic>);
    } catch (_) {
      // Guardado corrupto: empezar de cero sin romper.
    }
  }
}
