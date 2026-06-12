const VIEW_ORDER = ['inspector', 'overview', 'typography', 'settings'] as const;
export type ViewName = (typeof VIEW_ORDER)[number];

// Manages the bottom navigation bar: switching between the inspector,
// overview, typography, and settings views, and cycling through them.
export class NavigationController {
  private readonly navButtons: NodeListOf<HTMLButtonElement>;
  private readonly views: Record<ViewName, HTMLElement>;
  private current: ViewName = 'inspector';

  constructor(private readonly onViewChange?: (view: ViewName) => void) {
    this.navButtons = document.querySelectorAll<HTMLButtonElement>('.nav-btn');
    this.views = {
      inspector: document.getElementById('view-inspector')!,
      overview: document.getElementById('view-overview')!,
      typography: document.getElementById('view-typography')!,
      settings: document.getElementById('view-settings')!,
    };
    this.navButtons.forEach((btn) => {
      btn.addEventListener('click', () => this.setView(btn.dataset.view as ViewName));
    });
  }

  get currentView(): ViewName {
    return this.current;
  }

  setView(view: ViewName) {
    this.current = view;
    this.navButtons.forEach((b) => b.classList.toggle('active', b.dataset.view === view));
    for (const [name, el] of Object.entries(this.views)) el.hidden = name !== view;
    this.onViewChange?.(view);
  }

  cycle() {
    const idx = VIEW_ORDER.indexOf(this.current);
    this.setView(VIEW_ORDER[(idx + 1) % VIEW_ORDER.length]);
  }
}
