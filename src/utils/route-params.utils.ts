/** Express 5 types allow string | string[] for route params — normalize for service calls. */
export function routeParam(value: string | string[] | undefined): string {
  if (value === undefined) return '';
  return Array.isArray(value) ? value[0] ?? '' : value;
}
