import 'package:flutter_test/flutter_test.dart';
import 'package:lumen/core/balance.dart';
import 'package:lumen/core/format.dart';
import 'package:lumen/state/game_state.dart';

void main() {
  test('formato de números grandes', () {
    expect(formatNumber(999), '999');
    expect(formatNumber(1500), '1.50K');
    expect(formatNumber(2.5e6), '2.50M');
    expect(formatNumber(3.4e9), '3.40B');
  });

  test('comprar escala el coste x1.15', () {
    final s = GameState();
    final plancton = kOrganisms.firstWhere((o) => o.id == 'plancton');
    final c0 = s.costOf(plancton);
    s.lumens = 1e9;
    s.buy(plancton);
    final c1 = s.costOf(plancton);
    expect((c1 / c0), closeTo(Balance.costGrowth, 1e-9));
    expect(s.counts['plancton'], 1);
  });

  test('la producción crece al comprar', () {
    final s = GameState();
    expect(s.baseLps, 0);
    s.lumens = 1e9;
    s.buy(kOrganisms.first);
    expect(s.baseLps, greaterThan(0));
  });

  test('prestigio da esporas y reinicia', () {
    final s = GameState();
    s.earnedThisRun = 4e6; // sqrt(4) = 2 esporas
    expect(s.sporesAvailable, 2);
    final gained = s.prestige();
    expect(gained, 2);
    expect(s.spores, 2);
    expect(s.lumens, 0);
    expect(s.globalMultiplier, greaterThan(1));
  });

  test('serialización ida y vuelta', () {
    final s = GameState();
    s.lumens = 1234;
    s.spores = 3;
    s.counts['coral'] = 5;
    final encoded = s.encode();
    final s2 = GameState()..loadFromString(encoded);
    expect(s2.lumens, 1234);
    expect(s2.spores, 3);
    expect(s2.counts['coral'], 5);
  });
}
