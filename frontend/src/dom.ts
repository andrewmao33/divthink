// Whether keyboard input is going into a text field, so global shortcuts
// (Delete, type-to-focus) should leave it alone.
export function isEditing(element: Element | null): boolean {
  return (
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement ||
    element instanceof HTMLSelectElement ||
    (element instanceof HTMLElement && element.isContentEditable)
  )
}
