export const REVIEWER_VERIFICATION_STATUS = {
  verified: 'verified',
  pendingCompletion: 'pending_completion',
  expired: 'expired',
  used: 'used',
  invalid: 'invalid',
  accountRequired: 'account_required',
} as const;

export type ReviewerVerificationStatus =
  (typeof REVIEWER_VERIFICATION_STATUS)[keyof typeof REVIEWER_VERIFICATION_STATUS];

export type VerifyReturnState =
  | typeof REVIEWER_VERIFICATION_STATUS.expired
  | typeof REVIEWER_VERIFICATION_STATUS.used
  | typeof REVIEWER_VERIFICATION_STATUS.invalid
  | typeof REVIEWER_VERIFICATION_STATUS.accountRequired;
