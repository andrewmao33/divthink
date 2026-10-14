import { onLinkClick } from './nav'
import SiteShell from './SiteShell'
import styles from './Privacy.module.css'

const CONTACT = 'andrewmao33@gmail.com'

function Terms() {
  return (
    <SiteShell current="terms">
      <article className={styles.article}>
        <h1 className={styles.title}>Terms of Service</h1>
        <p className={styles.updated}>Last updated · October 14, 2026</p>

        <div className={styles.body}>
          <p>
            Divthink is a canvas for branching conversations with AI models. It is built and run
            by Andrew Mao, an individual developer. These terms are the agreement between you and
            Divthink when you use it. By signing in, you agree to them.
          </p>
          <p>
            The short version: use Divthink lawfully, look after your API keys, check what the AI
            tells you, and cancel Pro whenever you like. Payments are not refunded.
          </p>

          <h2>1. Who can use Divthink</h2>
          <p>
            You must be at least 13 years old. If you are under the age of majority where you
            live, a parent or guardian must agree to these terms for you.
          </p>

          <h2>2. Your account</h2>
          <ul>
            <li>You sign in with Google or with a one-time code sent to your email.</li>
            <li>
              You are responsible for what happens under your account, and for keeping access to
              your email and Google account secure.
            </li>
            <li>
              <strong>Your API keys.</strong> Replies are generated with the Anthropic or Google
              API key you save. You are responsible for that key, for the provider's terms that
              come with it, and for what the provider charges you. Setting a spending limit with
              your provider is a good idea.
            </li>
          </ul>

          <h2>3. Using Divthink</h2>
          <p>You agree not to:</p>
          <ul>
            <li>use Divthink for anything illegal, or to harm or harass anyone;</li>
            <li>
              break the usage policies of the AI provider you send requests to through Divthink;
            </li>
            <li>
              try to get into other people's accounts or data, or into parts of the service you
              are not meant to reach;
            </li>
            <li>
              overload, disrupt or attack the service, or use automated means to make heavy use
              of it;
            </li>
            <li>get around the limits of your plan.</li>
          </ul>
          <p>
            Divthink may suspend or close an account that breaks these terms. Where it is
            reasonable to, you will be told why first.
          </p>

          <h2>4. What the AI writes</h2>
          <p>
            Replies are written by AI models from Anthropic and Google, not by Divthink. They can
            be wrong, incomplete or out of date. Check anything important before you rely on it,
            and do not treat a reply as professional advice, whether medical, legal, financial or
            otherwise.
          </p>

          <h2>5. Your content</h2>
          <p>
            What you write and attach, and the replies you get, belong to you as far as the law
            and your AI provider's terms allow. You give Divthink permission to store and process
            them only to run the service for you: to save your canvases, show them to you, and
            send them to the provider you choose. How that data is handled is described in the{' '}
            <a href="/privacy" onClick={onLinkClick}>
              Privacy Policy
            </a>
            . You can delete your content, or your whole account, at any time.
          </p>

          <h2>6. Plans and payment</h2>
          <ul>
            <li>
              <strong>Free</strong> costs nothing and has the limits shown on the pricing page.
            </li>
            <li>
              <strong>Pro</strong> costs $8 a month, in US dollars. Payments are handled by
              Stripe; Divthink never sees your card details.
            </li>
            <li>
              Pro <strong>renews automatically</strong> every month, and your payment method is
              charged at the start of each month, until you cancel.
            </li>
            <li>
              <strong>Cancel anytime</strong> under Settings → Billing → Manage subscription. You
              keep Pro until the end of the month you have paid for, and are not charged again.
            </li>
            <li>
              <strong>No refunds.</strong> Payments are not refunded, in full or in part,
              including for a month you cancel partway through. This does not affect any right
              to a refund you have under the law where you live.
            </li>
            <li>
              Prices may change. You will be told at least 30 days before a change applies to
              you, and can cancel before it does.
            </li>
          </ul>

          <h2>7. Changes to Divthink</h2>
          <p>
            Divthink is a small, actively developed service. Features, plans and limits may
            change, and it may sometimes be unavailable. If Divthink shuts down, you will be given
            notice and a chance to download your data first.
          </p>

          <h2>8. No warranty</h2>
          <p>
            Divthink is provided “as is” and “as available”, without warranties of any kind,
            including that it will be uninterrupted, error-free or fit for a particular purpose.
          </p>

          <h2>9. Limit of liability</h2>
          <p>
            As far as the law allows, Divthink is not liable for indirect or consequential losses,
            or for lost data, profits or business. Its total liability to you for any claim is
            limited to what you paid Divthink in the 12 months before the claim. Charges from
            your AI provider are between you and that provider.
          </p>

          <h2>10. Ending your use</h2>
          <p>
            You can stop using Divthink and delete your account at any time under Settings →
            Account. Deleting your account also cancels a Pro subscription.
          </p>

          <h2>11. Changes to these terms</h2>
          <p>
            When these terms change, the date at the top changes with it. Significant changes will
            be announced on this page, or by email, before they apply. Using Divthink after that
            means you accept the new terms.
          </p>

          <h2>12. Contact</h2>
          <p>
            For questions about these terms, email <a href={`mailto:${CONTACT}`}>{CONTACT}</a>.
          </p>
        </div>
      </article>
    </SiteShell>
  )
}

export default Terms
