// Copies text to the clipboard, flashes the element, and floats a brief
// inline "Copied ✓" confirmation above it (§6: clearer feedback than a
// toast that might be missed).
export function copyWithFeedback(el: HTMLElement, text: string) {
  navigator.clipboard.writeText(text).then(() => {
    el.classList.add('copied');
    showCopyBadge(el);
    setTimeout(() => el.classList.remove('copied'), 900);
  });
}

function showCopyBadge(el: HTMLElement) {
  document.querySelectorAll('.copy-feedback').forEach((b) => b.remove());
  const r = el.getBoundingClientRect();
  const badge = document.createElement('span');
  badge.className = 'copy-feedback';
  badge.textContent = 'Copied \u2713';
  badge.style.left = `${Math.min(Math.max(r.left + r.width / 2, 36), window.innerWidth - 36)}px`;
  badge.style.top = `${Math.max(r.top - 2, 22)}px`;
  document.body.append(badge);
  setTimeout(() => badge.remove(), 900);
}
