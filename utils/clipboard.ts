// Copies text to the clipboard and briefly flashes the element to confirm.
export function copyWithFeedback(el: HTMLElement, text: string) {
  navigator.clipboard.writeText(text).then(() => {
    el.classList.add('copied');
    setTimeout(() => el.classList.remove('copied'), 600);
  });
}
