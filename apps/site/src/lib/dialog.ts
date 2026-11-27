export interface Rect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/**
 * A backdrop click is a click whose target is the dialog element itself and
 * whose point lies strictly outside the dialog's bounding rectangle.
 */
export function shouldCloseOnBackdropClick(
  targetIsDialog: boolean,
  x: number,
  y: number,
  rect: Rect,
): boolean {
  if (!targetIsDialog) return false;
  return x < rect.left || x > rect.right || y < rect.top || y > rect.bottom;
}
