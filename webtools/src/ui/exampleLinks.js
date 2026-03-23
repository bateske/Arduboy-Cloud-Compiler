/**
 * Example Links — makes `// Example: ...` lines clickable in <pre> elements.
 * Clicking copies the code portion (after "// Example: ") to the clipboard.
 */

import { showToast } from './toast.js';

/** HTML-escape a string for safe innerHTML use. */
function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Scan a `<pre>` element's text for `// Example:` lines and convert them
 * into clickable spans.  All other text is HTML-escaped.
 *
 * Respects the "Example Links" toggle — when disabled the text is left as-is.
 *
 * Call this *after* setting content (textContent or value).
 * @param {HTMLPreElement} pre
 */
export function applyExampleLinks(pre) {
  if (!pre) return;
  // Respect the global toggle
  const cb = document.getElementById('exampleLinksCheckbox');
  if (cb && !cb.checked) return;

  const text = pre.textContent || '';
  if (!text.includes('// Example:')) return; // fast-path

  const lines = text.split('\n');
  const html = lines.map((line) => {
    const m = line.match(/^(\s*)(\/\/ Example: )(.+)$/);
    if (m) {
      const code = m[3];
      return esc(m[1]) + esc(m[2])
        + '<span class="example-link" data-code="' + esc(code) + '">'
        + esc(code)
        + '</span>';
    }
    return esc(line);
  }).join('\n');

  pre.innerHTML = html;
}

/** Global click-delegation handler (installed once). */
let _delegationInstalled = false;

/**
 * Install a document-level click handler for `.example-link` spans.
 * Safe to call multiple times — only installs once.
 */
export function installExampleLinkHandler() {
  if (_delegationInstalled) return;
  _delegationInstalled = true;

  document.addEventListener('click', (e) => {
    const span = e.target.closest('.example-link');
    if (!span) return;
    const code = span.dataset.code;
    if (!code) return;
    navigator.clipboard.writeText(code).then(
      () => showToast('Example copied to clipboard', 'success'),
      () => showToast('Failed to copy example', 'error'),
    );
  });
}
