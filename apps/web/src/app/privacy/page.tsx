export const metadata = { title: "Privacy — Dev Resolve connector" };

/** Public privacy policy for the Dev Resolve connector Chrome extension (linked from its Web Store listing). */
export default function PrivacyPage() {
  return (
    <article className="mx-auto max-w-2xl space-y-4 text-sm leading-relaxed">
      <h1 className="text-xl font-semibold">Dev Resolve connector — privacy policy</h1>
      <p>The Dev Resolve connector is a Chrome extension used only by employees of the company that runs this Dev Resolve
        instance, to investigate support tickets with Dev Resolve.</p>
      <h2 className="font-semibold">What it does</h2>
      <ul className="list-disc space-y-1 pl-5">
        <li>When the signed-in person starts an investigation, Dev Resolve asks the extension to make read-only requests to
          internal systems that are only reachable from that person&apos;s laptop (company VPN). The extension makes those
          requests and returns the answers to Dev Resolve. It only contacts the hosts listed in its manifest.</li>
        <li>If the company&apos;s Claude gateway is only reachable on the company VPN, the extension also passes the
          investigation agent&apos;s requests to that gateway and returns its answers, for anyone&apos;s investigation while it
          is online. These contain ticket details and the investigation so far; the extension doesn&apos;t keep them.</li>
        <li>For internal tools that use Google sign-in, it reads that tool&apos;s session cookie from the person&apos;s own
          browser (after they sign in there) and sends it to Dev Resolve, so their investigations run with their own access.</li>
      </ul>
      <h2 className="font-semibold">What it collects and where it goes</h2>
      <ul className="list-disc space-y-1 pl-5">
        <li>A connector token linking the extension to the person&apos;s Dev Resolve account (stored in the extension).</li>
        <li>Session cookies for the configured internal tools only, sent to this company&apos;s Dev Resolve server and stored
          there for that person only.</li>
        <li>Responses of the internal requests above, sent only to this company&apos;s Dev Resolve server.</li>
      </ul>
      <p>It does not read browsing history, other sites&apos; cookies, passwords or page content; it does not use analytics
        or advertising; nothing is sold or shared with third parties. Google passwords are only ever entered on Google&apos;s
        own pages.</p>
      <h2 className="font-semibold">Removing data</h2>
      <p>Uninstalling the extension deletes its token. An administrator can delete a person&apos;s stored sessions in Dev Resolve.
        Questions: contact your Dev Resolve administrator.</p>
    </article>
  );
}
