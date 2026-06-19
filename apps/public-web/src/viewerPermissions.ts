import type { AuthUser } from '@gsplat/shared';

export function canUseQuestPerformance(user: AuthUser | null | undefined) {
  if (!user) return false;
  if (user.role === 'MASTER_ADMIN' || user.role === 'ADMIN' || user.role === 'EDITOR') {
    return true;
  }

  return user.memberships?.some((membership) => (
    membership.status === 'ACTIVE' &&
    (membership.role === 'MANAGER' || membership.role === 'EDITOR')
  )) ?? false;
}
