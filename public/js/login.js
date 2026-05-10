document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errEl = document.getElementById('login-error');
  errEl.hidden = true;
  const password = document.getElementById('password').value;
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    if (res.ok) {
      window.location.href = '/';
    } else {
      const data = await res.json();
      errEl.textContent = data.error || 'Login failed';
      errEl.hidden = false;
    }
  } catch {
    errEl.textContent = 'Connection error';
    errEl.hidden = false;
  }
});
