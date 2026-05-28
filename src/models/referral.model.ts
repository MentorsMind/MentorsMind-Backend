/**
 * Referral and Affiliate Program Models
 * Data models for referral system with XLM token rewards
 */

export interface ReferralCode {
  id: string;
  userId: string;
  code: string;
  codeType: 'personal' | 'affiliate' | 'campaign';
  isActive: boolean;
  maxUses?: number;
  currentUses: number;
  expiresAt?: Date;
  metadata: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

export interface Referral {
  id: string;
  referrerId: string;
  referralCodeId: string;
  referredUserId?: string;
  referredEmail?: string;
  status: 'pending' | 'registered' | 'completed' | 'rewarded' | 'expired' | 'cancelled';
  conversionType?: 'signup' | 'first_booking' | 'first_payment' | 'mentor_signup';
  rewardAmount: number;
  rewardCurrency: string;
  rewardPaid: boolean;
  rewardPaidAt?: Date;
  rewardTransactionHash?: string;
  createdAt: Date;
  registeredAt?: Date;
  completedAt?: Date;
  expiresAt?: Date;
  metadata: Record<string, any>;
  
  // Populated fields
  referrer?: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
  };
  referredUser?: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
  };
}

export interface RewardTier {
  id: string;
  name: string;
  tierLevel: number;
  minReferrals: number;
  maxReferrals?: number;
  rewardMultiplier: number;
  bonusAmount: number;
  bonusCurrency: string;
  perks: string[];
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface AffiliateProfile {
  id: string;
  userId: string;
  status: 'pending' | 'active' | 'suspended' | 'terminated';
  tierId?: string;
  totalReferrals: number;
  successfulReferrals: number;
  totalEarnings: number;
  totalEarningsCurrency: string;
  pendingEarnings: number;
  paidEarnings: number;
  conversionRate: number;
  paymentMethod: string;
  stellarAddress?: string;
  paymentSchedule: 'weekly' | 'biweekly' | 'monthly' | 'manual';
  minimumPayout: number;
  approvedAt?: Date;
  approvedBy?: string;
  createdAt: Date;
  updatedAt: Date;
  
  // Populated fields
  tier?: RewardTier;
  user?: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
  };
}

export interface RewardConfiguration {
  id: string;
  eventType: string;
  eventDescription: string;
  referrerReward: number;
  referredReward: number;
  rewardCurrency: string;
  requiresCompletion: boolean;
  completionCriteria: Record<string, any>;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface RewardPayout {
  id: string;
  affiliateId: string;
  payoutType: 'referral' | 'bonus' | 'tier_bonus' | 'manual';
  amount: number;
  currency: string;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
  paymentMethod: string;
  stellarAddress?: string;
  transactionHash?: string;
  processedAt?: Date;
  completedAt?: Date;
  failedReason?: string;
  metadata: Record<string, any>;
  createdAt: Date;
}

export interface ReferralCampaign {
  id: string;
  name: string;
  description: string;
  campaignType: 'general' | 'mentor_recruitment' | 'student_acquisition' | 'seasonal' | 'limited';
  startDate: Date;
  endDate?: Date;
  targetReferrals?: number;
  bonusReward: number;
  bonusCurrency: string;
  isActive: boolean;
  createdBy?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CampaignParticipant {
  id: string;
  campaignId: string;
  userId: string;
  referralCodeId?: string;
  referralsCount: number;
  bonusEarned: number;
  joinedAt: Date;
}

export interface ReferralAnalytics {
  id: string;
  date: Date;
  totalReferrals: number;
  successfulReferrals: number;
  totalRewardsPaid: number;
  averageConversionTime?: number;
  topReferrerId?: string;
  metadata: Record<string, any>;
  createdAt: Date;
}

export interface AffiliateDashboard {
  profile: AffiliateProfile;
  stats: {
    totalReferrals: number;
    successfulReferrals: number;
    pendingReferrals: number;
    conversionRate: number;
    totalEarnings: number;
    pendingEarnings: number;
    paidEarnings: number;
    nextPayout?: Date;
    nextPayoutAmount?: number;
  };
  recentReferrals: Referral[];
  recentPayouts: RewardPayout[];
  tier: RewardTier;
  nextTier?: RewardTier;
  referralsToNextTier?: number;
}

export interface ReferralStats {
  totalReferrals: number;
  successfulReferrals: number;
  pendingReferrals: number;
  totalEarnings: number;
  conversionRate: number;
  topReferrers: Array<{
    userId: string;
    name: string;
    referrals: number;
    earnings: number;
  }>;
  recentActivity: Array<{
    date: string;
    referrals: number;
    conversions: number;
  }>;
}

export interface CreateReferralCodeData {
  userId: string;
  codeType?: ReferralCode['codeType'];
  customCode?: string;
  maxUses?: number;
  expiresAt?: Date;
  metadata?: Record<string, any>;
}

export interface CreateReferralData {
  referralCode: string;
  referredEmail?: string;
  metadata?: Record<string, any>;
}

export interface UpdateReferralData {
  status?: Referral['status'];
  conversionType?: Referral['conversionType'];
  referredUserId?: string;
  metadata?: Record<string, any>;
}

export interface CreateAffiliateData {
  userId: string;
  stellarAddress?: string;
  paymentSchedule?: AffiliateProfile['paymentSchedule'];
  minimumPayout?: number;
}

export interface ProcessPayoutData {
  affiliateId: string;
  amount: number;
  payoutType: RewardPayout['payoutType'];
  metadata?: Record<string, any>;
}
