import type { LegalKey } from './index'

/**
 * English legal copy (Privacy Policy / Terms of Service / Acceptable Use Policy).
 *
 * Legal text follows the law, not the feature set, so it lives outside the UI
 * dictionary and only ships for languages with a reviewed translation.
 * Everything else falls back to this file (see `legal/index.ts`).
 */
export const en: Record<LegalKey, string> = {
  'legal.privacy.intro':
    'This Privacy Policy explains how {entity} (“we”, “us”), operating Forge under the business name {business}, collects, uses and shares personal information when you use {url} and related services (the “Service”). For privacy questions or requests, contact {email}.',
  'legal.privacy.s1.title': 'Information We Collect',
  'legal.privacy.s1.body':
    'We collect:\n• Account information: your email address, password hash (or Google account identifier if you sign in with Google), and language/theme preferences.\n• Content you provide: prompts, chat messages, attachments, and the source code and websites generated from them.\n• Billing information: your credit balance, purchase and subscription records, and order identifiers. Payments are processed by Creem; we do not receive or store your full card number.\n• Usage and technical information: IP address, request timestamps, job usage, error logs and similar data used for security, abuse prevention and operation of the Service.\n• Local storage: a session cookie and browser preferences such as language, theme and panel width. We do not use advertising cookies.',
  'legal.privacy.s2.title': 'How We Use Information',
  'legal.privacy.s2.body':
    '• Provide, operate and improve the Service, including running AI generation jobs.\n• Manage credits, subscriptions, invoices and refunds.\n• Protect the Service against abuse, fraud, spam and security incidents.\n• Respond to support requests and enforce our Terms of Service and Acceptable Use Policy.\n• Comply with legal obligations.',
  'legal.privacy.s3.title': 'Legal Bases (EEA / UK)',
  'legal.privacy.s3.body':
    'Where GDPR applies, we rely on: performance of a contract (providing the Service), legitimate interests (security, abuse prevention, improving the Service), consent (optional communications), and legal obligations (tax, accounting, lawful requests).',
  'legal.privacy.s4.title': 'How We Share Information',
  'legal.privacy.s4.body':
    'We share personal information only with service providers that help us operate the Service:\n• Cloudflare — hosting, databases, object storage and security.\n• Google Cloud — running the coding agent that generates your projects.\n• AI model providers — your prompts and relevant project content are sent to the model provider used to generate output.\n• Creem — payment processing, invoicing, tax and subscription management as Merchant of Record.\nWe do not sell personal information. We may disclose information if required by law or to protect rights, safety and security.',
  'legal.privacy.s5.title': 'International Transfers',
  'legal.privacy.s5.body':
    'Your information may be processed in countries other than your own, including the United States. Where required, we rely on appropriate safeguards such as standard contractual clauses.',
  'legal.privacy.s6.title': 'Retention',
  'legal.privacy.s6.body':
    'We retain account and content data while your account is active and for a reasonable period afterwards to comply with legal obligations, resolve disputes and prevent abuse. Server logs are kept for a limited period. You may delete projects at any time; backups may persist briefly.',
  'legal.privacy.s7.title': 'Your Rights',
  'legal.privacy.s7.body':
    'Depending on your location, you may have the right to access, correct, export or delete your personal information, object to or restrict processing, and withdraw consent. To exercise these rights, email {email}. You may also complain to your local data protection authority.',
  'legal.privacy.s8.title': 'Children',
  'legal.privacy.s8.body':
    'The Service is not intended for children under 16. We do not knowingly collect personal information from children under 16. If you believe a child has provided information, contact us and we will delete it.',
  'legal.privacy.s9.title': 'Security',
  'legal.privacy.s9.body':
    'We use reasonable technical and organizational measures, including encryption in transit, access controls and isolated environments. No method of transmission or storage is completely secure.',
  'legal.privacy.s10.title': 'Changes and Contact',
  'legal.privacy.s10.body':
    'We may update this Privacy Policy from time to time. Material changes will be posted on this page with a new effective date. Contact: {email}. Website: {url}.',

  // terms of service
  'legal.terms.intro':
    'These Terms of Service (the “Terms”) govern your access to and use of Forge at {url} (the “Service”). Forge is operated by {entity} under the business name {business}. By creating an account or using the Service, you agree to these Terms, our Privacy Policy and our Acceptable Use Policy. If you do not agree, do not use the Service.',
  'legal.terms.s1.title': 'Eligibility',
  'legal.terms.s1.body':
    'You must be at least 16 years old and able to form a binding contract. If you are under 18, you must have permission from a parent or legal guardian.',
  'legal.terms.s2.title': 'The Service',
  'legal.terms.s2.body':
    'Forge lets you describe a website or application in natural language and uses AI to generate source code, build artifacts and publishable pages. The Service is provided on an “as is” and “as available” basis and may change over time.',
  'legal.terms.s3.title': 'Accounts',
  'legal.terms.s3.body':
    'You must provide accurate information, keep your credentials secure, and are responsible for activity under your account. Notify us promptly of unauthorized use. One account per person; do not share accounts.',
  'legal.terms.s4.title': 'Credits, Subscriptions and Payments',
  'legal.terms.s4.body':
    '• The Service uses prepaid credits. Each generation or modification consumes credits as shown on the Pricing page.\n• Credits have no cash value, are non-transferable, and may not be resold. Credits do not expire.\n• Credit packs and subscriptions are priced in U.S. dollars; current prices are shown on the Pricing page.\n• Subscriptions renew automatically each month until canceled. You may cancel at any time; cancellation takes effect at the end of the current billing period. Credits already granted for the current period remain available.\n• Creem acts as the Merchant of Record for all purchases. Creem processes payment, issues invoices, handles applicable taxes, and processes refunds. Your card statement will show Creem.\n• Refund requests: contact {email}. Unused credits may be refunded at our discretion within 14 days of purchase. Credits already consumed are non-refundable. Nothing in these Terms limits mandatory consumer rights.',
  'legal.terms.s5.title': 'Your Content',
  'legal.terms.s5.body':
    '• You retain ownership of the prompts, files and other content you submit (“Input”) and of the websites and code generated for you (“Output”), subject to third-party rights and our rights in the platform.\n• You grant us a worldwide, non-exclusive, royalty-free license to host, store, process, transmit, display and publish your Input and Output solely to operate and provide the Service, including publishing pages at your request.\n• You are responsible for ensuring you have the rights to your Input and that your Output does not infringe third-party rights.\n• AI Output may be inaccurate, incomplete or similar to content generated for others. You must review Output before publishing or relying on it.',
  'legal.terms.s6.title': 'Acceptable Use',
  'legal.terms.s6.body':
    'Your use of the Service must comply with our Acceptable Use Policy, which is incorporated into these Terms. Prohibited uses include illegal content, sexual or pornographic content, content sexualizing minors, hate, harassment, malware, phishing, spam, fraud, and infringement of intellectual property. We may remove content and suspend or terminate accounts that violate these Terms.',
  'legal.terms.s7.title': 'Published Sites',
  'legal.terms.s7.body':
    'You control whether a project is published. Published pages are publicly accessible. We may remove or disable content that violates these Terms or applicable law, or that we reasonably believe creates risk. To report abuse, email {email}.',
  'legal.terms.s8.title': 'AI Disclaimer',
  'legal.terms.s8.body':
    'The Service uses generative AI. Output may contain errors, outdated information or unintended content. We do not guarantee that Output is accurate, complete, fit for a particular purpose, or free of third-party rights. Do not rely on Output for legal, medical, financial or other professional advice.',
  'legal.terms.s9.title': 'Availability and Changes',
  'legal.terms.s9.body':
    'We may modify, suspend or discontinue features, and may impose usage limits to protect the Service. We do not guarantee uninterrupted availability. Beta features may be changed or removed without notice.',
  'legal.terms.s10.title': 'Termination',
  'legal.terms.s10.body':
    'You may stop using the Service at any time. We may suspend or terminate your access if you violate these Terms, create risk or legal exposure, or fail to pay. On termination, your right to use the Service ends; provisions that by nature should survive (including payment obligations, disclaimers and liability limits) survive.',
  'legal.terms.s11.title': 'Intellectual Property',
  'legal.terms.s11.body':
    'The Service, including the platform, software, design and trademarks, is owned by us or our licensors. These Terms do not grant you rights to our trademarks or platform except as necessary to use the Service. If you provide feedback, we may use it without obligation.',
  'legal.terms.s12.title': 'Disclaimers and Limitation of Liability',
  'legal.terms.s12.body':
    'To the maximum extent permitted by law, the Service is provided “as is” and “as available”, without warranties of any kind, express or implied, including merchantability, fitness for a particular purpose, non-infringement and accuracy. To the maximum extent permitted by law, we are not liable for indirect, incidental, special, consequential or punitive damages, or for lost profits, revenue, data or goodwill. Our aggregate liability arising out of or relating to the Service will not exceed the amount you paid us in the 12 months before the event giving rise to the claim. Nothing limits liability that cannot be limited by law.',
  'legal.terms.s13.title': 'Indemnity',
  'legal.terms.s13.body':
    'You agree to indemnify and hold us harmless from claims and costs arising from your Input, your Output, your published sites, or your violation of these Terms or applicable law.',
  'legal.terms.s14.title': 'Governing Law and Disputes',
  'legal.terms.s14.body':
    'These Terms are governed by the laws applicable to the operator of the Service, without regard to conflict-of-law rules. If you are a consumer, you may also benefit from mandatory consumer protection rules in your country of residence. Before starting formal proceedings, contact us at {email} so we can try to resolve the issue.',
  'legal.terms.s15.title': 'Changes and Contact',
  'legal.terms.s15.body':
    'We may update these Terms from time to time. The updated version will be posted on this page with a new effective date. Material changes will be communicated by email or through the Service. Continued use after the effective date means you accept the updated Terms. Contact: {email}. Website: {url}.',

  // acceptable use policy
  'legal.aup.intro':
    'This Acceptable Use Policy (the “AUP”) explains what you may not do with Forge, which is operated by {entity} under the business name {business}. It applies to prompts, uploaded files, generated code and websites, and published pages. It is part of our Terms of Service. Violations may result in removal, suspension or termination.',
  'legal.aup.s1.title': 'Illegal and Harmful Content',
  'legal.aup.s1.body':
    'Do not create, generate, upload, publish or distribute content that:\n• violates any law or regulation;\n• promotes or facilitates violence, terrorism, self-harm or human trafficking;\n• is hateful, harassing, threatening, bullying or defamatory;\n• infringes intellectual property, privacy or publicity rights;\n• is deceptive, fraudulent or phishing, or impersonates a person or organization.',
  'legal.aup.s2.title': 'Sexual and Adult Content (Explicit Prohibition)',
  'legal.aup.s2.body':
    'Sexually explicit, pornographic, adult or NSFW content is strictly prohibited. This includes generated text, images, links or websites; sexual services or escort content; non-consensual intimate imagery; and any content that sexualizes minors. We report apparent child sexual abuse material to the relevant authorities.',
  'legal.aup.s3.title': 'Malware, Spam and Abuse',
  'legal.aup.s3.body':
    'Do not:\n• distribute malware, viruses, ransomware or malicious code;\n• send spam or run deceptive marketing;\n• scrape, overload, probe or circumvent security measures or rate limits;\n• use the Service to build phishing, scam, gambling or fraudulent financial sites;\n• create fake official sites or impersonate governments, banks or other organizations.',
  'legal.aup.s4.title': 'Regulated and Dangerous Goods',
  'legal.aup.s4.body':
    'Do not use the Service to sell or promote weapons, illegal drugs, unlicensed pharmaceuticals, or other regulated goods or services without authorization.',
  'legal.aup.s5.title': 'Privacy and Data',
  'legal.aup.s5.body':
    'Do not collect, publish or misuse personal data without consent, dox individuals, or use the Service to surveil or track people.',
  'legal.aup.s6.title': 'Published Sites, Moderation and Enforcement',
  'legal.aup.s6.body':
    'Projects may be published publicly. We may review, remove, unpublish or restrict any content that violates this AUP or the Terms. To report abuse or request a takedown, email {email} with the URL and details. We aim to respond promptly, especially to reports involving illegal or non-consensual content. We may warn, remove content, suspend or terminate accounts, and report illegal activity to authorities. We may also preserve and disclose information as required by law.',
  'legal.aup.s7.title': 'Contact',
  'legal.aup.s7.body': 'Questions about this AUP: {email}.'
}
