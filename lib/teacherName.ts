import type { ClassSessionWithDetails } from '@/types';

// Class sessions should never display "TBA". A session inherits its teacher
// from the class template (set via generate_sessions_ahead), and the template
// itself defaults to the admin who runs un-delegated classes. The four-step
// fallback below keeps that contract even when data is incomplete (e.g. the
// template's teacher was deleted, or no admin has been seeded yet).
export function getClassLeaderName(
  session: ClassSessionWithDetails,
  fallbackAdminName: string | null | undefined,
): string {
  return (
    session.teacher?.full_name
    ?? session.class_templates?.teacher?.full_name
    ?? fallbackAdminName
    ?? 'Admin'
  );
}
