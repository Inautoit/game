import 'package:flutter/material.dart';

/// Balanceo del juego. TODO(balance): ajusta aquí toda la economía.
/// Casi todo el "feel" del idle se controla desde este archivo.
class Balance {
  // --- Economía base ---
  static const double costGrowth = 1.15; // coste x1.15 por unidad comprada
  static const double baseTapValue = 1.0; // lumens por toque (mínimo)
  static const double tapLpsFraction = 0.05; // + 5% de la producción/seg por toque

  // --- Prestigio ("Floración") ---
  // Esporas ganadas = floor(sqrt(lumensDeVidaEstaRonda / prestigeDivisor)).
  static const double prestigeDivisor = 1e6;
  // Multiplicador global = 1 + esporasTotales * prestigeBonusPerSpore.
  static const double prestigeBonusPerSpore = 0.05; // +5% por espora
  // Mínimo de esporas para permitir florecer.
  static const int prestigeMinSpores = 1;

  // --- Ganancias offline ---
  static const Duration offlineCap = Duration(hours: 8); // tope de acumulación
  static const double offlineEfficiency = 0.5; // 50% de la producción activa

  // --- Boost por vídeo recompensado ---
  static const double boostMultiplier = 3.0;
  static const Duration boostDuration = Duration(hours: 4);

  // --- Recompensa diaria (racha) ---
  // Lumens = producción/seg * segundos equivalentes, escalado por día de racha.
  static const int dailyStreakMax = 7;
  static const double dailyRewardSeconds = 900; // ~15 min de producción base

  // --- Anuncios (frecuencia) ---
  // TODO(ads): sube/baja para molestar más o menos.
  static const Duration interstitialMinGap = Duration(minutes: 3);

  // --- Notificación local ---
  static const Duration notifyAfter = Duration(hours: 3);
}

/// Zonas de profundidad (biomas). Cada una se desbloquea al alcanzar cierto
/// total de lumens generados en la vida de la cuenta.
class ZoneDef {
  final int index;
  final String name;
  final String subtitle;
  final double unlockAtLifetime; // lumens de vida necesarios
  final Color tint;
  const ZoneDef(this.index, this.name, this.subtitle, this.unlockAtLifetime, this.tint);
}

const List<ZoneDef> kZones = [
  ZoneDef(0, 'Aguas someras', 'Donde la luz aún llega', 0, Color(0xFF0a3a4a)),
  ZoneDef(1, 'Zona crepuscular', 'La penumbra azul', 5.0e4, Color(0xFF0a2246)),
  ZoneDef(2, 'El abismo', 'Oscuridad total', 2.0e7, Color(0xFF140a2e)),
];

/// Definición estática de un organismo cultivable.
class OrganismDef {
  final String id;
  final String name;
  final String desc;
  final int zone;
  final double baseCost;
  final double baseProd; // lumens/seg por unidad
  final Color color; // color del brillo
  const OrganismDef({
    required this.id,
    required this.name,
    required this.desc,
    required this.zone,
    required this.baseCost,
    required this.baseProd,
    required this.color,
  });
}

/// Catálogo de organismos. TODO(balance): añade más o retoca costes/producción.
const List<OrganismDef> kOrganisms = [
  OrganismDef(
    id: 'plancton', name: 'Plancton lumínico', desc: 'Chispas que flotan en la corriente',
    zone: 0, baseCost: 15, baseProd: 0.1, color: Color(0xFF35e0ff),
  ),
  OrganismDef(
    id: 'coral', name: 'Coral fulgor', desc: 'Ramas que laten con luz verde',
    zone: 0, baseCost: 120, baseProd: 1.0, color: Color(0xFF48ffa0),
  ),
  OrganismDef(
    id: 'medusa', name: 'Medusa espectro', desc: 'Campanas de neón a la deriva',
    zone: 0, baseCost: 1500, baseProd: 8.0, color: Color(0xFFff4fd8),
  ),
  OrganismDef(
    id: 'anguila', name: 'Anguila de voltios', desc: 'Filamentos que crepitan',
    zone: 1, baseCost: 20000, baseProd: 55.0, color: Color(0xFF9b6bff),
  ),
  OrganismDef(
    id: 'rape', name: 'Rape abisal', desc: 'Su farol atrae la energía',
    zone: 1, baseCost: 260000, baseProd: 400.0, color: Color(0xFFffc24d),
  ),
  OrganismDef(
    id: 'chimenea', name: 'Chimenea negra', desc: 'Vida en torno al calor del fondo',
    zone: 2, baseCost: 4.2e6, baseProd: 3200.0, color: Color(0xFFff7a3d),
  ),
  OrganismDef(
    id: 'leviatan', name: 'Leviatán de luz', desc: 'Una constelación viviente',
    zone: 2, baseCost: 8.0e7, baseProd: 26000.0, color: Color(0xFF7dfcff),
  ),
];
