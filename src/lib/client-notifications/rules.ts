/** Rule-driven client notifications. Filled in by the client-notification stage of this change. */
export async function onCheckInVerified(checkInId: string): Promise<void> { void checkInId; }
export async function onCheckInEscalated(checkInId: string, status: string): Promise<void> { void checkInId; void status; }
