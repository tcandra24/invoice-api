import { escapeHtml } from '../common/format.util';

export function buildPasswordResetEmail(d: {
  name: string;
  resetLink: string;
  ttlMinutes: number;
}) {
  const text = [
    `Hello ${d.name},`,
    '',
    'We received a request to reset the password for your account.',
    `Use the link below to choose a new password. The link is valid for ${d.ttlMinutes} minutes and can only be used once.`,
    '',
    d.resetLink,
    '',
    'If you did not request this, you can safely ignore this email. Your password will not change.',
  ].join('\n');

  const html = `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#222">
    <p>Hello ${escapeHtml(d.name)},</p>
    <p>We received a request to reset the password for your account.</p>
    <p>Use the button below to choose a new password. The link is valid for
    <strong>${d.ttlMinutes} minutes</strong> and can only be used once.</p>
    <p style="margin:24px 0">
      <a href="${escapeHtml(d.resetLink)}"
         style="background:#1f3864;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">
        Reset password
      </a>
    </p>
    <p style="color:#666;font-size:13px">If the button does not work, copy this link into your browser:<br>
    ${escapeHtml(d.resetLink)}</p>
    <p style="color:#666;font-size:13px">If you did not request this, you can safely ignore this email.
    Your password will not change.</p>
  </div>`;

  return { subject: 'Reset your password', text, html };
}

export function buildPasswordChangedEmail(d: { name: string }) {
  const text = [
    `Hello ${d.name},`,
    '',
    'The password for your account was just changed, and all devices were signed out.',
    'If this was you, no further action is needed.',
    'If it was not you, use "Forgot password" on the login page to reset your password immediately.',
  ].join('\n');

  const html = `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#222">
    <p>Hello ${escapeHtml(d.name)},</p>
    <p>The password for your account was just changed, and all devices were signed out.</p>
    <p>If this was you, no further action is needed.</p>
    <p>If it was <strong>not</strong> you, use "Forgot password" on the login page to reset your password immediately.</p>
  </div>`;

  return { subject: 'Your password has been changed', text, html };
}
