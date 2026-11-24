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
