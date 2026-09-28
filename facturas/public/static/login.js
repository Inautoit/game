(() => {
  const form = document.getElementById('form');
  const errorBox = document.getElementById('error');
  let setup = false;

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
      setup = o.setup;
      document.getElementById('setup-info').classList.toggle('hidden', !setup);
      document.getElementById('code-field').classList.toggle('hidden', !setup);
      form.code.required = setup;
      form.password.autocomplete = setup ? 'new-password' : 'current-password';
      form.querySelector('button').textContent = setup ? 'Crear contraseña y entrar' : 'Entrar';
    });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    showError('');
    const btn = form.querySelector('button[type=submit]');
    const label = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Un momento…';
    try {
      const res = await fetch(setup ? '/auth/setup' : '/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: form.email.value.trim(), password: form.password.value, code: form.code.value.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'No se pudo iniciar sesión');
      location.href = '/';
    } catch (err) {
      showError(err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = label;
    }
  });
})();
