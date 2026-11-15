// Contenido de los reels. Todo en texto: fácil de ampliar.
// Tipos: question (pregunta fácil), song (¿qué canción es?), info (sabías que / comida y salud),
//        memory (mira y recuerda), relax (respirar).

export const QUESTIONS = [
  // Refranes
  { cat: 'Refrán', icon: '📜', q: 'A quien madruga…', v: 'sunrise', a: 'Dios le ayuda' },
  { cat: 'Refrán', icon: '📜', q: 'Más vale pájaro en mano…', v: 'birds flying', a: 'que ciento volando' },
  { cat: 'Refrán', icon: '📜', q: 'En abril…', v: 'rain', a: 'aguas mil' },
  { cat: 'Refrán', icon: '📜', q: 'Camarón que se duerme…', v: 'ocean waves', a: 'se lo lleva la corriente' },
  { cat: 'Refrán', icon: '📜', q: 'Ojos que no ven…', v: 'clouds sky', a: 'corazón que no siente' },
  { cat: 'Refrán', icon: '📜', q: 'No por mucho madrugar…', v: 'sunrise', a: 'amanece más temprano' },
  { cat: 'Refrán', icon: '📜', q: 'Al pan, pan…', v: 'bread bakery', a: 'y al vino, vino' },
  { cat: 'Refrán', icon: '📜', q: 'Perro ladrador…', v: 'dog playing', a: 'poco mordedor' },
  // Adivinanzas
  { cat: 'Adivinanza', icon: '🤔', q: 'Oro parece, plata no es. ¿Qué es?', v: 'banana', a: 'El plátano', ae: '🍌' },
  { cat: 'Adivinanza', icon: '🤔', q: 'Blanca por dentro, verde por fuera. Si quieres que te lo diga, espera.', v: 'pear', a: 'La pera', ae: '🍐' },
  { cat: 'Adivinanza', icon: '🤔', q: 'Agua pasa por mi casa, cate de mi corazón.', v: 'avocado', a: 'El aguacate', ae: '🥑' },
  { cat: 'Adivinanza', icon: '🤔', q: 'Tiene agujas y no cose, tiene números y no es libro.', v: 'clock', a: 'El reloj', ae: '⏰' },
  // Cultura fácil
  { cat: 'Pregunta', icon: '❓', q: '¿Qué río pasa por Sevilla?', v: 'Seville Guadalquivir', a: 'El Guadalquivir', ae: '🌊' },
  { cat: 'Pregunta', icon: '❓', q: '¿Qué río pasa por Zaragoza?', v: 'Zaragoza Ebro', a: 'El Ebro', ae: '🌊' },
  { cat: 'Pregunta', icon: '❓', q: '¿En qué ciudad está la Alhambra?', v: 'Alhambra', a: 'En Granada', ae: '🏰' },
  { cat: 'Pregunta', icon: '❓', q: '¿En qué ciudad está la Sagrada Familia?', v: 'Sagrada Familia', a: 'En Barcelona', ae: '⛪' },
  { cat: 'Pregunta', icon: '❓', q: '¿Quién escribió El Quijote?', v: 'Don Quixote windmills Consuegra', a: 'Miguel de Cervantes', ae: '📖' },
  { cat: 'Pregunta', icon: '❓', q: '¿Cuál es la capital de Portugal?', v: 'Lisbon', a: 'Lisboa', ae: '🇵🇹' },
  { cat: 'Pregunta', icon: '❓', q: '¿Qué animal dice «kikirikí»?', v: 'rooster', a: 'El gallo', ae: '🐓' },
  { cat: 'Pregunta', icon: '❓', q: '¿Cuántas patas tiene una araña?', v: 'spider', a: 'Ocho', ae: '🕷️' },
  { cat: 'Pregunta', icon: '❓', q: '¿Cuántos jugadores de un equipo de fútbol hay en el campo?', v: 'football match', a: 'Once', ae: '⚽' },
  { cat: 'Pregunta', icon: '❓', q: '¿De qué fruta se hace el vino?', v: 'vineyard grapes', a: 'De la uva', ae: '🍇' },
  // Cuentas sencillas
  { cat: 'Cuentas', icon: '🧮', q: 'Si tengo 10 euros y me gasto 3, ¿cuánto me queda?', v: 'coins euro', a: '7 euros', ae: '💶' },
  { cat: 'Cuentas', icon: '🧮', q: 'Media docena de huevos, ¿cuántos huevos son?', v: 'egg', a: 'Seis', ae: '🥚' },
  { cat: 'Cuentas', icon: '🧮', q: '¿Cuánto es 5 por 5?', v: 'market vegetables', a: '25' },
  { cat: 'Cuentas', icon: '🧮', q: 'Compro 2 barras de pan a 1 euro cada una. ¿Cuánto pago?', v: 'bread bakery', a: '2 euros', ae: '🥖' },
  { cat: 'Cuentas', icon: '🧮', q: '¿Qué día va después del jueves?', v: 'calendar', a: 'El viernes', ae: '📅' },
  // Decir palabras (fluidez)
  { cat: 'Dilo en voz alta', icon: '🗣️', q: 'Di tres frutas de color rojo', v: 'market vegetables', a: 'Fresa, cereza, sandía, manzana…', ae: '🍓🍒🍉' },
  { cat: 'Dilo en voz alta', icon: '🗣️', q: 'Di cinco nombres que empiecen por M', v: 'clouds sky', a: 'María, Manuel, Mercedes, Miguel, Marta…' },
  { cat: 'Dilo en voz alta', icon: '🗣️', q: 'Di cuatro animales de granja', v: 'cows farm', a: 'Vaca, cerdo, gallina, oveja, caballo…', ae: '🐄🐖🐔🐑' },
];

