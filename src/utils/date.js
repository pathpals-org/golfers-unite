export function formatDate(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString();
}

export function sortByDateAsc(a, b, key = "dateISO") {
  return new Date(a[key]) - new Date(b[key]);
}

export function sortByDateDesc(a, b, key = "dateISO") {
  return new Date(b[key]) - new Date(a[key]);
}
