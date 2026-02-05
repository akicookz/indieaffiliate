/**
 * Email service using Resend API.
 * Sends transactional emails via raw fetch (no SDK needed on Workers).
 */

interface SendEmailParams {
  to: string;
  subject: string;
  html: string;
  from?: string;
}

export class EmailService {
  private apiKey: string;
  private defaultFrom: string;

  constructor(apiKey: string, defaultFrom = "IndieAffiliate <noreply@indieaffiliate.com>") {
    this.apiKey = apiKey;
    this.defaultFrom = defaultFrom;
  }

  async sendEmail(params: SendEmailParams): Promise<{ id: string } | null> {
    if (!this.apiKey) {
      console.warn("RESEND_API_KEY not set, skipping email");
      return null;
    }

    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        from: params.from ?? this.defaultFrom,
        to: [params.to],
        subject: params.subject,
        html: params.html,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error("Resend email error:", error);
      return null;
    }

    return response.json();
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
    const referralLink = `${params.baseUrl}/api/t/${params.referralCode}`;

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
            Share your unique referral link to earn commissions on every customer you refer.
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
            — The ${params.projectName} team via IndieAffiliate
          </p>
        </div>
      `,
    });

    return result !== null;
  }

}
