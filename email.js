'use strict';

/**
 * email.js — Saudaa transactional email service
 *
 * Uses Nodemailer with SMTP transport.
 * Compatible with any SMTP server: Gmail, SendGrid, AWS SES, Mailgun, etc.
 *
 * Required env vars:
 *   EMAIL_HOST     SMTP hostname        (e.g. smtp.gmail.com)
 *   EMAIL_PORT     SMTP port            (587 for TLS, 465 for SSL)
 *   EMAIL_SECURE   true if port 465     (optional, defaults false)
 *   EMAIL_USER     SMTP username / API key
 *   EMAIL_PASS     SMTP password / API key secret
 *   EMAIL_FROM     Sender address       (e.g. Saudaa <noreply@saudaa.in>)
 *
 * If any required var is missing, email dispatch is silently skipped and a
 * warning is logged — the server continues running without crashing.
 */

const nodemailer = require('nodemailer');

// ── Transport ─────────────────────────────────────────────────────────────────

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;

  const { EMAIL_HOST, EMAIL_PORT, EMAIL_SECURE, EMAIL_USER, EMAIL_PASS } = process.env;

  if (!EMAIL_HOST || !EMAIL_USER || !EMAIL_PASS) {
    console.warn(
      '[EMAIL] SMTP credentials not configured (EMAIL_HOST / EMAIL_USER / EMAIL_PASS missing). ' +
      'Transactional emails are disabled. Set these variables in Vercel Dashboard → Settings → ' +
      'Environment Variables to enable post-subscription emails.'
    );
    return null;
  }

  transporter = nodemailer.createTransport({
    host: EMAIL_HOST,
    port: parseInt(EMAIL_PORT || '587', 10),
    secure: EMAIL_SECURE === 'true', // true → port 465 SSL; false → port 587 STARTTLS
    auth: { user: EMAIL_USER, pass: EMAIL_PASS },
    // Limit connection pool to avoid overwhelming free SMTP quotas
    pool: true,
    maxConnections: 3,
    maxMessages: 100,
  });

  return transporter;
}

// ── HTML Template ─────────────────────────────────────────────────────────────

/**
 * Build the subscription confirmation email HTML.
 *
 * All user-facing strings are HTML-entity-escaped before insertion to prevent
 * email client injection (belt-and-suspenders alongside the sanitize() call
 * upstream in server.js).
 */
function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

