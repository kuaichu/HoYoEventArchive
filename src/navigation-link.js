export function shouldNavigateInApp(event, anchor, location) {
  if (!event || !anchor || !location) return false;
  if (event.defaultPrevented || event.button !== 0) return false;
  if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return false;
  if (anchor.target && anchor.target.toLowerCase() !== '_self') return false;
  if (anchor.hasAttribute('download')) return false;

  try {
    return new URL(anchor.href, location.origin).origin === location.origin;
  } catch {
    return false;
  }
}
