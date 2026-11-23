import type { ReactNode } from "react";
import {
  POLICY_SECTIONS,
  RESPONSE_TIMES,
  RESTORE_WINDOW_DAYS,
  RETENTION,
  days,
  type PrivacyContact,
  type SectionId,
} from "@/lib/privacy/policy";

function P({ children }: { children: ReactNode }) {
  return <p className="text-body [overflow-wrap:anywhere]">{children}</p>;
}

function List({ children }: { children: ReactNode }) {
  return <ul className="list-disc space-y-1 pl-5 text-body">{children}</ul>;
}

function bodies({ organisation, dpoEmail }: PrivacyContact): Record<SectionId, ReactNode> {
  return {
    who: (
      <P>
        {organisation} (we) uses Door to Door to record visits to people&apos;s homes and to follow
        them up later. This page says what the app records, why, and what you can ask of us. We
        follow Singapore&apos;s Personal Data Protection Act 2012.
      </P>
    ),
    collected: (
      <>
        <P>About people we visit:</P>
        <List>
          <li>The block and unit.</li>
          <li>
            A name, a contact and a religion, if you tell us. We keep the latest we know. Religion
            is sensitive, so we record it only if you chose to tell us.
          </li>
          <li>
            For each visit: how interested you seemed, the member&apos;s notes, the date and who
            recorded it.
          </li>
          <li>
            For a follow-up: notes, a due date, and who added, listed, completed or removed it, with
            the reason.
          </li>
        </List>
        <P>About members who sign in:</P>
        <List>
          <li>
            Email and name. With Google, the Google account&apos;s ID, email and name, and nothing
            else: no picture and no Google tokens. With email sign-in, a password, kept only as a
            hash.
          </li>
          <li>
            Role, approval or deactivation, the teams they pair into, and the sessions and visits
            they record.
          </li>
          <li>
            Sign-in records: the browser&apos;s identifying string, shown as a device label, when
            the sign-in started and when it was last used.
          </li>
        </List>
        <P>For security:</P>
        <List>
          <li>Counts of failed sign-ins, held in memory for a few minutes.</li>
          <li>Log lines that tag an account by a keyed hash, not by its email.</li>
          <li>Our host&apos;s request logs.</li>
        </List>
        <P>On members&apos; phones:</P>
        <List>
          <li>Records waiting to be sent.</li>
          <li>A copy of the session&apos;s units, so recording works without signal.</li>
        </List>
      </>
    ),
    purposes: (
      <>
        <P>
          We record it to note visits, arrange return visits and follow-ups, run the team (sessions,
          teams and accounts) and keep the app secure.
        </P>
        <P>
          With your agreement, we also call or text you to arrange a visit or to send invitations
          and other messages (see &quot;Phone calls and messages&quot;). Nothing else. We do not
          sell it or give it to anyone for their own marketing, and we share it only with the
          providers named under &quot;Where it is processed&quot;.
        </P>
      </>
    ),
    consent: (
      <>
        <P>
          Members agree by joining and signing in, and this policy is linked from the sign-in page.
        </P>
        <P>
          If we visit you, you choose whether to tell the member anything. A member says what they
          would record and why. If you then tell them, we take that as your agreement to what they
          said. The app does not record that agreement. Religion is sensitive personal data: you
          never need to tell us yours.
        </P>
      </>
    ),
    access: (
      <P>
        To see what we hold about you, or to correct it, email {dpoEmail}. We answer within{" "}
        {RESPONSE_TIMES.access}. If it will take longer, we say when.
      </P>
    ),
    erasure: (
      <>
        <P>
          You can withdraw your consent, or ask us to delete your data, at any time: email{" "}
          {dpoEmail}, or tell the member who visited you.
        </P>
        <List>
          <li>We stop using it within {RESPONSE_TIMES.withdrawal}.</li>
          <li>We erase it within {RESPONSE_TIMES.erasure}.</li>
          <li>
            Erasing a household deletes its name, contact and religion, and deletes the visit notes
            or detaches them from the unit. We keep only a note that it was erased, and when and by
            whom.
          </li>
          <li>A member who withdraws can no longer use the app.</li>
          <li>It also covers copies on phones and in logs.</li>
          <li>
            Our database provider can restore it as it was up to {days(RESTORE_WINDOW_DAYS)} back,
            so erased data can remain in that history until then.
          </li>
        </List>
      </>
    ),
    retention: (
      <>
        <P>We keep each kind of data for no longer than this.</P>
        <ul className="space-y-2">
          {RETENTION.map(({ id, what, keep }) => (
            <li key={id} className="rounded-lg border border-border bg-surface px-3 py-2 text-body">
              <span className="block font-medium">{what}</span>
              <span className="block text-foreground-muted">{keep}</span>
            </li>
          ))}
        </ul>
      </>
    ),
    protection: (
      <List>
        <li>Only members an admin has approved can use the app, and admins can end any sign-in.</li>
        <li>
          Connections are encrypted, passwords are stored only as hashes, and sign-in attempts are
          limited.
        </li>
        <li>
          Signing out drops that member&apos;s sent records and the session&apos;s units from the
          phone. Records not yet sent stay until they are sent.
        </li>
        <li>We keep the latest details we know, and anyone can ask for a correction.</li>
      </List>
    ),
    transfers: (
      <>
        <P>Your data is processed by these providers, under their data processing terms:</P>
        <List>
          <li>Neon, for the database, in Singapore.</li>
          <li>
            Vercel, for the app&apos;s servers, in Singapore. Vercel is a US company, so its network
            and logs may process requests outside Singapore.
          </li>
          <li>Google, for sign-in, outside Singapore.</li>
        </List>
      </>
    ),
    breach: (
      <P>
        If we suspect a breach, we assess it within {RESPONSE_TIMES.breachAssessment}. If it must be
        notified, we tell the Personal Data Protection Commission within{" "}
        {RESPONSE_TIMES.breachReport} of that assessment, and we tell the people affected as soon as
        practicable when significant harm is likely.
      </P>
    ),
    dnc: (
      <>
        <P>The app itself never calls or messages anyone.</P>
        <P>
          Our team may call or text a contact we hold, to arrange a visit or to send an invitation
          or another message, but only after asking the person and getting their agreement. You can
          withdraw that agreement at any time, by telling us or by emailing {dpoEmail}. The app does
          not record that agreement.
        </P>
      </>
    ),
    contact: (
      <address className="text-body [overflow-wrap:anywhere] not-italic">
        {organisation}
        <br />
        Data Protection Officer:{" "}
        <a href={`mailto:${dpoEmail}`} className="font-medium underline">
          {dpoEmail}
        </a>
      </address>
    ),
    changes: (
      <P>
        We change the &quot;last updated&quot; date at the top whenever the text changes. Check it
        when you come back.
      </P>
    ),
  };
}

export function PrivacyPolicy({ contact }: { contact: PrivacyContact }) {
  const body = bodies(contact);
  return (
    <div className="space-y-6">
      {POLICY_SECTIONS.map(({ id, heading }) => (
        <section key={id} aria-labelledby={`privacy-${id}`} className="space-y-2">
          <h2 id={`privacy-${id}`} className="text-title font-semibold text-balance break-words">
            {heading}
          </h2>
          {body[id]}
        </section>
      ))}
    </div>
  );
}
