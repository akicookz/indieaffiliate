/**
 * Email service using Resend SDK.
 * Sends transactional emails for partner management.
 */

import { Resend } from "resend";

const DEFAULT_FROM = "UnlockAffiliate <hello@updates.unlockaffiliate.com>";

interface SendEmailParams {
  to: string;
  subject: string;
  html: string;
  from?: string;
}

export class EmailService {
  private resend: Resend;
  private defaultFrom: string;

  constructor(apiKey: string, defaultFrom = DEFAULT_FROM) {
    this.resend = new Resend(apiKey);
    this.defaultFrom = defaultFrom;
  }

  async sendEmail(params: SendEmailParams): Promise<{ id: string } | null> {
    const { data, error } = await this.resend.emails.send({
      from: params.from ?? this.defaultFrom,
      to: [params.to],
      subject: params.subject,
      html: params.html,
    });

    if (error) {
      console.error("Resend email error:", error.message);
      return null;
    }

    return data;
  }

  /**
   * Send a partner invitation email.
   */
  async sendPartnerInvitation(params: {
    partnerName: string;
    partnerEmail: string;
    projectName: string;
    referralCode: string;
    baseUrl: string;
  }): Promise<boolean> {
    const base = params.baseUrl.replace(/\/+$/, "");
    const partnerDashboardUrl = `${base}/portal`;

    const result = await this.sendEmail({
      to: params.partnerEmail,
      subject: `You've been invited to partner with ${params.projectName}`,
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 560px; margin: 0 auto;">
          <h2 style="color: #1a1a1a;">You're invited to join ${params.projectName}</h2>
          <p style="color: #555; line-height: 1.6;">
            Hi ${params.partnerName},
          </p>
          <p style="color: #555; line-height: 1.6;">
            You've been invited to become an affiliate partner for <strong>${params.projectName}</strong>.
            Sign in to your partner dashboard to view your referral code and share it with your audience.
          </p>
          <div style="background: #f5f5f5; border-radius: 8px; padding: 16px; margin: 24px 0; text-align: center;">
            <p style="margin: 0 0 8px; font-size: 13px; color: #888;">Your referral code</p>
            <p style="margin: 0; font-family: monospace; font-size: 22px; font-weight: 600; letter-spacing: 0.08em; color: #1a1a1a;">
              ${params.referralCode}
            </p>
          </div>
          <div style="margin: 28px 0; text-align: center;">
            <a href="${partnerDashboardUrl}" style="display: inline-block; background: #7c3aed; color: #ffffff; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600;">
              Open partner dashboard
            </a>
          </div>
          <p style="color: #888; font-size: 13px; line-height: 1.5;">
            If you're not signed in yet, use the same email address this invitation was sent to when you request a sign-in link.
          </p>
          <p style="color: #888; font-size: 13px; margin-top: 32px;">
            — The ${params.projectName} team via UnlockAffiliate
          </p>
        </div>
      `,
    });

    return result !== null;
  }

  /**
   * Send a welcome email when a partner self-registers and is auto-approved.
   */
  async sendPartnerWelcome(params: {
    partnerName: string;
    partnerEmail: string;
    projectName: string;
    referralCode: string;
    baseUrl: string;
  }): Promise<boolean> {
    const referralLink = `${params.baseUrl}/api/t/${params.referralCode}`;

    const result = await this.sendEmail({
      to: params.partnerEmail,
      subject: `Welcome to the ${params.projectName} affiliate program!`,
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 560px; margin: 0 auto;">
          <h2 style="color: #1a1a1a;">Welcome aboard, ${params.partnerName}!</h2>
          <p style="color: #555; line-height: 1.6;">
            You've been approved as an affiliate partner for <strong>${params.projectName}</strong>.
            Start sharing your unique referral link to earn commissions on every customer you refer.
          </p>
          <div style="background: #f5f5f5; border-radius: 8px; padding: 16px; margin: 24px 0;">
            <p style="margin: 0 0 8px; font-size: 13px; color: #888;">Your referral link:</p>
            <p style="margin: 0; font-family: monospace; font-size: 14px; color: #1a1a1a; word-break: break-all;">
              ${referralLink}
            </p>
          </div>
          <p style="color: #555; line-height: 1.6;">
            Your referral code is <strong>${params.referralCode}</strong>. Append <code>?ref=${params.referralCode}</code>
            to any link to track referrals.
          </p>
          <p style="color: #888; font-size: 13px; margin-top: 32px;">
            — The ${params.projectName} team via UnlockAffiliate
          </p>
        </div>
      `,
    });

    return result !== null;
  }

  /**
   * Send a notification when a partner applies and needs approval.
   */
  async sendPartnerApplicationReceived(params: {
    partnerName: string;
    partnerEmail: string;
    projectName: string;
  }): Promise<boolean> {
    const result = await this.sendEmail({
      to: params.partnerEmail,
      subject: `Application received — ${params.projectName} affiliate program`,
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 560px; margin: 0 auto;">
          <h2 style="color: #1a1a1a;">Thanks for applying, ${params.partnerName}!</h2>
          <p style="color: #555; line-height: 1.6;">
            Your application to join the <strong>${params.projectName}</strong> affiliate program has been received.
            We'll review it and get back to you shortly.
          </p>
          <p style="color: #555; line-height: 1.6;">
            Once approved, you'll receive your unique referral link to start earning commissions.
          </p>
          <p style="color: #888; font-size: 13px; margin-top: 32px;">
            — The ${params.projectName} team via UnlockAffiliate
          </p>
        </div>
      `,
    });

    return result !== null;
  }

  /**
   * Send a one-time code (OTP) for partner login via the join page.
   */
  async sendPartnerOtp(params: {
    partnerEmail: string;
    projectName: string;
    code: string;
  }): Promise<boolean> {
    const result = await this.sendEmail({
      to: params.partnerEmail,
      subject: `Your sign-in code for ${params.projectName}`,
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 560px; margin: 0 auto;">
          <h2 style="color: #1a1a1a;">Your one-time sign-in code</h2>
          <p style="color: #555; line-height: 1.6;">
            Use the code below to continue signing in to the <strong>${params.projectName}</strong> partner program.
          </p>
          <div style="background: #f5f5f5; border-radius: 8px; padding: 16px; margin: 24px 0; text-align: center;">
            <div style="font-size: 28px; font-weight: 600; letter-spacing: 6px; color: #1a1a1a;">
              ${params.code}
            </div>
            <p style="margin-top: 8px; font-size: 13px; color: #888;">
              This code expires in 10 minutes.
            </p>
          </div>
          <p style="color: #888; font-size: 13px; margin-top: 32px;">
            If you didn't try to sign in, you can safely ignore this email.
          </p>
          <p style="color: #888; font-size: 13px; margin-top: 12px;">
            — The ${params.projectName} team via UnlockAffiliate
          </p>
        </div>
      `,
    });

    return result !== null;
  }
}
