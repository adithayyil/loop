/**
 * Injected into every document in the recorded Steel session. Kept as a plain
 * string (not a function) so it survives bundling and runs verbatim in the page.
 * Payloads are namespaced under `__loop*` and every event carries the page URL.
 */
export const RECORDER_SCRIPT = String.raw`
(function () {
  if (window.__loopRecorder) return;
  window.__loopRecorder = true;

  function roleOf(el) {
    return el.getAttribute('role')
      || ({ BUTTON: 'button', A: 'link', SELECT: 'combobox', TEXTAREA: 'textbox' }[el.tagName])
      || (el.tagName === 'INPUT'
        ? ({ checkbox: 'checkbox', radio: 'radio', submit: 'button', button: 'button' }[el.type] || 'textbox')
        : null);
  }

  function nameOf(el) {
    var aria = el.getAttribute('aria-label');
    if (aria) return aria;
    var text = (el.innerText || el.textContent || '').trim();
    if (text) return text.slice(0, 80);
    if (el.placeholder) return el.placeholder;
    if (el.getAttribute('name')) return el.getAttribute('name');
    return null;
  }

  function info(el) {
    var dt = el.getAttribute('data-testid') || el.getAttribute('data-test');
    var css = el.tagName.toLowerCase();
    if (el.id) css += '#' + el.id;
    else if (dt) css += '[data-testid="' + dt + '"]';
    else if (el.getAttribute('name')) css += '[name="' + el.getAttribute('name') + '"]';
    else if (el.placeholder) css += '[placeholder="' + el.placeholder + '"]';
    return {
      tag: el.tagName.toLowerCase(),
      css: css,
      role: roleOf(el),
      name: nameOf(el),
      dataTest: dt,
      id: el.id || null,
      inputType: el.type || null,
      checked: typeof el.checked === 'boolean' ? el.checked : null,
      cls: typeof el.className === 'string' ? el.className.slice(0, 80) : ''
    };
  }

  function emit(ev) {
    try {
      ev.title = document.title;
      window.__loopEmit(ev);
    } catch (e) { /* binding not ready */ }
  }

  document.addEventListener('click', function (e) {
    emit(Object.assign({ type: 'click', url: location.href }, info(e.target)));
  }, true);

  document.addEventListener('change', function (e) {
    emit(Object.assign({ type: 'change', url: location.href, value: e.target.value }, info(e.target)));
  }, true);

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
      emit(Object.assign({ type: 'enter', url: location.href, value: e.target.value }, info(e.target)));
    }
  }, true);

  ['pushState', 'replaceState'].forEach(function (method) {
    var original = history[method];
    history[method] = function () {
      var result = original.apply(this, arguments);
      emit({ type: 'navigate', url: location.href, title: document.title });
      return result;
    };
  });
  window.addEventListener('popstate', function () {
    emit({ type: 'navigate', url: location.href, title: document.title });
  });
})();
`;
