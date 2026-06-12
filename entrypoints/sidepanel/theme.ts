import { themeItem, type Theme } from '@/utils/storage';

// Manages the light/dark theme: the segmented control in Settings,
// persistence to storage, and applying the theme to the document.
export class ThemeController {
  private currentTheme: Theme = 'dark';
  private readonly buttons: NodeListOf<HTMLButtonElement>;

  constructor() {
    const control = document.getElementById('theme-control')!;
    this.buttons = control.querySelectorAll<HTMLButtonElement>('button');
    this.buttons.forEach((btn) => {
      btn.addEventListener('click', () => this.set(btn.dataset.theme as Theme));
    });
    void themeItem.getValue().then((theme) => this.apply(theme));
  }

  private apply(theme: Theme) {
    this.currentTheme = theme;
    document.documentElement.setAttribute('data-theme', theme);
    this.buttons.forEach((b) => b.classList.toggle('active', b.dataset.theme === theme));
  }

  set(theme: Theme) {
    this.apply(theme);
    void themeItem.setValue(theme);
  }

  toggle() {
    this.set(this.currentTheme === 'dark' ? 'light' : 'dark');
  }
}
