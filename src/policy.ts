import type { ManagerCoding, PermissionsConfig, PermissionRule } from './types.js';

export type PolicyOperation =
  | { type: 'local_read' | 'local_edit' | 'test_command' | 'network' | 'destructive_command' | 'credentialed_action' | 'commit' | 'push' | 'deploy' }
  | { type: 'manager_write'; files: number; changed_lines: number };
export interface PolicyContext { manager_coding: ManagerCoding; small_fix_max_files: number; small_fix_max_changed_lines: number }

function map(rule: PermissionRule): PermissionRule { return rule; }

export function decidePolicy(permissions: PermissionsConfig, operation: PolicyOperation, context: PolicyContext): PermissionRule {
  if (operation.type === 'manager_write') {
    if (context.manager_coding === 'never') return 'deny';
    if (context.manager_coding === 'full') return map(permissions.local_edit);
    return operation.files <= context.small_fix_max_files && operation.changed_lines <= context.small_fix_max_changed_lines
      ? map(permissions.local_edit)
      : 'deny';
  }
  const key = {
    local_read: 'local_read',
    local_edit: 'local_edit',
    test_command: 'test_commands',
    network: 'network',
    destructive_command: 'destructive_commands',
    credentialed_action: 'credentialed_actions',
    commit: 'commit',
    push: 'push',
    deploy: 'deploy',
  }[operation.type] as keyof PermissionsConfig;
  return map(permissions[key]);
}
