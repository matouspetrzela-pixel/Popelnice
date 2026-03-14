import nodemailer from "nodemailer";
import { EMAIL_CONFIG, assertEmailConfig } from "./config";

assertEmailConfig();

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: EMAIL_CONFIG.gmailUser,
    pass: EMAIL_CONFIG.gmailAppPassword,
  },
});

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export async function sendEmail(message: EmailMessage): Promise<void> {
  const to = message.to.trim();
  if (!to) {
    throw new Error("E-mail příjemce není vyplněn.");
  }

  await transporter.sendMail({
    from: `"Popelnice" <${EMAIL_CONFIG.gmailUser}>`,
    to,
    subject: message.subject,
    text: message.text,
    html: message.html ?? message.text,
  });
}