function buildSubscriptionEmail({
  email,
  subId,
  traderName,
  traderStrategy,
  traderRoi,
  plan,
  planName,
  planFeatures,
  amount,
  paymentId,
  timestamp,
  expiresAt,
  isNewAccount,
}) {
  const safeEmail       = escapeHtml(email);
  const safeSubId       = escapeHtml(subId);
  const safeTraderName  = escapeHtml(traderName);
  const safeStrategy    = escapeHtml(traderStrategy || 'Professional Trading');
  const safeRoi         = escapeHtml(String(traderRoi || '—'));
  const safePlan        = escapeHtml(planName || plan);
  const safeAmount      = escapeHtml(String(amount));
  const safePaymentId   = escapeHtml(paymentId || 'N/A');
  const safeExpiresAt   = escapeHtml(new Date(expiresAt).toLocaleDateString('en-IN', {
    day: '2-digit', month: 'long', year: 'numeric'
  }));
  const safeTxDate      = escapeHtml(new Date(timestamp).toLocaleDateString('en-IN', {
    day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit'
  }));

  const featuresHtml = (planFeatures || [])
    .map(f => `
      <tr>
        <td style="padding:4px 0;font-size:14px;color:#c8d8c0;">
          <span style="color:#7ab648;margin-right:8px;">✓</span>${escapeHtml(f)}
        </td>
      </tr>`)
    .join('');

  const loginUrl = process.env.APP_URL || 'https://saudaa.vercel.app';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Welcome to Saudaa — Subscription Confirmed</title>
  <!--[if mso]>
  <noscript><xml><o:OfficeDocumentSettings>
    <o:PixelsPerInch>96</o:PixelsPerInch>
  </o:OfficeDocumentSettings></xml></noscript>
  <![endif]-->
</head>
<body style="margin:0;padding:0;background-color:#0f1a0f;font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;">

  <!-- Email wrapper -->
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"
         style="background-color:#0f1a0f;">
    <tr>
      <td align="center" style="padding:40px 16px;">

        <!-- Card container — max 600px wide -->
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"
               style="max-width:600px;background-color:#1a2e1a;border-radius:12px;
                      border:1px solid #2d4a2d;overflow:hidden;">

          <!-- ── Header ── -->
          <tr>
            <td style="background:linear-gradient(135deg,#1e3d1e 0%,#2d5a2d 100%);
                        padding:36px 40px;text-align:center;
                        border-bottom:2px solid #42682b;">
              <!-- Wordmark -->
              <div style="font-size:32px;font-weight:800;letter-spacing:4px;
                           color:#ffffff;text-transform:uppercase;">
                SAUDAA
              </div>
              <div style="font-size:12px;color:#7ab648;letter-spacing:2px;
                           margin-top:4px;text-transform:uppercase;">
                Verified Traders Marketplace
              </div>
              <!-- Confirmation badge -->
              <div style="margin-top:24px;display:inline-block;
                           background-color:rgba(74,163,74,0.15);
                           border:1px solid #4aa34a;border-radius:20px;
                           padding:8px 20px;">
                <span style="color:#4aa34a;font-size:13px;font-weight:600;">
                  ✓ &nbsp;Subscription Confirmed
                </span>
              </div>
            </td>
          </tr>

          <!-- ── Greeting ── -->
          <tr>
            <td style="padding:36px 40px 0 40px;">
              <h1 style="margin:0 0 12px 0;font-size:22px;font-weight:700;color:#ffffff;
                          line-height:1.3;">
                Welcome aboard${isNewAccount ? ' — your account is ready' : ''}!
              </h1>
              <p style="margin:0;font-size:15px;color:#b0c8b0;line-height:1.6;">
                Thank you for subscribing to <strong style="color:#7ab648;">${safeTraderName}</strong>
                on Saudaa. Your subscription is active and you can start accessing exclusive
                trade signals immediately.
              </p>
            </td>
          </tr>

          <!-- ── Invoice Summary ── -->
          <tr>
            <td style="padding:28px 40px 0 40px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"
                     style="background-color:#0f1a0f;border-radius:8px;
                             border:1px solid #2d4a2d;overflow:hidden;">
                <!-- Invoice header -->
                <tr>
                  <td colspan="2"
                      style="padding:14px 20px;background-color:#162616;
                             border-bottom:1px solid #2d4a2d;">
                    <span style="font-size:11px;font-weight:700;color:#7ab648;
                                  letter-spacing:1.5px;text-transform:uppercase;">
                      Invoice Summary
                    </span>
                  </td>
                </tr>
                <!-- Rows -->
                <tr>
                  <td style="padding:12px 20px 4px 20px;font-size:13px;color:#7a9a7a;">Transaction ID</td>
                  <td style="padding:12px 20px 4px 20px;font-size:13px;color:#d0e8d0;
                              text-align:right;font-family:monospace;">${safePaymentId}</td>
                </tr>
                <tr>
                  <td style="padding:4px 20px;font-size:13px;color:#7a9a7a;">Date & Time</td>
                  <td style="padding:4px 20px;font-size:13px;color:#d0e8d0;text-align:right;">${safeTxDate} IST</td>
                </tr>
                <tr>
                  <td style="padding:4px 20px;font-size:13px;color:#7a9a7a;">Plan</td>
                  <td style="padding:4px 20px;font-size:13px;color:#d0e8d0;text-align:right;">${safePlan}</td>
                </tr>
                <tr>
                  <td style="padding:4px 20px 4px 20px;font-size:13px;color:#7a9a7a;">Valid Until</td>
                  <td style="padding:4px 20px;font-size:13px;color:#d0e8d0;text-align:right;">${safeExpiresAt}</td>
                </tr>
                <!-- Total -->
                <tr>
                  <td colspan="2"
                      style="padding:0;border-top:1px solid #2d4a2d;"></td>
                </tr>
                <tr>
                  <td style="padding:14px 20px;font-size:15px;font-weight:700;color:#ffffff;">
                    Amount Paid
                  </td>
                  <td style="padding:14px 20px;font-size:18px;font-weight:800;
                              color:#7ab648;text-align:right;">
                    ₹${safeAmount}
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- ── Account Credentials ── -->
          <tr>
            <td style="padding:28px 40px 0 40px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"
                     style="background-color:#0f1a0f;border-radius:8px;
                             border:1px solid #2d4a2d;overflow:hidden;">
                <tr>
                  <td colspan="2"
                      style="padding:14px 20px;background-color:#162616;
                             border-bottom:1px solid #2d4a2d;">
                    <span style="font-size:11px;font-weight:700;color:#7ab648;
                                  letter-spacing:1.5px;text-transform:uppercase;">
                      Your Account Details
                    </span>
                  </td>
                </tr>
                <tr>
                  <td style="padding:12px 20px 4px 20px;font-size:13px;color:#7a9a7a;">Login Email</td>
                  <td style="padding:12px 20px 4px 20px;font-size:13px;color:#d0e8d0;
                              text-align:right;">${safeEmail}</td>
                </tr>
                <tr>
                  <td style="padding:4px 20px 14px 20px;font-size:13px;color:#7a9a7a;">Account ID</td>
                  <td style="padding:4px 20px 14px 20px;text-align:right;">
                    <span style="display:inline-block;background-color:#1e3d1e;
                                  border:1px solid #42682b;border-radius:4px;
                                  padding:4px 10px;font-family:monospace;
                                  font-size:13px;font-weight:700;color:#7ab648;
                                  letter-spacing:1px;">
                      ${safeSubId}
                    </span>
                  </td>
                </tr>
                ${isNewAccount ? `
                <tr>
                  <td colspan="2"
                      style="padding:0 20px 16px 20px;">
                    <p style="margin:0;font-size:12px;color:#7a9a7a;line-height:1.5;">
                      🔒 &nbsp;Your account was created with the password you set during checkout.
                      Keep your Account ID safe — you may need it for support requests.
                    </p>
                  </td>
                </tr>` : ''}
              </table>
            </td>
          </tr>

          <!-- ── Trader Details ── -->
          <tr>
            <td style="padding:28px 40px 0 40px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"
                     style="background-color:#0f1a0f;border-radius:8px;
                             border:1px solid #2d4a2d;overflow:hidden;">
                <tr>
                  <td colspan="2"
                      style="padding:14px 20px;background-color:#162616;
                             border-bottom:1px solid #2d4a2d;">
                    <span style="font-size:11px;font-weight:700;color:#7ab648;
                                  letter-spacing:1.5px;text-transform:uppercase;">
                      Your Trader
                    </span>
                  </td>
                </tr>
                <tr>
                  <td style="padding:16px 20px;">
                    <div style="font-size:17px;font-weight:700;color:#ffffff;
                                 margin-bottom:4px;">${safeTraderName}</div>
                    <div style="font-size:13px;color:#7ab648;margin-bottom:10px;">${safeStrategy}</div>
                    ${safeRoi !== '—' ? `
                    <div style="display:inline-block;background-color:rgba(74,163,74,0.12);
                                  border:1px solid #2d6b2d;border-radius:4px;
                                  padding:3px 10px;font-size:12px;color:#7ab648;">
                      Avg ROI: +${safeRoi}%
                    </div>` : ''}
                  </td>
                  <td style="padding:16px 20px;vertical-align:top;">
                    <div style="font-size:11px;color:#7a9a7a;margin-bottom:4px;
                                 text-transform:uppercase;letter-spacing:1px;">Plan Includes</div>
                    <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                      ${featuresHtml}
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- ── CTA Button ── -->
          <tr>
            <td style="padding:32px 40px 0 40px;text-align:center;">
              <a href="${loginUrl}"
                 style="display:inline-block;background-color:#42682b;
                         color:#ffffff;text-decoration:none;font-size:15px;
                         font-weight:700;padding:14px 36px;border-radius:6px;
                         letter-spacing:0.5px;">
                Access My Dashboard →
              </a>
              <p style="margin:12px 0 0 0;font-size:12px;color:#5a7a5a;">
                Log in with your email and the password you set during checkout.
              </p>
            </td>
          </tr>

          <!-- ── Support Note ── -->
          <tr>
            <td style="padding:28px 40px 0 40px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"
                     style="background-color:rgba(66,104,43,0.1);border-radius:8px;
                             border-left:3px solid #42682b;">
                <tr>
                  <td style="padding:14px 16px;">
                    <p style="margin:0;font-size:13px;color:#b0c8b0;line-height:1.5;">
                      <strong style="color:#ffffff;">Need help?</strong>
                      Reply to this email or contact us at
                      <a href="mailto:support@saudaa.in"
                         style="color:#7ab648;text-decoration:none;">support@saudaa.in</a>.
                      Quote your Account ID <strong style="color:#7ab648;">${safeSubId}</strong>
                      for faster resolution.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- ── Footer ── -->
          <tr>
            <td style="padding:32px 40px;border-top:1px solid #2d4a2d;margin-top:28px;
                        text-align:center;">
              <p style="margin:0 0 8px 0;font-size:11px;color:#4a6a4a;line-height:1.6;">
                Saudaa Research & Analytics Pvt. Ltd. · Mumbai, Maharashtra, India
              </p>
              <p style="margin:0 0 12px 0;font-size:10px;color:#3a5a3a;line-height:1.6;">
                <strong>SEBI Disclaimer:</strong> Saudaa is a research &amp; education platform.
                All content is for informational purposes only and does not constitute SEBI-registered
                investment advice. Past performance is not indicative of future results.
                Investing in securities involves risk.
              </p>
              <p style="margin:0;font-size:10px;color:#3a5a3a;">
                You are receiving this email because you subscribed on
                <a href="${loginUrl}" style="color:#4a6a4a;text-decoration:none;">saudaa.vercel.app</a>.
                &nbsp;·&nbsp;
                <a href="${loginUrl}" style="color:#4a6a4a;text-decoration:none;">Unsubscribe</a>
              </p>
            </td>
          </tr>

        </table>
        <!-- / Card -->

      </td>
    </tr>
  </table>
  <!-- / Wrapper -->

</body>
</html>`;
}

// ── Plain-text fallback ───────────────────────────────────────────────────────

function buildSubscriptionTextEmail({
  email, subId, traderName, plan, planName, amount, paymentId, timestamp, expiresAt,
}) {
  const txDate   = new Date(timestamp).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
  const expDate  = new Date(expiresAt).toLocaleDateString('en-IN');
  const loginUrl = process.env.APP_URL || 'https://saudaa.vercel.app';

  return `
SAUDAA — Subscription Confirmed
================================

Thank you for subscribing to ${traderName} on Saudaa!

INVOICE SUMMARY
---------------
Transaction ID : ${paymentId || 'N/A'}
Date & Time    : ${txDate} IST
Plan           : ${planName || plan}
Valid Until    : ${expDate}
Amount Paid    : INR ${amount}

YOUR ACCOUNT
------------
Login Email    : ${email}
Account ID     : ${subId}

Log in at: ${loginUrl}

Use your email and the password you set during checkout.
Keep your Account ID handy for any support requests.

---
Saudaa Research & Analytics Pvt. Ltd. · Mumbai, India
SEBI Disclaimer: Saudaa is a research & education platform. Content is for informational
purposes only and does not constitute SEBI-registered investment advice.
`.trim();
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * sendSubscriptionConfirmation — dispatches the welcome email after a
 * successful subscription. Non-throwing: logs errors and returns false on
 * failure so the caller's HTTP response is never blocked.
 *
 * @param {object} params
 * @param {string} params.email           Subscriber email address
 * @param {string} params.subId           Premium account ID (e.g. SA-1234-ELITE)
 * @param {string} params.traderId        Trader ID
 * @param {string} params.traderName      Trader display name
 * @param {string} [params.traderStrategy] Trader strategy label
 * @param {number} [params.traderRoi]     Trader avg ROI figure
 * @param {string} params.plan            Plan ID (standard / pro / vip)
 * @param {string} [params.planName]      Human-readable plan name
 * @param {Array}  [params.planFeatures]  List of plan feature strings
 * @param {number} params.amount          Amount paid (INR)
 * @param {string} params.paymentId       Razorpay / mock payment ID
 * @param {string} params.timestamp       ISO timestamp of the transaction
 * @param {string} params.expiresAt       ISO timestamp of subscription expiry
 * @param {boolean} params.isNewAccount   true if this is a brand-new account
 * @returns {Promise<boolean>} true if sent, false if skipped/failed
 */
async function sendSubscriptionConfirmation(params) {
  const transport = getTransporter();
  if (!transport) return false; // SMTP not configured — skip silently

  const fromAddress = process.env.EMAIL_FROM || 'Saudaa <noreply@saudaa.in>';

  const mailOptions = {
    from: fromAddress,
    to: params.email,
    subject: `✅ Subscription Confirmed — ${params.traderName} · Saudaa`,
    text: buildSubscriptionTextEmail(params),
    html: buildSubscriptionEmail(params),
  };

  try {
    const info = await transport.sendMail(mailOptions);
    console.log(`[EMAIL] Subscription confirmation sent to ${params.email} — messageId: ${info.messageId}`);
    return true;
  } catch (err) {
    // Never throw — a failed email must not roll back a successful payment
    console.error(`[EMAIL] Failed to send subscription confirmation to ${params.email}:`, err.message);
    return false;
  }
}

module.exports = { sendSubscriptionConfirmation };
