'use strict';
// Conversión del Excel rellenado a PDF usando LibreOffice (si está instalado).
const { execFile } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const CANDIDATES = [
  process.env.SOFFICE_PATH,
  'soffice',
  'libreoffice',
  '/usr/bin/soffice',
  '/Applications/LibreOffice.app/Contents/MacOS/soffice',
  'C:\\Program Files\\LibreOffice\\program\\soffice.exe',
  'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe',
].filter(Boolean);

let sofficePath; // undefined = sin comprobar, null = no disponible

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 60000, ...opts }, (err, stdout, stderr) =>
      err ? reject(Object.assign(err, { stderr })) : resolve(stdout)
    );
  });
}

async function findSoffice() {
  if (sofficePath !== undefined) return sofficePath;
  for (const c of CANDIDATES) {
    try {
      await run(c, ['--version'], { timeout: 20000 });
      sofficePath = c;
      return c;
    } catch {
      /* siguiente */
    }
  }
  sofficePath = null;
  return null;
}

// Las conversiones se hacen de una en una (LibreOffice no admite paralelas con el mismo perfil).
let queue = Promise.resolve();

function xlsxToPdf(xlsxBuffer) {
  const job = queue.then(async () => {
    const soffice = await findSoffice();
    if (!soffice) throw new Error('LibreOffice no está instalado: no se puede generar el PDF.');
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'factura-'));
    try {
      const input = path.join(dir, 'factura.xlsx');
      await fs.writeFile(input, xlsxBuffer);
      const profile = 'file://' + path.join(dir, 'profile').replace(/\\/g, '/');
      // LANG=es_ES para que los números salgan como 1.234,56 €
      await run(soffice, [`-env:UserInstallation=${profile}`, '--headless', '--convert-to', 'pdf', '--outdir', dir, input], {
        env: { ...process.env, LANG: process.env.PDF_LOCALE || 'es_ES.UTF-8', LC_ALL: process.env.PDF_LOCALE || 'es_ES.UTF-8' },
      });
      return await fs.readFile(path.join(dir, 'factura.pdf'));
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
  queue = job.catch(() => {});
  return job;
}

module.exports = { xlsxToPdf, findSoffice };
