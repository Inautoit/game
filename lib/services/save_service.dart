import 'package:shared_preferences/shared_preferences.dart';
import '../state/game_state.dart';

/// Persistencia local con shared_preferences (juego 100% offline, sin backend).
class SaveService {
  static const _key = 'lumen_save_v1';
  final SharedPreferences _prefs;
  SaveService(this._prefs);

  static Future<SaveService> create() async {
    final prefs = await SharedPreferences.getInstance();
    return SaveService(prefs);
  }

  String? readRaw() => _prefs.getString(_key);

  void load(GameState state) => state.loadFromString(readRaw());

  Future<void> save(GameState state) async {
    await _prefs.setString(_key, state.encode());
  }

  Future<void> wipe() async => _prefs.remove(_key);
}
