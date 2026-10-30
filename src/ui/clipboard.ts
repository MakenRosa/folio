// Puts text on the clipboard. Says whether it got there. The API of the browser is the way; the old
// command that copies from a field is the way when the first one is refused, and it takes
// the selection and the focus for a moment, so it gives them back.
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    /* Refused or unavailable: the old way below. */
  }
  const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const field = document.createElement('textarea');
  try {
    field.value = text;
    field.setAttribute('readonly', '');
    field.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none';
    document.body.append(field);
    field.select();
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    field.remove();
    active?.focus({ preventScroll: true });
  }
}
