export const SUBGROUP_SEPARATOR = '/';

export function isSubGroup(name: string): boolean {
  return name.includes(SUBGROUP_SEPARATOR);
}

export function parentOf(name: string): string {
  const sep = name.indexOf(SUBGROUP_SEPARATOR);
  return sep >= 0 ? name.slice(0, sep) : name;
}

export function childName(name: string): string {
  const sep = name.indexOf(SUBGROUP_SEPARATOR);
  return sep >= 0 ? name.slice(sep + SUBGROUP_SEPARATOR.length) : '';
}

export function isParentGroup(name: string, groups: string[]): boolean {
  if (isSubGroup(name)) return false;
  return groups.some((g) => isSubGroup(g) && parentOf(g) === name);
}

export function subGroupsOf(parent: string, groups: string[]): string[] {
  return groups.filter((g) => isSubGroup(g) && parentOf(g) === parent);
}

export function groupLabel(name: string): string {
  return isSubGroup(name) ? childName(name) : name;
}
