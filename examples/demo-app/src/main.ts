/**
 * CE demo app — intentionally minimal and CE-unaware.
 *
 * Interaction surface provided for the spike:
 * - A navigation menu that opens/closes via the "Menu" button.
 * - A counter button, so state changes are observable in the DOM.
 */

const toggle = document.getElementById('nav-toggle') as HTMLButtonElement;
const menu = document.getElementById('nav-menu') as HTMLElement;

toggle.addEventListener('click', () => {
  const open = menu.classList.toggle('open');
  toggle.setAttribute('aria-expanded', String(open));
});

const increment = document.getElementById('increment') as HTMLButtonElement;
const count = document.getElementById('count') as HTMLOutputElement;

increment.addEventListener('click', () => {
  count.textContent = String(Number(count.textContent ?? '0') + 1);
});

// Settings modal with a theme dropdown and a language dropdown.
const modal = document.getElementById('settings-modal') as HTMLElement;
const openSettings = document.getElementById('open-settings') as HTMLButtonElement;
const closeSettings = document.getElementById('settings-close') as HTMLButtonElement;
const currentTheme = document.getElementById('current-theme') as HTMLOutputElement;

openSettings.addEventListener('click', () => {
  modal.hidden = false;
});

closeSettings.addEventListener('click', () => {
  modal.hidden = true;
});

function wireDropdown(
  triggerId: string,
  listId: string,
  onChoose: (value: string) => void,
): void {
  const trigger = document.getElementById(triggerId) as HTMLButtonElement;
  const list = document.getElementById(listId) as HTMLElement;

  const setOpen = (open: boolean): void => {
    list.hidden = !open;
    trigger.setAttribute('aria-expanded', String(open));
  };

  trigger.addEventListener('click', () => setOpen(list.hidden));

  list.querySelectorAll<HTMLElement>('[role="option"]').forEach((option) => {
    option.addEventListener('click', () => {
      onChoose(option.dataset.value ?? option.textContent ?? '');
      setOpen(false);
    });
  });
}

wireDropdown('theme-trigger', 'theme-list', (value) => {
  currentTheme.textContent = `Theme: ${value}`;
});

wireDropdown('language-trigger', 'language-list', () => {
  // Selection is intentionally a no-op: the list only exists to show clipping.
});
