# Lumen 🌊✨ — jardín bioluminiscente idle

Juego **idle / incremental** para móvil (iOS y Android) hecho con **Flutter +
Flame**, una sola base de código. Cultivas organismos que brillan en el fondo
del mar y generan **lumens** (energía de luz); con ellos compras y mejoras más
organismos, desbloqueas zonas más profundas y "floreces" (prestigio) para
multiplicar tu producción.

- Arte **100% procedural** (nodos y filamentos que brillan sobre fondo oscuro).
- **Offline** total: sin backend, guardado local.
- Monetización con **AdMob** (google_mobile_ads) — ahora con **IDs de prueba**.

> ⚠️ Este entorno no puede ejecutar apps móviles. El código está **analizado
> (`flutter analyze` sin errores) y con tests que pasan**, pero debes
> compilarlo y probarlo en tu equipo (o en la nube, p. ej. Codemagic).

---

## Requisitos

- **Flutter** (stable) 3.44 o superior · Dart 3.12+ → <https://docs.flutter.dev/get-started/install>
- **Android**: Android Studio + SDK (para `.aab`).
- **iOS**: **Mac con Xcode** + cuenta **Apple Developer** (obligatorio para `.ipa`),
  o un servicio en la nube como **Codemagic** / Bitrise si no tienes Mac.

Comprueba tu entorno con:

```bash
flutter doctor
```

---

## 1) Probarlo en tu móvil

```bash
flutter pub get           # instala dependencias
flutter devices           # comprueba que se ve tu móvil/emulador
flutter run               # compila e instala en modo debug
```

- **Android por USB**: activa *Opciones de desarrollador* → *Depuración USB*.
- **Android emulador**: créalo desde Android Studio (Device Manager).
- **iOS**: `flutter run` desde un Mac con un simulador o iPhone conectado.

Los anuncios saldrán como **anuncios de prueba** de Google (es lo correcto
durante el desarrollo; nunca toques anuncios reales tú mismo).

---

## 2) Generar el paquete de **Google Play** (`.aab`)

Play Store pide un **Android App Bundle** firmado.

**a. Crea tu keystore** (una sola vez, guárdalo a buen recaudo):

```bash
keytool -genkey -v -keystore ~/lumen-upload.jks \
  -keyalg RSA -keysize 2048 -validity 10000 -alias upload
```

**b. Crea `android/key.properties`** (NO se sube a git, ya está en `.gitignore`):

```properties
storePassword=TU_PASSWORD
keyPassword=TU_PASSWORD
keyAlias=upload
storeFile=/ruta/absoluta/a/lumen-upload.jks
```

La firma ya está cableada en `android/app/build.gradle.kts`: si existe
`key.properties`, se usa tu keystore automáticamente.

**c. Compila el bundle:**

```bash
flutter build appbundle --release
# Resultado: build/app/outputs/bundle/release/app-release.aab
```

Sube ese `.aab` en Play Console. (Recomendado: activa *Play App Signing*.)

---

## 3) Generar el paquete de **App Store** (`.ipa`)

Necesitas **Mac + Xcode + cuenta Apple Developer**. Sin Mac, usa Codemagic.

```bash
flutter build ipa --release
# Resultado: build/ios/ipa/*.ipa
```

Luego sube con **Xcode → Organizer** o **Transporter** a App Store Connect.
Si usas Codemagic: conecta este repo, elige el workflow de Flutter/iOS y añade
tu certificado + perfil de aprovisionamiento.

> Nota Apple: las apps que son "solo web envuelta" pueden rechazarse (regla
> 4.2); esta es una app nativa Flutter/Flame de verdad, así que no aplica.

---

## 4) Anuncios (AdMob) — pasar de PRUEBA a REAL

Ahora TODO usa los **IDs de prueba** oficiales de Google. Antes de publicar,
busca los `TODO(ads)` y cambia:

1. **Unidades de anuncio** en `lib/services/ads_service.dart`
   (`_rewardedUnitId`, `_interstitialUnitId`) por las tuyas de AdMob.
2. **App ID de AdMob**:
   - Android: `android/app/src/main/AndroidManifest.xml`
     (`com.google.android.gms.ads.APPLICATION_ID`).
   - iOS: `ios/Runner/Info.plist` (`GADApplicationIdentifier`).

Frecuencia y momentos de los anuncios: constantes en `lib/core/balance.dart`
(`interstitialMinGap`, `boostDuration`, etc.).

| Tipo | Cuándo |
|------|--------|
| **Recompensado** | x2 de ganancias offline · Boost x3 (4 h) · x2 esporas al florecer |
| **Intersticial** | Al desbloquear zona y tras florecer, con hueco mínimo entre ellos |

---

## 5) Estructura del proyecto

```
lib/
  main.dart                 Arranque: carga guardado, servicios y lanza la app
  core/
    balance.dart            ⚙️ TODO el balanceo: costes, prestigio, offline, ads, zonas, organismos
    format.dart             Formateo de números grandes (1.2K, 3.4M, …)
    palette.dart            Colores del juego
  state/
    game_state.dart         Economía: lumens, compra, producción, prestigio, offline, diaria (lógica pura)
  services/
    save_service.dart       Guardado local (shared_preferences)
    ads_service.dart        AdMob: recompensado + intersticial (IDs de prueba)
    notification_service.dart  Notificación local de re-enganche
  game/
    lumen_game.dart         Jardín bioluminiscente en Flame (render procedural)
  ui/
    game_screen.dart        Pantalla principal: HUD, jardín, tienda, botones, ciclo de vida
    shop_sheet.dart         Lista de organismos (comprar/mejorar) y zonas
    dialogs.dart            Diálogos: offline (x2), floración, diaria
test/
  widget_test.dart          Tests del núcleo (formato, compra, prestigio, guardado)
android/  ios/               Proyectos nativos (config de AdMob ya incluida)
```

### ¿Dónde ajusto el juego?

- **Balanceo / dificultad / economía** → `lib/core/balance.dart` y el catálogo
  `kOrganisms` / `kZones` en ese mismo archivo.
- **Anuncios** → `lib/services/ads_service.dart` (+ manifest / Info.plist).
- **Colores / estética** → `lib/core/palette.dart` y `lib/game/lumen_game.dart`.

---

## Comandos útiles

```bash
flutter analyze     # análisis estático (debe salir "No issues found")
flutter test        # tests del núcleo
flutter run         # ejecutar en debug
flutter clean       # limpiar artefactos si algo se atasca
```

## Estado / próximos pasos

MVP funcional: bucle idle, tap, compra con escalado x1.15, 7 organismos en 3
zonas, prestigio, ganancias offline con x2, recompensa diaria, boost x3,
notificación y compartir, con AdMob en modo prueba. Ideas siguientes:
iconos personalizados, más biomas, mejoras por organismo, logros y música.
