const $ = (s) => document.querySelector(s),
  form = $('#form'),
  token = $('meta[name="ui-token"]').content;
let busy = false;
function notice(message = '') {
  $('#notice').textContent = message;
  $('#notice').hidden = !message;
}
function setBusy(value) {
  busy = value;
  $('#cancel').hidden = !value;
  for (const id of ['fetch', 'run', 'demo', 'install']) $('#' + id).disabled = value;
  $('#state').textContent = value ? 'Working…' : 'Ready';
  for (const env of ['stage', 'prod'])
    for (const action of ['SignIn', 'Verify', 'Disconnect']) $('#' + env + action).disabled = value;
}
function credentials() {
  for (const env of ['stage', 'prod']) {
    const auth = form.elements[env + 'Auth'].value;
    $('#' + env + 'Credentials').hidden = auth !== 'httpBasic';
    $('#' + env + 'BrowserAuth').hidden = auth !== 'browserSession';
  }
}
function values() {
  const data = Object.fromEntries(new FormData(form));
  for (const key of ['desktop', 'mobile', 'allowHttp']) data[key] = form.elements[key].checked;
  return data;
}
function remember(data) {
  const safe = { ...data };
  for (const k of ['stagePass', 'prodPass', 'stageUser', 'prodUser']) delete safe[k];
  try {
    localStorage.setItem('visual-ui-settings-v1', JSON.stringify(safe));
  } catch {}
}
function fill(data) {
  for (const [key, value] of Object.entries(data)) {
    const el = form.elements[key];
    if (!el) continue;
    if (el.type === 'checkbox') el.checked = Boolean(value);
    else el.value = value;
  }
  credentials();
}
async function api(url, body) {
  const r = await fetch(url, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      'x-ui-token': token,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await r.json();
  if (!r.ok) throw Error(data.error || 'Request failed');
  return data;
}
function element(tag, text, cls) {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  if (cls) e.className = cls;
  return e;
}
function reportLink(id, label, file = 'report.html') {
  const a = element('a', label, 'button');
  a.href = '/reports/' + encodeURIComponent(id) + '/' + file;
  a.target = '_blank';
  a.rel = 'noopener';
  return a;
}
async function loadHistory() {
  const { history } = await api('/api/history');
  const target = $('#historyList');
  target.replaceChildren();
  if (!history.length) target.textContent = 'No comparisons yet.';
  for (const r of history) {
    const item = element('div', undefined, 'history-item'),
      info = element('div');
    info.append(
      element('strong', r.project),
      element(
        'p',
        new Date(r.createdAt).toLocaleString() +
          ' · ' +
          r.status +
          ' · ' +
          r.summary.findings +
          ' findings',
      ),
    );
    item.append(info, reportLink(r.runId, 'Open report'));
    target.append(item);
  }
}
function showResult(job) {
  $('#state').textContent =
    job.result?.status ?? (job.state === 'done' ? 'Complete' : 'Needs attention');
  if (job.state === 'error') {
    notice(job.message);
    refreshAuth().catch(() => {});
    return;
  }
  const r = job.result;
  if (!r) return;
  if (job.action === 'discover') {
    const body = $('#pages tbody');
    body.replaceChildren();
    for (const pair of r.pages) {
      const row = element('tr');
      row.append(element('td', pair.stage), element('td', pair.prod));
      body.append(row);
    }
    $('#pages').hidden = false;
    $('#warnings').textContent = (r.warnings ?? []).join('\n');
  }
  if (job.action === 'run') {
    $('#summary').replaceChildren();
    for (const [k, v] of Object.entries(r.summary)) {
      const stat = element('div', undefined, 'stat');
      stat.append(element('b', v), element('span', k));
      $('#summary').append(stat);
    }
    $('#reportLinks').replaceChildren(
      reportLink(r.runId, 'Open full report ↗'),
      reportLink(r.runId, 'View JSON', 'results.json'),
    );
    $('#warnings').textContent = (r.warnings ?? []).join('\n');
    if (r.authRequired?.length) {
      notice(
        'Session access was lost for ' + r.authRequired.join(', ') + '. Sign in and verify again.',
      );
      refreshAuth().catch(() => {});
    } else if (r.status === 'inconclusive')
      notice(
        'Some pages could not be captured. This is not a clean result. Open the report for details. If Chromium is unavailable, use Install / repair browser.',
      );
    loadHistory().catch(() => {});
  }
}
async function follow(id) {
  try {
    while (true) {
      const { jobs } = await api('/api/jobs');
      const job = jobs.find((j) => j.id === id);
      if (!job) throw Error('Task is no longer available. Check previous comparisons.');
      $('#progress').textContent = job.message;
      if (job.state !== 'running') {
        setBusy(false);
        showResult(job);
        return;
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
  } catch (e) {
    setBusy(false);
    notice(e.message + ' Reload the page to reconnect.');
  }
}
async function start(action) {
  if (busy || !form.reportValidity()) return;
  const data = values();
  if (!data.desktop && !data.mobile) {
    notice('Select at least one device.');
    return;
  }
  remember(data);
  notice();
  setBusy(true);
  $('#summary').replaceChildren();
  $('#reportLinks').replaceChildren();
  $('#pages').hidden = true;
  $('#warnings').textContent = '';
  $('#progress').textContent = action === 'discover' ? 'Fetching sitemap…' : 'Starting comparison…';
  try {
    const { id } = await api('/api/' + action, data);
    follow(id);
  } catch (e) {
    setBusy(false);
    notice(e.message);
  }
}
form.addEventListener('submit', (e) => {
  e.preventDefault();
  start('run');
});
$('#fetch').onclick = () => start('discover');
form.addEventListener('change', credentials);
$('#demo').onclick = async () => {
  notice();
  try {
    const d = await api('/api/demo', {});
    fill({
      ...d,
      project: 'Local Drupal sample',
      stageAuth: 'none',
      prodAuth: 'none',
      stageUser: '',
      stagePass: '',
      prodUser: '',
      prodPass: '',
      stageAssets: '',
      prodAssets: '',
      overrides: '',
      masks: '',
      allowHttp: true,
      maxPages: 5,
      desktop: true,
      mobile: true,
    });
    $('#progress').textContent =
      'Local sample websites are ready. Click Fetch pages or Compare websites. Intentional differences are included.';
  } catch (e) {
    notice(e.message);
  }
};
$('#install').onclick = async () => {
  notice();
  setBusy(true);
  try {
    const { id } = await api('/api/install', {});
    follow(id);
  } catch (e) {
    setBusy(false);
    notice(e.message);
  }
};
$('#cancel').onclick = async () => {
  try {
    await api('/api/cancel', {});
  } catch (e) {
    notice(e.message);
  }
};
$('#refresh').onclick = () => loadHistory().catch((e) => notice(e.message));
try {
  fill(JSON.parse(localStorage.getItem('visual-ui-settings-v1') || '{}'));
} catch {}
credentials();
loadHistory().catch((e) => notice(e.message));
api('/api/jobs')
  .then(({ jobs }) => {
    const current = jobs.find((j) => j.state === 'running');
    if (current) {
      setBusy(true);
      follow(current.id);
    }
  })
  .catch(() => {});

async function refreshAuth() {
  const { sessions } = await api('/api/auth/status');
  for (const kind of ['stage', 'prod']) {
    const s = sessions[kind];
    $('#' + kind + 'SessionStatus').textContent = s
      ? `${s.state} · ${s.origin} — ${s.message}${s.blockedOrigin ? ' Blocked origin: ' + s.blockedOrigin : ''}`
      : 'Not signed in. Open the sign-in browser to connect.';
  }
}
for (const kind of ['stage', 'prod'])
  for (const [suffix, action] of [
    ['SignIn', 'start'],
    ['Verify', 'complete'],
    ['Disconnect', 'disconnect'],
  ])
    $('#' + kind + suffix).onclick = async () => {
      if (busy) return;
      if (action === 'start' && !form.reportValidity()) return;
      notice();
      const button = $('#' + kind + suffix);
      button.disabled = true;
      try {
        await api('/api/auth/' + action, { ...values(), environment: kind });
        await refreshAuth();
        if (action === 'complete')
          notice('Session verified. You can now fetch pages or compare websites.');
      } catch (e) {
        notice(e.message);
        await refreshAuth().catch(() => {});
      } finally {
        button.disabled = false;
      }
    };
refreshAuth().catch(() => {});
const authTimer = setInterval(() => refreshAuth().catch(() => {}), 3000);
window.addEventListener('pagehide', () => clearInterval(authTimer));