// Melodías tradicionales / de dominio público, sintetizadas en el navegador.
// Formato: "NOTA:duración-en-tiempos" separado por espacios. R = silencio.
export const SONGS = [
  { title: 'Cumpleaños feliz', v: 'birthday cake candles', hint: 'Se canta en todas las fiestas', icon: '🎂', bpm: 110,
    notes: 'G4:.75 G4:.25 A4:1 G4:1 C5:1 B4:2 G4:.75 G4:.25 A4:1 G4:1 D5:1 C5:2 G4:.75 G4:.25 G5:1 E5:1 C5:1 B4:1 A4:2 F5:.75 F5:.25 E5:1 C5:1 D5:1 C5:2' },
  { title: 'Himno de la alegría', v: 'violin orchestra', hint: 'De Beethoven', icon: '🎻', bpm: 120,
    notes: 'E4 E4 F4 G4 G4 F4 E4 D4 C4 C4 D4 E4 E4:1.5 D4:.5 D4:2 E4 E4 F4 G4 G4 F4 E4 D4 C4 C4 D4 E4 D4:1.5 C4:.5 C4:2' },
  { title: 'Para Elisa', v: 'piano', hint: 'También de Beethoven, al piano', icon: '🎹', bpm: 140,
    notes: 'E5:.5 D#5:.5 E5:.5 D#5:.5 E5:.5 B4:.5 D5:.5 C5:.5 A4:1.5 C4:.5 E4:.5 A4:.5 B4:1.5 E4:.5 G#4:.5 B4:.5 C5:1.5 E4:.5 E5:.5 D#5:.5 E5:.5 D#5:.5 E5:.5 B4:.5 D5:.5 C5:.5 A4:1.5 C4:.5 E4:.5 A4:.5 B4:1.5 E4:.5 C5:.5 B4:.5 A4:2' },
  { title: 'La cucaracha', v: 'vinyl record', hint: '«…ya no puede caminar»', icon: '🪇', bpm: 150,
    notes: 'G4:.5 G4:.5 G4:.5 C5:1.5 E5:1 R:.5 G4:.5 G4:.5 G4:.5 C5:1.5 E5:1.5 R:.5 C5:.5 C5:.5 B4:.5 B4:.5 A4:.5 A4:.5 G4:2' },
  { title: 'Martinillo', v: 'church bells', hint: '«…¿dónde estás?»', icon: '🔔', bpm: 120,
    notes: 'C4 D4 E4 C4 C4 D4 E4 C4 E4 F4 G4:2 E4 F4 G4:2 G4:.5 A4:.5 G4:.5 F4:.5 E4 C4 G4:.5 A4:.5 G4:.5 F4:.5 E4 C4 C4 G3 C4:2 C4 G3 C4:2' },
  { title: 'Estrellita, ¿dónde estás?', v: 'night sky stars', hint: 'Canción de cuna', icon: '⭐', bpm: 110,
    notes: 'C4 C4 G4 G4 A4 A4 G4:2 F4 F4 E4 E4 D4 D4 C4:2' },
];

