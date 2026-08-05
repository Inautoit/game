/// Formateo de números grandes: 1.2K, 3.4M, 1.1B… y notación científica
/// cuando se sale de los sufijos.
library;

const List<String> _suffixes = [
  '', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc',
];

/// Devuelve una cadena compacta para [n] (p. ej. 12345 -> "12.3K").
String formatNumber(double n) {
  if (n.isNaN || n.isInfinite) return '∞';
  if (n < 0) return '-${formatNumber(-n)}';
  if (n < 1000) {
    // Enteros pequeños sin decimales; si es <10 y no entero, 1 decimal.
    if (n < 10 && n != n.roundToDouble()) return n.toStringAsFixed(1);
    return n.floor().toString();
  }

  int tier = 0;
  double v = n;
  while (v >= 1000 && tier < _suffixes.length - 1) {
    v /= 1000;
    tier++;
  }

  if (tier >= _suffixes.length - 1 && v >= 1000) {
    // Fuera de sufijos: notación científica.
    return n.toStringAsExponential(2).replaceAll('e+', 'e');
  }

  final str = v >= 100
      ? v.toStringAsFixed(0)
      : v >= 10
          ? v.toStringAsFixed(1)
          : v.toStringAsFixed(2);
  return '$str${_suffixes[tier]}';
}

/// Formatea "por segundo": "12.3K/s".
String formatRate(double n) => '${formatNumber(n)}/s';

/// Duración legible corta: "3h 12m", "45m", "20s".
String formatDuration(Duration d) {
  if (d.inSeconds < 60) return '${d.inSeconds}s';
  if (d.inMinutes < 60) return '${d.inMinutes}m';
  final h = d.inHours;
  final m = d.inMinutes % 60;
  return m > 0 ? '${h}h ${m}m' : '${h}h';
}
