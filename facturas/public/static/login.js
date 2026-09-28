(() => {
  const form = document.getElementById('form');
  const errorBox = document.getElementById('error');
  const hint = document.getElementById('hint');

  const showError = (msg) => {
    errorBox.textContent = msg;
    errorBox.classList.toggle('hidden', !msg);
  };

  const urlError = new URLSearchParams(location.search).get('error');
  if (urlError) showError(urlError);

  fetch('/auth/options')
    .then((r) => r.json())
    .then((o) => {
      document.getElementById('ms-block').classList.toggle('hidden', !o.microsoft);
      if (o.owner) form.email.value = o.owner;
      updateHint();
    });

  const HINTS = {
    gmail: 'Gmail: usa una "contraseña de aplicación" (Cuenta de Google → Seguridad → Verificación en dos pasos → Contraseñas de aplicaciones).',
    outlook: 'Outlook/Hotmail: Microsoft recomienda el botón "Iniciar sesión con Microsoft". Con contraseña solo funciona si tu cuenta tiene activadas las contraseñas de aplicación.',
    yahoo: 'Yahoo: genera una contraseña de aplicación en la seguridad de tu cuenta.',
    icloud: 'iCloud: genera una contraseña específica de app en appleid.apple.com.',
  };

  let presetTimer;
  function updateHint() {
    const domain = (form.email.value.split('@')[1] || '').toLowerCase();
    let key = null;
    if (/^(gmail|googlemail)\./.test(domain)) key = 'gmail';
    else if (/^(outlook|hotmail|live|msn)\./.test(domain)) key = 'outlook';
    else if (/^yahoo\./.test(domain)) key = 'yahoo';
    else if (/^(icloud|me|mac)\.com$/.test(domain)) key = 'icloud';
    hint.textContent = key ? HINTS[key] : '';
    hint.classList.toggle('hidden', !key);

    clearTimeout(presetTimer);
    if (!domain.includes('.')) return;
    presetTimer = setTimeout(async () => {
      const p = await fetch('/auth/smtp-preset?email=' + encodeURIComponent(form.email.value)).then((r) => r.json());
      if (!p) {
        document.getElementById('adv').open = true;
        if (!form.host.value) form.host.value = 'smtp.' + domain;
      }
    }, 400);
  }
  form.email.addEventListener('input', updateHint);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    showError('');
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true;
    btn.textContent = 'Comprobando…';
    const adv = document.getElementById('adv').open && form.host.value.trim();
    try {
      const res = await fetch('/auth/smtp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: form.email.value.trim(),
          password: form.password.value,
          ...(adv ? { host: form.host.value.trim(), port: form.port.value, secure: form.secure.checked } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'No se pudo iniciar sesión');
      location.href = '/';
    } catch (err) {
      showError(err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Entrar';
    }
  });
})();
