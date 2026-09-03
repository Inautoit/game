// Genera la versión de un solo archivo que se publica como Artifact.
//
// Reutiliza tal cual el CSS y los módulos de la web (misma app), y
// sustituye el cliente del backend de Cloudflare (src/api.js) por un
// adaptador contra la base de datos compartida del visor de artifacts.
const fs = require('fs');
const path = require('path');

const raiz = __dirname;
const leer = (p) => fs.readFileSync(path.join(raiz, p), 'utf8');

const css = leer('styles.css');
const cuerpo = leer('index.html')
  .split('<body>')[1].split('</body>')[0]
  // el service worker y el manifest no aplican dentro del visor
  .replace(/\n\s*<script src="\.\/src\/[^"]+"><\/script>/g, '')
  .trim();

const escudo = leer('assets/escudo.svg');
const escudoData = 'data:image/svg+xml;base64,' + Buffer.from(escudo, 'utf8').toString('base64');

const modulos = ['src/config.js', 'src/seed.js', 'src/sha256.js', 'src/store.js', 'src/auth.js', 'src/fotos.js', 'src/app.js'];
const adaptador = leer('artifact-db.js');

const html = `<title>Calendario BM Leganés</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600;700&family=Barlow+Condensed:wght@600;700&display=swap">
<style>
${css}
</style>

${cuerpo.replace('./assets/escudo.svg', escudoData)}

<script>
${adaptador}
</script>
${modulos.map((m) => `<script>\n${leer(m)}\n</script>`).join('\n')}
`;

const salida = process.argv[2] || path.join(raiz, 'calendario-artifact.html');
fs.writeFileSync(salida, html);
console.log('escrito', salida, (html.length / 1024).toFixed(1) + ' KB');
