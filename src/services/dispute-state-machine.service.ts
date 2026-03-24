import { DisputeStatus } from '../models/dispute.model';

export class DisputeStateMachine {
    private static validTransitions: Record<DisputeStatus, DisputeStatus[]> = {
        'open': ['under_review', 'resolved'],
        'under_review': ['resolved'],
        'resolved': [] // Terminal state
    };

    /**
     * Checks if a transition from currentStatus to newStatus is allowed.
     */
    static canTransition(currentStatus: DisputeStatus, newStatus: DisputeStatus): boolean {
        if (currentStatus === newStatus) return true; // Allowed optionally or ignored
        const allowedTargets = this.validTransitions[currentStatus];
        return allowedTargets.includes(newStatus);
    }

    /**
     * Asserts if a transition is valid, throwing an error if not.
     */
    static assertTransition(currentStatus: DisputeStatus, newStatus: DisputeStatus): void {
        if (!this.canTransition(currentStatus, newStatus)) {
            throw new Error(`Invalid state transition from '${currentStatus}' to '${newStatus}'`);
        }
    }
}