export const INFOS = [
  { title: 'El aceite de oliva', v: 'olive oil', icon: '🫒', cat: 'Comida sana', facts: [
    ['🇪🇸', 'Es la base de la dieta mediterránea.'],
    ['❤️', 'Tiene grasas buenas para el corazón.'],
    ['🥗', 'Mejor en crudo: en la tostada o en la ensalada.'] ] },
  { title: 'Beber agua', v: 'pouring water glass', icon: '💧', cat: 'Salud', facts: [
    ['👵', 'Con los años se nota menos la sed.'],
    ['🥤', 'Bebe agua a lo largo del día, aunque no tengas sed.'],
    ['🍲', 'Las sopas, los caldos y la fruta también hidratan.'] ] },
  { title: 'Las legumbres', v: 'lentils', icon: '🫘', cat: 'Comida sana', facts: [
    ['🥣', 'Lentejas, garbanzos y alubias.'],
    ['💪', 'Tienen mucha fibra y proteína.'],
    ['📅', 'Lo ideal es tomarlas varias veces por semana.'] ] },
  { title: 'La fruta', v: 'oranges fruit', icon: '🍊', cat: 'Comida sana', facts: [
    ['🥝', 'La naranja y el kiwi tienen mucha vitamina C.'],
    ['🍎', 'Mejor la fruta entera que en zumo: tiene más fibra.'],
    ['☀️', 'Intenta tomar fruta todos los días.'] ] },
  { title: 'El pescado azul', v: 'sardines', icon: '🐟', cat: 'Comida sana', facts: [
    ['🐠', 'Sardinas, caballa, boquerones o salmón.'],
    ['🧠', 'Tiene omega 3, bueno para el corazón y el cerebro.'],
    ['🍽️', 'Se recomienda un par de veces por semana.'] ] },
  { title: 'Ojo con la sal', v: 'salt', icon: '🧂', cat: 'Salud', facts: [
    ['📈', 'Mucha sal puede subir la tensión.'],
    ['🌿', 'Da sabor con hierbas: orégano, perejil, pimentón o ajo.'],
    ['🥓', 'Cuidado con embutidos y comidas preparadas.'] ] },
  { title: 'Caminar cada día', v: 'walking park', icon: '🚶', cat: 'Salud', facts: [
    ['❤️', 'Un paseo diario ayuda al corazón y al ánimo.'],
    ['😴', 'También ayuda a dormir mejor.'],
    ['👟', 'Con buen calzado y a tu ritmo.'] ] },
  { title: 'Huesos fuertes', v: 'milk pouring', icon: '🦴', cat: 'Salud', facts: [
    ['🥛', 'Leche, yogur y queso tienen calcio.'],
    ['🐟', 'Las sardinas en lata con su espina, también.'],
    ['🌤️', 'Un rato al sol ayuda a fijar el calcio.'] ] },
  { title: 'Cuida tu memoria', v: 'reading book', icon: '🧠', cat: 'Salud', facts: [
    ['📖', 'Leer, hacer pasatiempos y charlar ejercitan la mente.'],
    ['🌱', 'Aprender algo nuevo, aunque sea pequeño, es lo mejor.'],
    ['🛏️', 'Dormir bien ayuda a recordar.'] ] },
  { title: 'Receta: pan con tomate', v: 'tomato', icon: '🍅', cat: 'Receta fácil', facts: [
    ['🍞', 'Tuesta una rebanada de pan.'],
    ['🍅', 'Pon tomate rallado por encima.'],
    ['🫒', 'Un chorrito de aceite y una pizca de sal. ¡Listo!'] ] },
  { title: 'Receta: gazpacho', v: 'gazpacho', icon: '🥣', cat: 'Receta fácil', facts: [
    ['🍅', 'Tomate, pepino, pimiento y un poco de ajo.'],
    ['🫒', 'Aceite de oliva, vinagre y sal.'],
    ['❄️', 'Se tritura todo y se sirve bien fresquito.'] ] },
  { title: '¿El huevo es fresco?', v: 'egg', icon: '🥚', cat: 'Truco de cocina', facts: [
    ['🥛', 'Pon el huevo en un vaso de agua.'],
    ['⬇️', 'Si se hunde y se queda tumbado, está fresco.'],
    ['⬆️', 'Si flota, mejor no te lo comas.'] ] },
  { title: 'La miel', v: 'honey bee flower', icon: '🍯', cat: 'Curiosidad', facts: [
    ['🐝', 'La hacen las abejas con el néctar de las flores.'],
    ['⏳', 'Bien cerrada, dura muchísimos años.'],
    ['🏺', 'Se ha encontrado miel en tumbas de Egipto.'] ] },
];

export const MEMORY = [
  [['🍎', 'manzana'], ['🔑', 'llave'], ['🐱', 'gato'], ['⏰', 'reloj']],
  [['🌹', 'rosa'], ['🚲', 'bicicleta'], ['📚', 'libros'], ['🥖', 'pan']],
  [['🐶', 'perro'], ['☂️', 'paraguas'], ['🍋', 'limón'], ['🎸', 'guitarra']],
  [['🧀', 'queso'], ['👓', 'gafas'], ['⚽', 'balón'], ['🌙', 'luna']],
  [['🍇', 'uvas'], ['🎩', 'sombrero'], ['🚗', 'coche'], ['✉️', 'carta']],
  [['🐟', 'pez'], ['🕯️', 'vela'], ['🍐', 'pera'], ['🏠', 'casa']],
];

export const CHEERS = ['Muy bien.', 'Exacto.', 'Estupendo.', 'Bien hecho.', 'Así es.', 'Perfecto.', 'Vamos con otra.'];
