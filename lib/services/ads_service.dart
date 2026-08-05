import 'dart:io' show Platform;
import 'package:flutter/foundation.dart';
import 'package:google_mobile_ads/google_mobile_ads.dart';
import '../core/balance.dart';

/// Envoltorio de AdMob (google_mobile_ads).
///
/// ⚠️ IMPORTANTE: usa los IDs DE PRUEBA de Google. Antes de publicar,
/// sustitúyelos por los tuyos reales de AdMob (ver TODO(ads) más abajo)
/// y cambia también el App ID en:
///   - android/app/src/main/AndroidManifest.xml (meta-data APPLICATION_ID)
///   - ios/Runner/Info.plist (GADApplicationIdentifier)
class AdsService {
  AdsService();

  bool _initialized = false;
  RewardedAd? _rewarded;
  InterstitialAd? _interstitial;
  DateTime _lastInterstitial =
      DateTime.fromMillisecondsSinceEpoch(0);

  bool get supported {
    if (kIsWeb) return false;
    return Platform.isAndroid || Platform.isIOS;
  }

  // --- IDs de prueba oficiales de Google ---
  // TODO(ads): reemplaza por tus unidades reales de AdMob al publicar.
  static String get _rewardedUnitId {
    if (kIsWeb) return '';
    return Platform.isAndroid
        ? 'ca-app-pub-3940256099942544/5224354917' // Android test rewarded
        : 'ca-app-pub-3940256099942544/1712485313'; // iOS test rewarded
  }

  static String get _interstitialUnitId {
    if (kIsWeb) return '';
    return Platform.isAndroid
        ? 'ca-app-pub-3940256099942544/1033173712' // Android test interstitial
        : 'ca-app-pub-3940256099942544/4411468910'; // iOS test interstitial
  }

  Future<void> init() async {
    if (!supported || _initialized) return;
    try {
      await MobileAds.instance.initialize();
      _initialized = true;
      _loadRewarded();
      _loadInterstitial();
    } catch (e) {
      debugPrint('AdsService init falló: $e');
    }
  }

  // ---------- Recompensado ----------

  void _loadRewarded() {
    if (!_initialized) return;
    RewardedAd.load(
      adUnitId: _rewardedUnitId,
      request: const AdRequest(),
      rewardedAdLoadCallback: RewardedAdLoadCallback(
        onAdLoaded: (ad) => _rewarded = ad,
        onAdFailedToLoad: (err) {
          _rewarded = null;
          debugPrint('Rewarded no cargó: $err');
        },
      ),
    );
  }

  /// Muestra un vídeo recompensado. Llama a [onReward] SOLO si el usuario
  /// completa el vídeo. Si no hay anuncio disponible, [onReward] se llama
  /// igualmente para no bloquear la recompensa durante el desarrollo.
  /// TODO(ads): en producción quizá quieras exigir el vídeo de verdad.
  void showRewarded({required VoidCallback onReward}) {
    if (!supported || _rewarded == null) {
      onReward(); // sin anuncio disponible: concede igual (modo prueba)
      return;
    }
    final ad = _rewarded!;
    _rewarded = null;
    var rewarded = false;
    ad.fullScreenContentCallback = FullScreenContentCallback(
      onAdDismissedFullScreenContent: (ad) {
        ad.dispose();
        _loadRewarded();
        if (!rewarded) {
          // El usuario cerró antes de completar: no se recompensa.
        }
      },
      onAdFailedToShowFullScreenContent: (ad, err) {
        ad.dispose();
        _loadRewarded();
        onReward();
      },
    );
    ad.show(onUserEarnedReward: (ad, reward) {
      rewarded = true;
      onReward();
    });
  }

  // ---------- Intersticial ----------

  void _loadInterstitial() {
    if (!_initialized) return;
    InterstitialAd.load(
      adUnitId: _interstitialUnitId,
      request: const AdRequest(),
      adLoadCallback: InterstitialAdLoadCallback(
        onAdLoaded: (ad) => _interstitial = ad,
        onAdFailedToLoad: (err) {
          _interstitial = null;
          debugPrint('Interstitial no cargó: $err');
        },
      ),
    );
  }

  /// Muestra un intersticial respetando el hueco mínimo entre ellos.
  /// Devuelve true si se mostró.
  bool maybeShowInterstitial() {
    if (!supported || _interstitial == null) return false;
    final now = DateTime.now();
    if (now.difference(_lastInterstitial) < Balance.interstitialMinGap) {
      return false;
    }
    _lastInterstitial = now;
    final ad = _interstitial!;
    _interstitial = null;
    ad.fullScreenContentCallback = FullScreenContentCallback(
      onAdDismissedFullScreenContent: (ad) {
        ad.dispose();
        _loadInterstitial();
      },
      onAdFailedToShowFullScreenContent: (ad, err) {
        ad.dispose();
        _loadInterstitial();
      },
    );
    ad.show();
    return true;
  }

  void dispose() {
    _rewarded?.dispose();
    _interstitial?.dispose();
  }
}
