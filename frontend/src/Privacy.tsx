import SiteShell from './SiteShell'
import styles from './Privacy.module.css'

const CONTACT = 'andrewmao33@gmail.com'

function Privacy() {
  return (
    <SiteShell current="privacy">
      <article className={styles.article}>
        <h1 className={styles.title}>Privacy Policy</h1>
        <p className={styles.updated}>Last updated · October 12, 2026</p>

        <div className={styles.body}>
          <p>
            Divthink is a canvas for branching conversations with AI models. It is built and run
            by Andrew Mao, an individual developer. This policy explains what Divthink stores
            about you, who else receives it, and how to have it deleted.
          </p>
          <p>
            The short version: Divthink stores your account, your canvases and your API keys so
            the app can work. It sends your conversations to the AI provider you choose so they
            can be answered. It does not sell your data, show ads, or track you.
          </p>

          <h2>1. What Divthink stores</h2>
          <ul>
            <li>
              <strong>Your account.</strong> The email address and account ID that Google provides
              when you sign in. Divthink never sees your Google password.
            </li>
            <li>
              <strong>Your canvases.</strong> The prompts you write, the replies the models
              return, and how they are connected.
            </li>
            <li>
              <strong>Files you attach.</strong> Images and PDFs you add to a prompt.
            </li>
            <li>
              <strong>Details about each reply.</strong> Which model wrote it, its title, the
              model's thinking summary when it gives one, how long it took, and how many tokens it
              used.
            </li>
            <li>
              <strong>How you arranged a canvas.</strong> Where you moved its cards and the sizes
              you gave them.
            </li>
            <li>
              <strong>Your API keys.</strong> Encrypted before they are saved. A key is decrypted
              only at the moment it is needed to generate a reply. It is never shown again and
              never sent back to your browser.
            </li>
          </ul>

          <h2>2. What Divthink does not collect</h2>
          <ul>
            <li>
              <strong>No passwords.</strong> Sign-in is handled entirely by Google.
            </li>
            <li>
              <strong>No payment details.</strong> You pay your AI provider directly, through your
              own account with them.
            </li>
            <li>
              <strong>No advertising or analytics trackers.</strong>
            </li>
          </ul>

          <h2>3. Who receives your data</h2>
          <p>Your data goes to two kinds of company, and nobody else.</p>
          <ul>
            <li>
              <strong>The AI provider you choose: Anthropic or Google.</strong> To generate a
              reply, Divthink sends your prompt, the earlier messages in that thread, and any
              files attached to them, using your own API key. Replies can search the web, and
              that search is carried out by the same provider. What the provider does with a
              request is governed by its own terms and privacy policy, under your account with
              it.
            </li>
            <li>
              <strong>The companies that host Divthink.</strong> Vercel serves the website,
              Railway runs the server, and Supabase provides the database and sign-in. They hold
              your data only to provide those services.
            </li>
          </ul>
          <p>
            Your data is never sold and never used for advertising. Other people who use Divthink
            cannot see your canvases.
          </p>

          <h2>4. What is kept in your browser</h2>
          <p>
            Your browser's local storage holds your sign-in session, the model you last picked,
            the canvas you last had open, and the size of the conversation panel and whether it
            is folded away. Divthink sets no advertising or tracking cookies.
          </p>

          <h2>5. Keeping and deleting your data</h2>
          <ul>
            <li>
              <strong>Canvases</strong> are kept until they are deleted. You can delete a whole
              canvas yourself from the menu, or any single card that nothing continues from.
              Either also removes the files attached to what was deleted.
            </li>
            <li>
              <strong>API keys</strong> can be removed at any time from the menu, under “API
              keys”.
            </li>
            <li>
              <strong>Your account and everything in it</strong> will be deleted on request.
              Email <a href={`mailto:${CONTACT}`}>{CONTACT}</a> from the address you signed in
              with.
            </li>
          </ul>

          <h2>6. Security</h2>
          <p>
            All traffic is encrypted in transit. API keys are encrypted at rest, with an
            encryption key that is held separately from the database. The database accepts
            connections only from the Divthink server.
          </p>
          <p>
            No service can promise perfect security. As a precaution, set a spending limit on any
            API key you save here.
          </p>

          <h2>7. Children</h2>
          <p>Divthink is not intended for children under 13.</p>

          <h2>8. Changes to this policy</h2>
          <p>
            When this policy changes, the date at the top changes with it. Significant changes
            will be described on this page.
          </p>

          <h2>9. Contact</h2>
          <p>
            For questions, or to ask for your data to be deleted, email{' '}
            <a href={`mailto:${CONTACT}`}>{CONTACT}</a>.
          </p>
        </div>
      </article>
    </SiteShell>
  )
}

export default Privacy
